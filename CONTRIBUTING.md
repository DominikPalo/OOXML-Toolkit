# How to Contribute

Thanks for your interest in contributing to OOXML Toolkit! Here are a few general guidelines on
contributing and reporting bugs that we ask you to review. Following them helps to communicate that
you respect the time of the people managing and developing this open source project. In return, they
should reciprocate that respect in addressing your issue, assessing changes, and helping you finalize
your pull requests. In that spirit of mutual respect, we endeavor to review incoming issues and pull
requests within 10 days, and will close any lingering issues or pull requests after 60 days of
inactivity.

Please note that all of your interactions in the project are subject to our
[Code of Conduct](CODE_OF_CONDUCT.md). This includes creation of issues or pull requests, commenting
on issues or pull requests, and extends to all interactions in any real-time space.

## Reporting Issues

Before reporting a new issue, please ensure that the issue was not already reported or fixed by
searching through our [issues list](https://github.com/DominikPalo/OOXML-Toolkit/issues).

When creating a new issue, please be sure to include a **title and clear description**, as much
relevant information as possible (app version, operating system, the kind of file), and, if possible,
a test case. A small document that reproduces the problem helps the most — but **never attach files
that contain confidential or personal data**. Strip them down first, or describe the structure of the
package instead (the part names and the XML involved).

**If you discover a security bug, please do not report it through a public issue. Instead, please see
the security procedures in [SECURITY.md](SECURITY.md).**

## Sending Pull Requests

Before sending a new pull request, take a look at existing pull requests and issues to see if the
proposed change or fix has been discussed in the past, or if the change was already implemented but
not yet released. For larger changes, please open an issue first so the approach can be agreed on
before you invest the time.

We expect new pull requests to include tests for any affected behavior, and, as we follow
[semantic versioning](https://semver.org), we may reserve breaking changes until the next major
version release.

### Development setup

You need **Node.js 24** (see `.nvmrc`; with nvm, `nvm use`) and npm. The [README](README.md#development)
lists every script; the ones you will use most are:

```bash
npm install
npm run dev         # Electron app with hot reload
npm run dev:web     # the same UI in a browser at http://localhost:5199
npm test            # unit tests (vitest)
npm run typecheck
npm run format      # Prettier (single quotes, 100 columns)
```

Before you push, make sure `npm run format:check`, `npm run typecheck` and `npm test` pass — CI runs
the same checks. If your change affects the UI, `npm run e2e` drives the built app end to end
(run `npm run samples` once first).

### Conventions

- `src/core` is framework-free (no React, no Electron, no DOM-only APIs) and unit-tested in Node. Put
  logic there rather than in components.
- The original ZIP is never mutated, and XML edits are text splices computed from the
  offset-preserving parser. Never round-trip a part through DOM serialization — it would rewrite
  quoting, entities and prefixes.
- For anything touching the parser, the formatter, the ZIP layer or the previews, also try the change
  against a few genuine Office files: the formatter must never change text content, and an untouched
  save must reproduce identical entries. Keep such files in `samples/local/` (git-ignored) — never
  commit them.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- If you change the UI, regenerate the documentation images with `npm run screenshots` (and
  `npm run demo`, which needs ffmpeg) instead of editing them by hand.

## Other Ways to Contribute

We welcome anyone that wants to contribute to OOXML Toolkit to triage and reply to open issues to help
troubleshoot and fix existing bugs. Here is what you can do:

- Help ensure that existing issues follow the recommendations from the
  _[Reporting Issues](#reporting-issues)_ section, providing feedback to the issue's author on what
  might be missing.
- Review and improve the [user guide](docs/guide.md) and the [README](README.md).
- Review existing pull requests, and test patches against real-world documents.
- Write a test, or add a missing test case to an existing test.

Thanks again for your interest in contributing to OOXML Toolkit!

:heart:
