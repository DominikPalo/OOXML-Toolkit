# Changelog

All notable changes to this project are documented here. Each release is published on the
[releases page](https://github.com/DominikPalo/OOXML-Toolkit/releases) with its installers.

## Unreleased

## 0.4.0 — 2026-10-07

- **Added:** a **Save** button in the tab bar, next to Compare. It runs the same command as `⌘S` / `Ctrl+S`
  (Inspector drafts are committed first and the malformed-XML check still applies) and is enabled while
  the active document has unsaved changes. Its arrow opens a menu with **Save** and **Save As…**;
  Save As… also works on an unmodified document, so a clean file can be copied.
- **Added:** when another program (PowerPoint, Word, a sync client, …) modifies a file that is open, a
  warning bar offers to reload it and the tab shows a ⚠. Saving over such a file asks before
  overwriting the other changes, and **File → Reload from Disk** re-reads the file at any time
  (keeping the selection; unsaved edits are discarded after asking).
- Docs: the README intro mentions the OpenDocument formats; the screenshots and the demo show the Save button.

## 0.3.0 — 2026-10-07

- **Added:** OpenDocument packages (`.odt`, `.ods`, `.odp`, templates, …) are first-class citizens.
  - The overview shows the document properties from `meta.xml` (title, author, keywords, dates, editing
    time, custom properties, statistics).
  - A **Manifest** view of `META-INF/manifest.xml` replaces the (empty) relationship view, including
    missing and unlisted files, and part headers show the media type from the manifest.
  - The package check verifies `mimetype` (first entry, stored, no trailing whitespace, matches the
    manifest) and compares the manifest with the parts.
  - Adding or renaming a part updates the manifest; `mimetype` is shown as text and always saved first
    and uncompressed (previously it was deflated on save, which breaks ODF consumers).
  - There are no slide, document or worksheet previews for OpenDocument yet.
- **Fixed:** edits made while a save is in progress are no longer lost or marked as saved, and a part
  restored by undo during a save keeps its original position in the archive.
- **Fixed:** changes typed into an Inspector field are committed before saving or closing, so they are no
  longer left out of the file or silently discarded.
- **Fixed:** concurrent writes to the same file are serialized, so two quick saves cannot interleave.
- **Fixed:** part names in `[Content_Types].xml` are percent-encoded and decoded. Renaming a part with a
  space in its name no longer produces an invalid override, and files with encoded names no longer get
  false “no content type” findings in the package check.

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
