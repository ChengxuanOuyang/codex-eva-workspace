# PROJECT ZERO // REI CODEX WORKBENCH — Design Specification

Date: 2026-11-07  
Status: Approved design, pending written-spec review  
Target repository: `ChengxuanOuyang/codex-eva-workspace`  
Initial release: `v0.1.0-preview`

## 1. Objective

Build an open-source macOS Codex workbench inspired by the ritual, pacing, and visual language of an EVA-00/Rei-themed control system. Opening the application plays an interactive boot sequence, connects to the official local Codex app-server, pauses at 99.2% synchronization for pilot confirmation, then enters a complete Codex workbench.

The product is an independent local client, not a skin or modification of the official ChatGPT/Codex desktop application. It must not patch, inject into, or replace official OpenAI software.

## 2. Product identity

- Display name: `PROJECT ZERO // REI CODEX WORKBENCH`.
- Functional language: Simplified Chinese.
- Atmospheric labels and announcements: Japanese, with Chinese functional meaning visible where needed.
- Public description: unofficial fan project with no affiliation, endorsement, or authorization from the Evangelion rights holders or OpenAI.
- Code license: MIT.
- Upstream MIT copyright and third-party notices must be preserved.

## 3. Intellectual-property boundary

The public repository and public builds must contain only original or appropriately licensed assets.

They must not include:

- official anime frames, promotional art, character illustrations, or screenshots;
- the NERV logo or other official marks;
- original soundtrack, dialogue, voice performances, or copied script lines;
- the user's reference video or assets extracted from it;
- private theme packs created by users.

The open theme may use an original visual vocabulary built from ice white, pale blue, restrained red accents, white-hair/red-eye abstraction, LCL-like orange fluid motion, geometric control panels, warning cells, and synchronization instrumentation. It must not trace or reproduce a specific official image.

The application will support local private theme packs. Theme-pack files live outside the Git repository under Application Support and are excluded from export by default. The project will not download, provide, or encourage redistribution of copyrighted official assets.

## 4. Reference sequence and boot behavior

The supplied 28-second creator video is a timing and composition reference only. The implementation recreates its structure with original assets:

1. Ice-white control surface enters standby.
2. System-awakening title appears.
3. Side warning/emergency cells activate in sequence.
4. An orange fluid layer rises and recedes.
5. A central synchronization ring progresses toward 99.2%.
6. The sequence pauses at 99.2% and displays pilot identity confirmation.
7. A user click completes synchronization to 100%.
8. `SYSTEM ONLINE` / workbench-ready state appears.
9. The view transitions into the Rei-themed Codex workbench.

The animation plays whenever the user deliberately opens the application. It does not register as a macOS login item.

The default experience plays the full sequence. After three seconds, the user may press `Esc` or click Skip. A setting can require full playback every time. Skipping animation never bypasses authentication, health checks, permissions, or backend readiness.

Original Japanese system announcements and original electronic alarms will be created for the project. The voice must not imitate an original actor or character performance. Each audio asset requires a documented redistribution license.

Reduced-motion behavior must respect the macOS accessibility preference by replacing large motion with fades and short state transitions while preserving pilot confirmation.

## 5. Functional scope

The initial preview is a complete independent workbench, not an animation-only launcher. It includes:

- official Codex app-server connection over stdio;
- ChatGPT sign-in status and official login flow;
- project selection and project-scoped tasks;
- streaming user/assistant conversation;
- image input when supported by the selected model;
- model and reasoning-effort selection from the server-provided catalog;
- task stop, resume, rename, archive, and local history;
- command, file-change, permission, and user-input approvals;
- read-only and workspace-write task modes;
- file tree, text preview, changed-file view, and diff view;
- multi-session integrated terminal;
- Git status, diff, stage, unstage, commit, branch, fetch, fast-forward pull, and push;
- official Codex plugin discovery, install, and uninstall operations;
- original theme settings and local private-theme import;
- diagnostics, logs, replay boot sequence, and graceful shutdown.

The application must not claim parity with every official Codex desktop feature. Unsupported app-server requests are declined safely and surfaced to the user.

## 6. Platform and packaging

The application uses Electron because the existing upstream architecture already consists of a Node local service and browser UI. Electron provides a shareable `.app`, native folder dialogs, lifecycle control, and reproducible packaging while preserving those boundaries.

Initial supported platform:

- macOS on Apple Silicon, verified end to end on the owner's Mac;
- macOS Intel, built and automatically tested but explicitly labeled unverified until tested on real Intel hardware.

No paid Apple Developer certificate is currently available. Preview builds use ad-hoc signing and are not notarized. Documentation must explain the normal macOS right-click Open / Privacy & Security approval flow without disabling or bypassing Gatekeeper.

Release artifacts will include architecture-specific `.dmg` and `.zip` files when the native terminal dependency builds reliably for each architecture. A source-install path remains available.

## 7. System architecture

### 7.1 Electron renderer

Responsibilities:

- boot sequence and workbench UI;
- conversation rendering and streamed state;
- approval dialogs;
- terminal, Git, plugins, file, diff, history, settings, and diagnostics views.

Security controls:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- Electron renderer sandbox enabled where compatible;
- strict Content Security Policy;
- local packaged scripts, styles, fonts, and media only;
- arbitrary navigation, popups, remote modules, and untrusted web content blocked.

### 7.2 Electron main process and local service

Responsibilities:

- application/window lifecycle;
- native folder selection;
- local data and log paths;
- startup and shutdown of the local workbench service;
- startup and shutdown of the Codex child process;
- termination of workbench-owned terminal processes;
- update availability links to GitHub Releases, without silent auto-update in the preview.

The local HTTP service binds to a dynamically selected `127.0.0.1` port. It retains strict Host, Origin, content-type, session-cookie, method, body-size, path, and CSP validation. The renderer loads only this loopback origin.

### 7.3 Official Codex app-server

The service launches the official Codex binary with `app-server --listen stdio://` and communicates using newline-delimited JSON-RPC.

Binary discovery order:

1. Codex bundled inside the installed ChatGPT application;
2. a valid `codex` executable on `PATH`;
3. a path explicitly chosen by the user.

The application initializes the official server, reads account state and model catalog, creates or resumes threads, starts and interrupts turns, consumes streaming notifications, and responds to supported approvals.

The application does not implement its own model API client and does not embed an API key or ChatGPT token.

### 7.4 Terminal, Git, and plugin modules

- Terminal uses `node-pty`; zsh is preferred on macOS, with a documented fallback to the user's configured shell.
- Terminal input is intentionally powerful and is visually distinguished from Codex task sandbox settings.
- Git uses direct argument arrays, never a shell-constructed command string.
- Destructive Git operations such as force push, hard reset, discard, and automatic merge are not exposed in the initial release.
- Plugin operations use explicit official Codex CLI arguments and validate plugin identifiers against the server-returned catalog.

## 8. Data and credential boundaries

Application-owned state is stored per Mac under:

`~/Library/Application Support/Project Zero/`

It contains workbench state, attachments, logs, browser/UI preferences, and public or private theme packs. State writes use a temporary file plus atomic rename where possible. A corrupt state file is preserved for recovery instead of overwritten.

Codex credentials remain in the operating-system credential store or the user's `CODEX_HOME`, as controlled by official Codex configuration. The application must never:

- copy or migrate another machine's credentials;
- include credentials in logs, exports, diagnostics, builds, or Git;
- ask the user to paste tokens into the workbench;
- synchronize credentials between devices.

Each person signs into their own OpenAI account on their own Mac. Sharing credentials between people is outside the supported design.

Projects, Git credentials, plugins, local workbench history, and private themes remain device-local. Same-account login must not be presented as full cross-device synchronization.

## 9. File and execution security

- The user must explicitly add a project directory.
- File browsing resolves canonical real paths and rejects targets outside the selected root.
- Directory listings do not follow symbolic links.
- Sensitive paths such as `.env*`, `auth.json`, credentials directories, and `.ssh` are excluded from preview.
- Text preview has size and binary-content limits.
- Image attachment parsing validates media type, dimensions, encoded size, metadata, and stored path.
- New Codex tasks default to read-only.
- Workspace writes require an explicitly selected write-enabled task mode.
- Codex command, file-change, permission, and tool-user-input requests remain user-reviewed.
- Unsupported approval methods are denied, never auto-approved.
- Manual terminal sessions are outside the Codex sandbox; the UI must state this clearly.
- The service does not listen on a public interface and does not provide a public hosting mode.

## 10. Startup and recovery state machine

Boot animation and backend initialization run concurrently.

The pilot-confirmation control at 99.2% becomes active only after the local service, official Codex app-server, account-status request, and model-catalog request reach a usable state. If initialization is not ready, the animation stays at 99.2% and displays an accurate diagnostic state.

Failure handling:

- Missing Codex: offer automatic detection, manual executable selection, and installation documentation.
- Signed out: enter the official ChatGPT login flow after the visual sequence; the application never receives the password.
- App-server failure: show a redacted error, diagnostic log location, and reconnect action.
- Port collision: select another random loopback port.
- State corruption: preserve the original and start a clean recoverable state.
- Animation/audio failure: log the issue and allow entry into the functional workbench.
- Interrupted turn: preserve available diffs and mark the turn interrupted rather than completed.
- Unexpected app exit: on next launch, mark workbench-owned active turns interrupted.

On normal quit, the application stops its Codex child process and integrated terminal sessions. It does not terminate unrelated official Codex or Terminal processes.

## 11. Repository structure

Planned top-level structure:

```text
app/                 Electron main process, preload bridge, packaging
workbench/           Codex, terminal, Git, plugin, attachment, state modules
renderer/            boot sequence and Rei-themed workbench
assets/              original visual/audio/font assets and licenses
scripts/             development, diagnostics, build, install helpers
tests/               unit, integration, security, animation timing
docs/                architecture, workflow, theme, troubleshooting
.github/workflows/   CI, macOS builds, release
README.md
README.en.md
SECURITY.md
CONTRIBUTING.md
THIRD_PARTY_NOTICES.md
LICENSE
```

## 12. Documentation and release workflow

The public repository documents the complete workflow from an empty checkout:

1. prerequisites and supported platforms;
2. clone and dependency installation;
3. local development and Electron preview;
4. Codex discovery and sign-in;
5. tests, lint, dependency audit, and license checks;
6. architecture-specific macOS packaging;
7. ad-hoc signing and Gatekeeper expectations;
8. installation, first launch, login, project selection, and permissions;
9. update, backup, diagnostic collection, and uninstall;
10. theme-pack creation and local import;
11. contribution and security-reporting process;
12. tagged release creation and checksum verification.

Every push and pull request runs dependency installation from the lockfile, lint, automated tests, dependency audit, license checks, and sensitive-file scanning. Security tests cover traversal, symbolic links, Host/Origin/session validation, protected file names, Git argument injection, attachment validation, approval denial, and log redaction.

Release tags produce architecture-specific macOS artifacts, SHA-256 checksum files, release notes, third-party notices, and a clear unnotarized-build warning. Dependency updates are proposed automatically but must pass the same checks before merge.

## 13. Verification and acceptance criteria

The preview is releasable only when:

- the Apple Silicon `.app` launches on the owner's Mac and connects to the currently signed-in Codex account;
- the animation pauses at 99.2% and reaches 100% only after pilot confirmation;
- skip becomes available after three seconds without bypassing readiness or authentication;
- streaming chat, stop, resume, image input, model selection, and effort selection work;
- read-only and write-enabled task modes behave distinctly and approvals remain explicit;
- file and attachment safety checks pass;
- integrated terminal, supported Git operations, and plugin changes pass automated tests;
- interrupted work is not mislabeled completed and available diffs are preserved;
- private themes remain outside Git and protected assets are excluded from public exports;
- original audio, fonts, code, and third-party assets have documented redistribution rights;
- no credential, user-specific path, official EVA asset, or reference-video content exists in the application bundle or Git history;
- Intel builds pass CI and remain labeled not hardware-verified until real-device validation;
- the documented clean-install workflow can be reproduced from a new directory;
- tests, lint, dependency audit, license checks, and security checks pass before release.

## 14. Out of scope for `v0.1.0-preview`

- modifying or theming the official ChatGPT/Codex application;
- macOS login-item auto-start;
- public-network hosting or remote app-server exposure;
- credential synchronization or account sharing;
- automatic cross-device synchronization of local projects or workbench state;
- official copyrighted EVA asset distribution;
- force push, destructive reset, file discard, or automatic Git merge;
- silent auto-update;
- Apple notarization without an available Developer ID certificate;
- guaranteed parity with every official Codex desktop feature.

## 15. Implementation sequencing

Implementation planning will proceed only after this written specification is reviewed and approved. The plan should prioritize: repository foundation and tests; Electron lifecycle and local service; Codex bridge; boot sequence; core workbench; terminal/Git/plugins; private themes and original audio; packaging; security verification; documentation; and preview release.
