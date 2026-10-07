# Changelog

All notable changes to this project are documented here. Each release is published on the
[releases page](https://github.com/DominikPalo/OOXML-Toolkit/releases) with its installers.

## 0.2.0 — 2026-10-07

- **Added:** EMF and WMF images can be previewed — in the image view, the slide preview and the
  comparison view. They are converted to SVG with [emf-converter](https://github.com/ChristopherVR/emf-converter)
  (EMF, EMF+ and WMF). Very large drawings — hundreds of thousands of shapes, such as CAD floor plans —
  work with emf-converter 4.11.3 or later, which no longer overflows the call stack on them.
- **Changed:** `emf-converter` is upgraded to 4.11.3, which fixes that crash itself, so the local patch
  and the `patch-package` dependency are removed.

## 0.1.1 — 2026-10-06

- **Fixed:** the macOS app could not be opened after a browser download (“OOXML Toolkit is damaged”).
  The 0.1.0 bundle kept the original Electron signature, which is invalid for the re-packaged app.
  macOS builds are now signed ad hoc with a valid signature, and the release workflow verifies the
  signature of every DMG before publishing.
- Docs: corrected first-launch instructions for macOS (Open Anyway) and the Linux AppImage file name.
- Project pinned to Node.js 24; CI and release workflows run on Node 24 actions.

## 0.1.0 — 2026-10-06

First public release. See the [release notes](docs/releases/v0.1.0.md) for the feature overview and
download instructions.

- View: tree of parts and XML elements (plus relationship graph), source editor, inspector, hex and
  image views, worksheet / document / slide previews, package check.
- Edit: XML editor and element inspector, part operations (add, replace, rename, delete), undo/redo,
  atomic saves that leave untouched parts byte-for-byte identical.
- Compare: two files or unsaved changes, part-level status, split / unified XML diff, Markdown report.
- Search and navigation: text / regex / XPath search, go-to-part, bookmarks, recent files, session restore.
- Installers for macOS (Apple Silicon and Intel), Windows (installer and portable) and Linux (AppImage).
