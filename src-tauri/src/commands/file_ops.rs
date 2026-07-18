use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri_plugin_fs::FsExt;

#[derive(Debug, serde::Serialize)]
pub struct FileMetadata {
    pub path: String,
    pub filename: String,
    pub extension: String,
    pub size_bytes: u64,
    pub modified: String,
}

const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500MB

/// Resolve and authorize the exact path used by file commands. Dialog picks
/// and drops are added to Tauri's runtime file-system scope.
fn resolve_allowed_path(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let resolved = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if app.fs_scope().is_allowed(&resolved) {
        Ok(resolved)
    } else {
        Err("Access denied: path is outside the allowed scope".to_string())
    }
}

#[tauri::command]
pub async fn read_file_bytes(
    app: tauri::AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let path = resolve_allowed_path(&app, &path)?;
    // Blocking fs work must not run on the async runtime — a multi-hundred-MB
    // read would stall unrelated IPC commands on the same worker thread.
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        // Return raw bytes via ipc::Response so the IPC layer sends a binary
        // payload (ArrayBuffer on the JS side) instead of a JSON array of
        // numbers. For multi-hundred-MB models the JSON-array encoding is
        // prohibitively expensive in CPU and memory.
        read_file_bounded(&path, MAX_FILE_SIZE)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_file_metadata(
    app: tauri::AppHandle,
    path: String,
) -> Result<FileMetadata, String> {
    let resolved = resolve_allowed_path(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || file_metadata(path, &resolved))
        .await
        .map_err(|e| e.to_string())?
}

fn file_metadata(path: String, resolved: &Path) -> Result<FileMetadata, String> {
    let p = resolved;

    let filename = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let extension = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();

    let metadata = std::fs::metadata(resolved).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Path is not a regular file".to_string());
    }

    let size_bytes = metadata.len();

    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())
        .and_then(|t| {
            t.duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())
                .map(|d| {
                    let secs = d.as_secs();
                    format_iso8601(secs)
                })
        })
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(FileMetadata {
        path,
        filename,
        extension,
        size_bytes,
        modified,
    })
}

fn read_file_bounded(path: &Path, max_size: u64) -> Result<Vec<u8>, String> {
    // Inspect the path before opening it. Windows rejects opening directories
    // with "Access is denied", while Unix permits the open, so checking first
    // keeps the command error stable across platforms.
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Path is not a regular file".to_string());
    }
    if metadata.len() > max_size {
        return Err(format!(
            "File too large ({:.0} MB). Maximum supported size is {:.0} MB.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            max_size as f64 / (1024.0 * 1024.0)
        ));
    }

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(max_size + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max_size {
        return Err(format!(
            "File exceeds the maximum supported size of {:.0} MB.",
            max_size as f64 / (1024.0 * 1024.0)
        ));
    }
    Ok(bytes)
}

fn format_iso8601(epoch_secs: u64) -> String {
    // Days since Unix epoch
    let secs_in_day = 86400u64;
    let time_of_day = epoch_secs % secs_in_day;
    let days_since_epoch = epoch_secs / secs_in_day;

    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate year/month/day from days since epoch (1970-01-01)
    let mut remaining_days = days_since_epoch as i64;
    let mut year = 1970i32;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let month_days = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1u32;
    for &days in &month_days {
        if remaining_days < days {
            break;
        }
        remaining_days -= days;
        month += 1;
    }

    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("forge-view-test-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn format_iso8601_epoch_start() {
        assert_eq!(format_iso8601(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn format_iso8601_leap_day() {
        // 2024-02-29T12:00:00Z
        assert_eq!(format_iso8601(1709208000), "2024-02-29T12:00:00Z");
    }

    #[test]
    fn read_file_bounded_rejects_oversized_file() {
        let base = temp_base("oversized");
        let file = base.join("model.stl");
        std::fs::write(&file, b"12345").unwrap();
        let error = read_file_bounded(&file, 4).unwrap_err();
        assert!(error.starts_with("File too large"));
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn read_file_bounded_rejects_directory() {
        let base = temp_base("directory");
        assert_eq!(
            read_file_bounded(&base, 4).unwrap_err(),
            "Path is not a regular file"
        );
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn file_metadata_rejects_directory() {
        let base = temp_base("metadata-directory");
        assert_eq!(
            file_metadata(base.display().to_string(), &base).unwrap_err(),
            "Path is not a regular file"
        );
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn read_file_bounded_accepts_file_at_limit() {
        let base = temp_base("at-limit");
        let file = base.join("model.stl");
        std::fs::write(&file, b"1234").unwrap();
        assert_eq!(read_file_bounded(&file, 4).unwrap(), b"1234");
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn read_file_bounded_accepts_empty_file() {
        let base = temp_base("empty");
        let file = base.join("model.stl");
        std::fs::write(&file, b"").unwrap();
        assert!(read_file_bounded(&file, 4).unwrap().is_empty());
        std::fs::remove_dir_all(&base).unwrap();
    }
}
