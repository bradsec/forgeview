use tauri_plugin_dialog::DialogExt;

/// Decode a percent-encoded UTF-8 string (the frontend sends the suggested
/// filename through an ASCII-safe IPC header).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""),
                16,
            ) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Strip path separators and control characters so a filename suggestion
/// can never traverse directories in the save dialog default.
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':') && !c.is_control())
        .collect();
    if cleaned.trim().is_empty() {
        "model.stl".to_string()
    } else {
        cleaned
    }
}

/// Open the native save dialog with the suggested filename and write the
/// raw request body to the chosen location. Returns the saved path, or
/// None when the user cancels. Doing the dialog on the Rust side means the
/// frontend never supplies a filesystem path for a write.
#[tauri::command]
pub async fn export_model_file(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    let filename = request
        .headers()
        .get("x-forgeview-filename")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .map(|name| sanitize_filename(&name))
        .unwrap_or_else(|| "model.stl".to_string());

    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("Expected binary payload".to_string()),
    };

    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("stl")
        .to_string();

    let dialog = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("3D model", &[&extension]);

    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;

    let path_for_write = path.clone();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&path_for_write, &bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decode_roundtrips_utf8() {
        assert_eq!(percent_decode("m%C3%B6del%20v2.stl"), "mödel v2.stl");
    }

    #[test]
    fn percent_decode_passes_plain_ascii() {
        assert_eq!(percent_decode("part.3mf"), "part.3mf");
    }

    #[test]
    fn sanitize_strips_separators() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "....etcpasswd");
        assert_eq!(sanitize_filename("a\\b:c.stl"), "abc.stl");
    }

    #[test]
    fn sanitize_falls_back_when_empty() {
        assert_eq!(sanitize_filename("///"), "model.stl");
    }
}
