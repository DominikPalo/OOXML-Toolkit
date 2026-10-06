# OOXML Toolkit — notes for working in this repo

Electron + React + TypeScript app to view / edit / compare OOXML (and ODF) packages. See `README.md`
for the feature list and architecture overview.

## Commands

Node.js 24 (`.nvmrc`; `engine-strict` is on, so older versions fail at `npm install`).

- `npm run dev` (Electron, hot reload) · `npm run dev:web` (same UI in a browser at :5199)
- `npm test` (vitest, `tests/`) · `npm run typecheck` · `npm run build`
- `npm run e2e` drives the built Electron app with Playwright (needs `npm run samples` once).
  Against a packaged build: `OOXML_E2E_EXECUTABLE=<path to app binary> node e2e/smoke.mjs`.
- Docs: `README.md` (examples) and `docs/guide.md` (reference). Their images come from `npm run screenshots`
  and `npm run demo` (needs ffmpeg) — regenerate them after UI changes instead of editing by hand.
- Format with `npx prettier --write` (config in `.prettierrc.json`: single quotes, 100 cols).

## Conventions that matter

- `src/core` is framework-free and must stay that way (no React, no Electron, no DOM-only APIs) —
  it is unit-tested in Node. Put logic there, not in components.
- The original ZIP is never mutated. `PackageModel` keeps an overlay of edited parts plus an undo
  history; `serialize()` re-uses the original compressed bytes of untouched entries.
- XML edits are text splices computed from the offset-preserving parser (`core/xml`). Never
  round-trip a part through DOM serialization — it would rewrite quoting, entities and prefixes.
- What the editor *shows* (pretty-printed XML) can differ from what is stored. Anything that maps
  positions between the two (search hits, reveals, highlights) must go through `lib/display.ts`.
- zustand v5: a selector that allocates (`.filter`, `.map`, object literals) re-renders forever.
  Select the stable array and derive with `useMemo`.
- `host.ts` is the only door to the outside world (Electron IPC or browser fallback). The main
  process only serves paths the user picked or opened before (`main/files.ts`).
- Keyboard shortcuts and the native menu both come from `shared/commands.ts`.
- `samples/local/` is git-ignored — put real-world Office files there for manual testing, never commit them.

## Testing real documents

`tests/fixtures/builders.ts` builds realistic DOCX/XLSX/PPTX packages. For anything touching the
parser, formatter, ZIP layer or previews, also run it against a few genuine Office files: the
formatter must never change text content and an untouched save must reproduce identical entries.
