mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::file_ops::read_file_bytes,
            commands::file_ops::get_file_metadata,
            commands::export_ops::export_model_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
