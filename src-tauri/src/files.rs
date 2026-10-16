//! File access for the renderer (port of `src/main/files.ts`). Only paths the user picked, dropped
//! or opened before are accessible.

use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::async_runtime::{self, Mutex as AsyncMutex};

#[derive(Default)]
pub struct Files {
    approved: Mutex<HashSet<PathBuf>>,
    /// One lock per target so writes to the same file never interleave.
    writes: Mutex<HashMap<PathBuf, Arc<AsyncMutex<()>>>>,
}

impl Files {
    pub fn approve(&self, p: &Path) -> PathBuf {
        let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
        self.approved.lock().unwrap().insert(abs.clone());
        abs
    }

    pub fn check(&self, p: &str) -> Result<PathBuf, String> {
        let abs = std::path::absolute(p).map_err(|e| e.to_string())?;
        if self.approved.lock().unwrap().contains(&abs) {
            Ok(abs)
        } else {
            Err(format!(
                "Access to \"{p}\" has not been granted. Open the file through the app first."
            ))
        }
    }

    pub async fn read(&self, p: &str) -> Result<Vec<u8>, String> {
        let path = self.check(p)?;
        async_runtime::spawn_blocking(move || fs::read(path))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())
    }

    pub async fn write(&self, p: &str, data: Vec<u8>, backup: bool) -> Result<(), String> {
        let target = self.check(p)?;
        let lock = self
            .writes
            .lock()
            .unwrap()
            .entry(target.clone())
            .or_default()
            .clone();
        let _guard = lock.lock().await;
        let t = target.clone();
        let result = async_runtime::spawn_blocking(move || write_atomic(&t, &data, backup))
            .await
            .map_err(|e| e.to_string())?;
        drop(_guard);
        let mut writes = self.writes.lock().unwrap();
        if writes
            .get(&target)
            .is_some_and(|l| Arc::strong_count(l) <= 2)
        {
            writes.remove(&target);
        }
        result.map_err(|e| describe(&target, e))
    }
}

/// Temp file in the same directory, then rename over the target.
fn write_atomic(target: &Path, data: &[u8], backup: bool) -> io::Result<()> {
    let meta = match fs::metadata(target) {
        Ok(m) => Some(m),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
    if backup && meta.is_some() {
        let mut bak = target.as_os_str().to_owned();
        bak.push(".bak");
        fs::copy(target, bak)?;
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let tmp = target.with_file_name(format!(
        ".{name}.{}.{nanos}-{}.tmp",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    if let Some(m) = &meta {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(m.permissions().mode() & 0o7777);
    }
    let result = options
        .open(&tmp)
        .and_then(|mut f| {
            f.write_all(data)?;
            f.sync_all()
        })
        .and_then(|_| fs::rename(&tmp, target));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn describe(target: &Path, e: io::Error) -> String {
    use io::ErrorKind::*;
    // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION: the file is open in Office.
    let locked = matches!(
        e.kind(),
        PermissionDenied | ResourceBusy | ReadOnlyFilesystem
    ) || (cfg!(windows) && matches!(e.raw_os_error(), Some(32 | 33)));
    if locked {
        let name = target.file_name().unwrap_or_default().to_string_lossy();
        format!("Cannot write \"{name}\": the file is read-only or locked by another program.")
    } else {
        e.to_string()
    }
}
