//! Tiny JSON key/value store in the app-data directory (port of `src/main/store.ts`).

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::async_runtime::{self, Mutex as AsyncMutex};

pub struct Store {
    dir: PathBuf,
    /// Serialise writes per key so concurrent saves can never interleave.
    queues: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            queues: Mutex::default(),
        }
    }

    fn file_for(&self, key: &str) -> PathBuf {
        let safe: String = key
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        serde_json::from_slice(&fs::read(self.file_for(key)).ok()?).ok()
    }

    pub async fn set(&self, key: &str, value: Value) -> Result<(), String> {
        let lock = self
            .queues
            .lock()
            .unwrap()
            .entry(key.to_owned())
            .or_default()
            .clone();
        let _guard = lock.lock().await;
        let (dir, target) = (self.dir.clone(), self.file_for(key));
        async_runtime::spawn_blocking(move || -> std::io::Result<()> {
            fs::create_dir_all(&dir)?;
            let mut tmp = target.as_os_str().to_owned();
            tmp.push(format!(".{}.tmp", std::process::id()));
            fs::write(&tmp, serde_json::to_vec(&value)?)?;
            fs::rename(&tmp, &target)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
    }
}
