# Tauri 2 host (prototype)

The same renderer as the Electron build, hosted by Tauri: **WKWebView on macOS, WebView2 on
Windows**. Nothing in `src/core` or the React UI was rewritten. The renderer picks the Tauri bridge
(`src/renderer/src/hostTauri.ts`) when it finds `window.__TAURI_INTERNALS__`, otherwise the Electron
preload bridge or the browser fallback.

## Running it

Needs a Rust toolchain (`rustup`, stable) on top of the usual Node setup.

```bash
npm run dev:tauri     # vite dev server on :5199 + the native window, hot reload
npm run dist:tauri    # release bundles in src-tauri/target/release/bundle/
```

`npx tauri build --debug --bundles app` builds a debug `.app` with the bundled frontend (no dev server;
right-click → Inspect Element works).

## How it maps to the Electron build

| Electron                                        | Tauri                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `src/preload/index.ts`                          | `src/renderer/src/hostTauri.ts` (`invoke` / `listen`)            |
| `src/main/files.ts` (allow-list, atomic writes) | `src-tauri/src/files.rs`                                         |
| `src/main/store.ts`                             | `src-tauri/src/store.rs` (same JSON files, different directory)  |
| `src/main/menu.ts`                              | `src/renderer/src/tauriMenu.ts`, built from `shared/commands.ts` |
| `src/main/index.ts` (window, IPC, open-file)    | `src-tauri/src/main.rs`                                          |
| `setRepresentedFilename`, `addRecentDocument`   | `src-tauri/src/macos.rs` (AppKit via `objc2`)                    |
| `electron-builder.yml`                          | `tauri.conf.json` (`bundle`, file associations)                  |

Design notes:

- **Binary IPC.** `read_file` returns a raw `ipc::Response` and `write_file` takes a raw body with
  the path in a percent-encoded header, so packages never travel as JSON number arrays.
- **Paths stay on the native side.** Dialogs run in Rust, so only paths the user picked, dropped or
  opened before are approved. Unlike Electron, the renderer cannot approve paths (`approvePaths` is
  a no-op).
- **Drops.** Tauri swallows OS file drops (no HTML5 `drop` event fires) but reports real paths.
  `main.rs` approves them and sends them through `onOpenPaths`. `HostApi.onFileDrag` drives the drop
  overlay.
- **Close handshake.** Same protocol as Electron: `CloseRequested` is prevented and forwarded to the
  renderer, which calls `force_close` after the unsaved-changes dialog.

## Verified (macOS 27, Apple Silicon)

- Release bundle: **4.1 MB `.app`, 2.6 MB DMG** (Electron 0.3.0 arm64 DMG: 128 MB).
- Opening files from the command line, from Finder / `open` into the running instance, and restoring
  the last session (remembered paths are approved at startup).
- Native menu with every shortcut from `shared/commands.ts`, plus a live Open Recent submenu.
- Format → Save through the menu: atomic write, `.bak` copy, file mode kept, path with spaces, valid
  ZIP afterwards. The title-bar document and "edited" dot follow the dirty state.
- Quit with no unsaved changes exits. Closing the window with unsaved changes keeps it open for the
  renderer's dialog.
- The UI renders correctly in the system WKWebView (editor, tree, preview), with no console errors.
- `npm test` covers the Rust extension list and the file associations against `shared/api.ts` /
  `electron-builder.yml` (`tests/tauri-config.test.ts`).

## Not done / known gaps

- **Windows has not been built or run.** Still to check: WebView2, menu shortcuts while the web view
  has focus, the NSIS installer and file associations, and the jump list (`SHAddToRecentDocs` is a
  TODO in `main.rs`).
- **No automated end-to-end tests.** Playwright's `_electron` cannot drive it and `tauri-driver` has
  no macOS support. `npm run e2e`, `screenshots` and `demo` still run against Electron only.
- **macOS lifecycle.** The app quits when its window closes, while Electron stays in the Dock.
  Quitting from the Dock or at logout skips the unsaved-changes check (there is no
  `applicationShouldTerminate` hook yet). A hung renderer can keep the window open, because Electron's
  `isCrashed()` check has no equivalent here.
- Settings and history live in `~/Library/Application Support/dev.ooxml-toolkit.app`. Nothing is
  migrated from the Electron build.
- Open Recent shows file names only (Tauri menus have no sublabel). There is no Reload / Toggle
  DevTools menu item. Zoom uses `setZoom` with fixed steps.
- No CSP (same as the Electron build).
