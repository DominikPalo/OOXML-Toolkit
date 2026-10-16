//! AppKit calls Tauri does not expose (the Electron build gets these from `BrowserWindow`/`app`).

use objc2::MainThreadMarker;
use objc2_app_kit::{NSDocumentController, NSWindow};
use objc2_foundation::{NSString, NSURL};
use tauri::WebviewWindow;

/// Title-bar proxy icon and the "edited" dot in the close button.
pub fn set_document(window: &WebviewWindow, path: Option<String>, edited: bool) {
    let w = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ptr) = w.ns_window() else { return };
        // SAFETY: Tauri hands out the live NSWindow of this window; we are on the main thread.
        let ns_window: &NSWindow = unsafe { &*ptr.cast() };
        ns_window.setRepresentedFilename(&NSString::from_str(path.as_deref().unwrap_or("")));
        ns_window.setDocumentEdited(edited);
    });
}

/// Dock menu / Apple menu "Recent Items".
pub fn note_recent_documents(window: &WebviewWindow, paths: Vec<String>) {
    let _ = window.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let controller = NSDocumentController::sharedDocumentController(mtm);
        for p in paths {
            controller.noteNewRecentDocumentURL(&NSURL::fileURLWithPath(&NSString::from_str(&p)));
        }
    });
}
