//! Tauri host for the OOXML Toolkit renderer: the counterpart of `src/main` + `src/preload` in the
//! Electron build. The renderer talks to it through `src/renderer/src/hostTauri.ts`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
#[cfg(target_os = "macos")]
mod macos;
mod store;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::time::Duration;

use files::Files;
use percent_encoding::percent_decode_str;
use serde::Deserialize;
use serde_json::Value;
use store::Store;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use tauri_plugin_opener::OpenerExt;

/// Keep in sync with `OOXML_EXTENSIONS` in `src/shared/api.ts` (checked by `tests/tauri.test.ts`).
const EXTENSIONS: &[&str] = &[
    "docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "xlsb", "pptx", "pptm", "potx",
    "potm", "ppsx", "ppsm", "vsdx", "vsdm", "odt", "ods", "odp", "odg", "zip",
];

const EV_OPEN_PATHS: &str = "ev:openPaths";
const EV_CLOSE_REQUESTED: &str = "ev:closeRequested";

#[derive(Default)]
struct Shell {
    renderer_ready: AtomicBool,
    force_close: AtomicBool,
    pending: Mutex<Vec<PathBuf>>,
}

// ---------------------------------------------------------------------------------------------
// Opening files from the OS (double click, "Open with", CLI, second instance, drop)
// ---------------------------------------------------------------------------------------------

fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a))
        .filter(|p| {
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase());
            ext.is_some_and(|e| EXTENSIONS.contains(&e.as_str())) && p.is_file()
        })
        .collect()
}

fn to_strings(paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

fn open_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let files = app.state::<Files>();
    let paths: Vec<PathBuf> = paths.iter().map(|p| files.approve(p)).collect();
    let shell = app.state::<Shell>();
    match app.get_webview_window("main") {
        Some(win) if shell.renderer_ready.load(SeqCst) => {
            let _ = app.emit(EV_OPEN_PATHS, to_strings(&paths));
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        _ => shell.pending.lock().unwrap().extend(paths),
    }
}

/// Paths remembered by earlier sessions (history / session restore) may be re-opened.
fn approve_remembered_paths(store: &Store, files: &Files) {
    let path_of = |e: &Value| e.get("path").and_then(Value::as_str).map(PathBuf::from);
    let history = store.get("history");
    let session = store.get("session");
    let tabs = session.as_ref().and_then(|s| s.get("tabs"));
    for list in [history.as_ref(), tabs].into_iter().flatten() {
        for p in list.as_array().into_iter().flatten().filter_map(path_of) {
            files.approve(&p);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

#[derive(Deserialize)]
struct FileFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Deserialize, Default)]
struct OpenDialogOptions {
    title: Option<String>,
    filters: Option<Vec<FileFilter>>,
    multiple: Option<bool>,
}

fn with_filters(
    mut b: FileDialogBuilder<tauri::Wry>,
    filters: &[FileFilter],
) -> FileDialogBuilder<tauri::Wry> {
    // macOS has no filter picker: a "*" filter (All files) means "do not restrict", as in Electron.
    if cfg!(target_os = "macos")
        && filters
            .iter()
            .any(|f| f.extensions.iter().any(|e| e == "*"))
    {
        return b;
    }
    for f in filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        b = b.add_filter(&f.name, &exts);
    }
    b
}

#[tauri::command]
async fn open_files(
    window: WebviewWindow,
    files: State<'_, Files>,
    options: Option<OpenDialogOptions>,
) -> Result<Vec<String>, String> {
    let o = options.unwrap_or_default();
    let mut b = with_filters(
        window.dialog().file().set_parent(&window),
        o.filters.as_deref().unwrap_or(&[]),
    );
    if let Some(title) = o.title {
        b = b.set_title(title);
    }
    let picked = if o.multiple == Some(false) {
        b.blocking_pick_file().map(|p| vec![p])
    } else {
        b.blocking_pick_files()
    };
    let mut out = Vec::new();
    for fp in picked.unwrap_or_default() {
        let p = fp.into_path().map_err(|e| e.to_string())?;
        out.push(files.approve(&p).to_string_lossy().into_owned());
    }
    Ok(out)
}

#[tauri::command]
async fn pick_save_path(
    window: WebviewWindow,
    files: State<'_, Files>,
    default_name: String,
    filters: Vec<FileFilter>,
) -> Result<Option<String>, String> {
    let b = with_filters(window.dialog().file().set_parent(&window), &filters)
        .set_file_name(default_name);
    let Some(fp) = b.blocking_save_file() else {
        return Ok(None);
    };
    let p = fp.into_path().map_err(|e| e.to_string())?;
    Ok(Some(files.approve(&p).to_string_lossy().into_owned()))
}

/// Raw binary response: a 50 MB package must not travel as a JSON number array.
#[tauri::command]
async fn read_file(files: State<'_, Files>, path: String) -> Result<Response, String> {
    Ok(Response::new(files.read(&path).await?))
}

/// Raw binary body; the path and options travel in headers.
#[tauri::command]
async fn write_file(files: State<'_, Files>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("write_file expects a binary body".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let path = header("x-path").ok_or("missing x-path header")?;
    let path = percent_decode_str(path)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let backup = header("x-backup") == Some("1");
    files.write(&path, data.clone(), backup).await
}

#[tauri::command]
fn file_exists(files: State<'_, Files>, path: String) -> bool {
    files.check(&path).is_ok_and(|p| p.exists())
}

#[tauri::command]
fn reveal_in_folder(app: AppHandle, files: State<'_, Files>, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(files.check(&path)?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn storage_get(store: State<'_, Store>, key: String) -> Option<Value> {
    store.get(&key)
}

#[tauri::command]
async fn storage_set(store: State<'_, Store>, key: String, value: Value) -> Result<(), String> {
    store.set(&key, value).await
}

#[tauri::command]
fn set_window_state(window: WebviewWindow, title: String, path: Option<String>, edited: bool) {
    let _ = window.set_title(&title);
    #[cfg(target_os = "macos")]
    macos::set_document(&window, path, edited);
    #[cfg(not(target_os = "macos"))]
    let _ = (path, edited);
}

#[tauri::command]
fn note_recent_documents(window: WebviewWindow, paths: Vec<String>) {
    #[cfg(target_os = "macos")]
    macos::note_recent_documents(
        &window,
        paths
            .into_iter()
            .filter(|p| Path::new(p).exists())
            .collect(),
    );
    // TODO(windows): SHAddToRecentDocs for the taskbar jump list.
    #[cfg(not(target_os = "macos"))]
    let _ = (window, paths);
}

/// Close the window without asking again (after the renderer confirmed).
#[tauri::command]
fn force_close(window: WebviewWindow, shell: State<'_, Shell>) {
    shell.force_close.store(true, SeqCst);
    let _ = window.close();
}

/// The renderer listens for events now: show the window and hand over queued paths.
#[tauri::command]
fn renderer_ready(window: WebviewWindow, shell: State<'_, Shell>) -> Vec<String> {
    shell.renderer_ready.store(true, SeqCst);
    let _ = window.show();
    to_strings(&std::mem::take(&mut *shell.pending.lock().unwrap()))
}

// ---------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------

fn main() {
    let app = tauri::Builder::default()
        // Must be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            open_paths(app, paths_from_args(&argv, Path::new(&cwd)));
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // The window stays hidden until the renderer is ready (no white flash).
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .manage(Files::default())
        .manage(Shell::default())
        .setup(|app| {
            let store = Store::new(app.path().app_data_dir()?.join("storage"));
            approve_remembered_paths(&store, &app.state::<Files>());
            app.manage(store);

            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().collect();
            open_paths(app.handle(), paths_from_args(&args, &cwd));

            // A renderer that never reports ready must not leave an invisible app behind.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.show();
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            let shell = window.state::<Shell>();
            match event {
                // Always let the renderer decide: it knows about input that has not reached the
                // dirty state mirrored here yet.
                WindowEvent::CloseRequested { api, .. } => {
                    if shell.renderer_ready.load(SeqCst) && !shell.force_close.load(SeqCst) {
                        api.prevent_close();
                        let _ = window.emit(EV_CLOSE_REQUESTED, ());
                    }
                }
                WindowEvent::Destroyed => {
                    shell.renderer_ready.store(false, SeqCst);
                    shell.force_close.store(false, SeqCst);
                }
                // Tauri consumes OS drops (the page sees no HTML5 `drop`), but hands us real
                // paths: approve them here instead of trusting paths sent by the renderer.
                WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                    let paths = paths.iter().filter(|p| p.is_file()).cloned().collect();
                    open_paths(window.app_handle(), paths);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_files,
            pick_save_path,
            read_file,
            write_file,
            file_exists,
            reveal_in_folder,
            storage_get,
            storage_set,
            set_window_state,
            note_recent_documents,
            force_close,
            renderer_ready,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            open_paths(_app, paths);
        }
    });
}
