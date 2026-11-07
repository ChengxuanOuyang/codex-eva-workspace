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

## Independent review fix

### RED / GREEN

- RED: the new VM/runtime and static accessibility suite produced 9 expected failures: no injectable controller, overlapping interval-based health polling, no abort/stale-response guard, ticker continuing in waiting, missing progressbar ARIA, incomplete waiting/reduced-motion CSS, and insufficient muted-text contrast.
- GREEN: `node --test tests/boot-state.test.cjs tests/renderer-assets.test.cjs tests/boot-runtime.test.cjs` passed 19/19.
- A separate RED/GREEN cycle verified listener cleanup on unload; another verified skip freezes the ticker even when a failed health check has already recovered into the `waiting` phase.

### Runtime changes

- Replaced the immediate boot IIFE with an injectable browser-only `createBootController` while preserving automatic browser startup.
- Replaced re-entrant `setInterval` health checks with serial `setTimeout` scheduling: the next 500ms poll is created only after the current request settles.
- Each health request receives an `AbortController` signal. Completion and `pagehide` abort active work, invalidate its generation, clear timers/listeners, and prevent stale responses from writing DOM or overwriting `SYSTEM ONLINE`.
- The 80ms presentation ticker now stops at 99.2% and immediately on skip, including an already-waiting recovered state; health polling continues while skipped.
- Live-region content uses change-aware writes, so repeated identical health states do not retrigger announcements.

### Accessibility and motion

- The synchronization ring is a dynamic progressbar with min/max/current ARIA values; `aria-valuenow` updates on every rendered progress change.
- Waiting explicitly disables fluid, glint, orbit, telemetry, signal-dot animation and ring transition.
- Reduced Motion explicitly sets the ring transition to `none` rather than inheriting a longer global transition duration.
- Darkened `--muted` and `--orange-deep`; automated WCAG contrast calculations verify both functional small-text colors are at least 4.5:1 on the ice surface.

### Shared contract and verification

- Added a sandboxed VM contract test that loads `renderer/shared/api.js` without adding any CommonJS/Node branch and runs the same state/event matrix against the browser and CJS reducers, including identity-preserving no-ops.
- Runtime tests use a deterministic fake clock and controllable delayed health promises; no GUI or real timer waits are involved.
- Final `npm run verify`: lint passed; 63/63 tests passed.
- Final `git diff --check`: passed.

### Review self-check

- At most one health request can be active; no next poll exists until settlement.
- Completion and unload abort the current request and block all later writes.
- Skip never changes readiness/confirmation and now also makes the presentation mechanically static.
- Browser-served JavaScript still contains no Node API, embedded credential, or remote resource.

## Second independent review fix

### RED / GREEN

- RED: the focused suite produced 6 expected failures covering the still-running display clock in `waiting`, failed→ready recovery not freezing presentation centrally, complete retaining interaction listeners, `Escape` calling `preventDefault`, duplicate automatic controller startup, and progressbar semantics remaining on the SVG child circle.
- GREEN: `node --test tests/boot-state.test.cjs tests/renderer-assets.test.cjs tests/boot-runtime.test.cjs` passed 21/21 with deterministic FakeClock/VM coverage and no GUI.

### Changes and self-review

- Centralized the `waiting` invariant in dispatch: every event result in `waiting`, including failed→ready recovery and explicit skip, clears both the 80ms progress ticker and 100ms display clock. The independent serial 500ms health schedule remains active.
- Moved `role="progressbar"`, its accessible label, range, and current value to the `<svg>` itself. The controller updates that SVG while the visual stroke remains a separate circle.
- Stored automatic startup as a window-level singleton. Re-evaluating the browser script reuses the existing controller and creates no duplicate timers or global listeners.
- Entering `complete` immediately removes confirm/skip click handlers and the keydown handler, while retaining `pagehide` for final destruction. `Escape` still performs presentation-only skip but no longer prevents the browser default.
- Confirmed the waiting freeze does not fabricate readiness/confirmation, stale health responses remain guarded, and completion still aborts the active health request.

### Final verification

- Focused: 21/21 passed.
- `npm run verify`: lint passed; 65/65 tests passed.
- `git diff --check`: passed.
