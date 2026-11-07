# Task 5 Report — 99.2% Boot State Machine and Original Interface

## Status

Implemented the 99.2% pilot-confirmed boot state machine, the original ice-white/orange PROJECT ZERO interface, secure static asset delivery, and explicit lifecycle resource roots.

## TDD evidence

### Boot state machine

- RED: `node --test tests/boot-state.test.cjs` failed with `MODULE_NOT_FOUND` for `renderer/boot/boot-state.cjs`.
- GREEN: 6/6 focused state-machine tests passed.
- Covered: 99.2% cap, readiness + confirmation gate, presentation-only skip, unknown-event reference/value preservation, redacted failed state and recovery, repeated ready/confirm idempotence, premature/duplicate complete, and terminal skip protection.

### Static asset security

- RED: focused service/lifecycle run had 3 expected failures: root moved to `bootRoot`, static allowlist absent, and lifecycle did not pass explicit roots.
- GREEN: 26/26 focused service/window tests passed after implementation.
- Added an exact allowlist for `/boot.css`, `/boot.js`, and `/shared/api.js`; all other static paths remain 404.
- Every file is opened with `O_NOFOLLOW`, checked as a regular file using `stat` on the same file descriptor, and read through that descriptor.
- Missing files, symbolic links, and directories return the same redacted JSON 404.
- CSS/JavaScript MIME types and existing CSP, `nosniff`, and referrer headers are preserved.

### Renderer boundary

- RED: renderer safety test caught the temporary `module.exports` compatibility branch in served JavaScript.
- GREEN: 3/3 renderer asset tests passed after removing all Node API references from served code.
- The renderer contains no embedded session token/API key, Node API, remote URL, remote asset, official artwork, official logo, official font, dialogue, music, or reference-video pixel.

## Interface and behavior

- Exact display name: `PROJECT ZERO // REI CODEX WORKBENCH`.
- Original CSS/HTML geometry: PZ/00 hexagonal mark, subsystem cells, synchronization ring, orange fluid buffer, diagnostics rail, and local-only status chrome.
- Functional copy is Chinese; Japanese appears only as small atmospheric labels.
- `/health` is polled every 500ms; errors are reduced to a generic diagnostic and polling continues.
- Skip appears after 3 seconds. Click or `Escape` dispatches only `skip`, keeps readiness/confirmation unchanged, and enters the waiting presentation.
- Confirmation is enabled only at exactly 99.2% with backend readiness; `complete` reaches 100 only after confirmation.
- `prefers-reduced-motion: reduce` removes fluid/orbit/telemetry animation and shortens transitions.

## Visual verification

Used the production loopback service and a headless Chromium viewport of 1500×950 with a 55-second watchdog and unconditional browser/service cleanup.

- Normal: paused at 99.2 with confirmation enabled; clicking confirmed completion to 100 and `SYSTEM ONLINE`.
- Not ready / skip: confirmation remained disabled; after 3 seconds `Escape` entered `waiting` at 17.6%, without readiness or confirmation bypass.
- Reduced Motion: page reported reduced mode; computed `.fluid-layer` animation was `none`; layout remained complete.
- Screenshot inspection found no clipping or overflow in the three-column layout and no prohibited visual assets.
- First smoke attempt used `networkidle`, which correctly timed out because 500ms health polling prevents network idleness. It exited under timeout; the harness was corrected to wait for DOM state and then completed in 33.5 seconds.
- `npm start` launched Electron without startup diagnostics for 10 seconds and was then deliberately stopped with SIGINT; no task-owned GUI/service process remained.

## Verification

- Focused: `node --test tests/boot-state.test.cjs tests/renderer-assets.test.cjs tests/service-security.test.cjs tests/window-options.test.cjs` — 35/35 passed.
- Full: `npm run verify` — lint passed; 53/53 tests passed.
- Whitespace: `git diff --check` — passed.

## Files

- Added: `renderer/boot/boot-state.cjs`, `renderer/boot/index.html`, `renderer/boot/boot.css`, `renderer/boot/boot.js`, `renderer/shared/api.js`.
- Added tests: `tests/boot-state.test.cjs`, `tests/renderer-assets.test.cjs`.
- Updated: `workbench/service.cjs`, `app/lifecycle.cjs`, `tests/service-security.test.cjs`, `tests/window-options.test.cjs`.

## Self-review

- Verified skip cannot synthesize readiness, confirmation, completion, or workbench entry.
- Verified unknown and idempotent events preserve object identity.
- Verified static route matching uses exact request strings, so query strings and traversal-shaped paths do not enter the allowlist.
- Verified the renderer has no inline script/style dependency and remains compatible with the current self-only CSP.
- Kept the visual system original and asset-free rather than reproducing protected marks or imagery.

## Concerns / follow-up

- The current task ends at `SYSTEM ONLINE`; transition into the later functional workbench is intentionally deferred to subsequent implementation tasks.
- The CJS test state machine and browser state machine are parallel small implementations because served code must not expose Node module APIs. Keep their shared contract tests aligned if a future build pipeline does not consolidate them.
