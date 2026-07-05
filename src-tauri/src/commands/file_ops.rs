use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(serde::Serialize)]
pub struct FileMetadata {
    pub path: String,
    pub filename: String,
    pub extension: String,
    pub size_bytes: u64,
    pub modified: String,
}

const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500MB

/// Reject paths outside what the user has granted access to: anything the
/// runtime fs scope allows (files picked via the dialog plugin or dropped
/// onto the window) plus the user's home directory, mirroring the
/// fs:scope-home-recursive permission in capabilities/default.json.
/// Without this, these commands would accept any readable path from the
/// webview, bypassing the fs plugin's sandbox.
fn check_path_allowed(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    if app.fs_scope().is_allowed(path) {
        return Ok(());
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    if is_under(Path::new(path), &home).unwrap_or(false) {
        return Ok(());
    }
    Err("Access denied: path is outside the allowed scope".to_string())
}

/// True if `path` canonicalizes to a location under `base`.
/// Canonicalization resolves symlinks and `..` components, so a traversal
/// like `base/sub/../../etc` cannot escape the check.
fn is_under(path: &Path, base: &Path) -> Result<bool, String> {
    let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let base = std::fs::canonicalize(base).map_err(|e| e.to_string())?;
    Ok(path.starts_with(&base))
}

#[tauri::command]
pub async fn read_file_bytes(
    app: tauri::AppHandle,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    check_path_allowed(&app, &path)?;
    // Blocking fs work must not run on the async runtime — a multi-hundred-MB
    // read would stall unrelated IPC commands on the same worker thread.
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() > MAX_FILE_SIZE {
            return Err(format!(
                "File too large ({:.0} MB). Maximum supported size is 500 MB.",
                metadata.len() as f64 / (1024.0 * 1024.0)
            ));
        }
        // Return raw bytes via ipc::Response so the IPC layer sends a binary
        // payload (ArrayBuffer on the JS side) instead of a JSON array of
        // numbers. For multi-hundred-MB models the JSON-array encoding is
        // prohibitively expensive in CPU and memory.
        std::fs::read(&path).map_err(|e| e.to_string())
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
    check_path_allowed(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);

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

        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;

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
    })
    .await
    .map_err(|e| e.to_string())?
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
        let dir = std::env::temp_dir().join(format!("forge-view-test-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn is_under_accepts_child_path() {
        let base = temp_base("child");
        let file = base.join("model.stl");
        std::fs::write(&file, b"x").unwrap();
        assert!(is_under(&file, &base).unwrap());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn is_under_rejects_sibling_path() {
        let base = temp_base("a");
        let other = temp_base("b");
        let file = other.join("model.stl");
        std::fs::write(&file, b"x").unwrap();
        assert!(!is_under(&file, &base).unwrap());
        std::fs::remove_dir_all(&base).unwrap();
        std::fs::remove_dir_all(&other).unwrap();
    }

    #[test]
    fn is_under_rejects_dotdot_traversal() {
        let base = temp_base("trav");
        let sub = base.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let outside = temp_base("trav-outside");
        let file = outside.join("secret.txt");
        std::fs::write(&file, b"x").unwrap();
        // base/sub/../../<outside>/secret.txt escapes base
        let sneaky = sub.join("..").join("..").join(outside.file_name().unwrap()).join("secret.txt");
        assert!(!is_under(&sneaky, &base).unwrap());
        std::fs::remove_dir_all(&base).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn is_under_errors_on_missing_path() {
        let base = temp_base("missing");
        assert!(is_under(Path::new("/nonexistent/forge-view-nope"), &base).is_err());
        std::fs::remove_dir_all(&base).unwrap();
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
}
