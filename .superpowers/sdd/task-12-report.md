# Task 12 report: dynamic recoverable readiness lifecycle

## Outcome

The loopback service and Electron window now open with the redacted snapshot `{ready:false, code:'INITIALIZING'}` before Codex discovery, bridge startup, account validation, or model validation completes. Initialization runs asynchronously and serially. Missing Codex, signed-out state, no launchable model, malformed readiness, and later disconnection keep the window alive with a local recovery action.

The only renderer-visible readiness codes are:

- `INITIALIZING`
- `CODEX_NOT_FOUND`
- `SIGNED_OUT`
- `NO_LAUNCHABLE_MODEL`
- `DISCONNECTED`
- `READY`

## Red evidence

Tests were written before the implementation changes.

- `node --test tests/window-options.test.cjs` failed because `createReadinessStore` did not exist, startup still blocked on the Codex bridge, missing Codex still rejected startup, and readiness still exposed the old immutable `checks` snapshot. The retry serialization test remained pending because the old `startWorkbench()` waited for bridge startup.
- `node --test tests/service-security.test.cjs` failed because `/api/readiness/retry` did not exist and `/health` did not expose the stable readiness code.
- `node --test tests/boot-runtime.test.cjs` produced four expected failures: no code-specific diagnostic, disconnect could not revoke the `completing` phase, retry did not invalidate stale health, and the shared API had no retry method.
- `node --test tests/e2e/boot.test.cjs` timed out at 30 seconds because the test bridge did not yet support the deterministic post-ready disconnect signal.

## Architecture

### Lifecycle ownership

`app/lifecycle.cjs` now owns a small mutable readiness store and a serialized coordinator. The coordinator:

- returns the same promise while an initialization attempt is in flight;
- rediscovers Codex on each retry;
- stops the previous bridge before creating the next bridge;
- owns every bridge until it has been stopped successfully;
- gates results and disconnect events by active attempt and active bridge;
- subscribes to `disconnected` and immediately changes the store to `DISCONNECTED`;
- converts internal exceptions into stable states without exposing paths or raw messages;
- participates in the existing bounded, retryable shutdown cleanup.

The service and window are constructed and loaded before `coordinator.retry()` starts the first Codex attempt.

### HTTP security boundary

`workbench/service.cjs` exposes one recovery mutation: `POST /api/readiness/retry`. It requires the exact session cookie and exact loopback `Origin`; other methods receive an exact `Allow: POST`. The route returns only `{accepted:true}` and never forwards an initialization exception. Existing Host validation, bounded body handling, loopback-only listening, CSP, and static-file allowlisting remain intact.

### Renderer recovery

The boot renderer maps stable readiness codes to redacted user-facing diagnostics and shows a local retry button only for recoverable states. A retry aborts and invalidates the current health request before issuing the authenticated POST, so a late READY response cannot restore confirmation. A later non-ready health snapshot revokes readiness even during `completing`, cancels the completion timer, disables confirmation, and prevents transition to online.

### End-to-end seam

The development-only in-memory bridge accepts a filesystem disconnect signal. The source E2E waits for genuine READY, triggers a bridge disconnect, verifies confirmation is disabled and online is not entered, removes the signal, uses the renderer retry action, returns to READY, and then completes normally. No production route or production bridge behavior was added for this test control.

## Green evidence

- `node --test tests/window-options.test.cjs tests/service-security.test.cjs`: 42/42 passed.
- `node --test tests/boot-runtime.test.cjs`: 13/13 passed.
- `node --test tests/e2e/boot.test.cjs`: 1/1 passed in 22.8 seconds.
- `node --test tests/window-options.test.cjs tests/service-security.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs`: 56/56 passed.
- `npm run verify`: ESLint passed and 100/100 unit/integration/security tests passed.
- `git diff --check`: passed.

## Self-review

- Confirmed the store rejects any status outside the six-code allowlist and snapshots contain no account, model, executable, path, or exception fields.
- Confirmed malformed account/model responses, pagination cycles, missing Codex, signed-out state, and non-launchable catalogs remain recoverable with the window open.
- Confirmed old bridge events cannot revoke a newer attempt and only one attempt is active at a time.
- Confirmed retry-created bridges remain under shutdown ownership and cleanup retains the existing force/timeout behavior.
- Confirmed the retry route cannot be invoked without the session cookie or from a foreign/missing origin.
- Confirmed renderer polling stays serial, retry invalidates stale responses, and post-ready disconnect prevents online completion.
- Confirmed the pre-existing untracked remediation plan was not modified or staged.

No known blocker remains. Renderer observation of a main-process disconnect uses the existing 500 ms health polling interval; the main-process readiness store itself is revoked synchronously by the bridge event.

## P1 follow-up: completion-time readiness race

### Reviewer finding and RED evidence

The original renderer trusted the last polling result for another fixed 120 ms (reduced motion) or 720 ms (full motion) after confirmation. A bridge disconnect after the last READY poll could therefore race the completion timer and briefly enter the online scene.

The follow-up tests were changed before the renderer implementation:

- `node --test tests/boot-runtime.test.cjs` reported 12/15 passing and three expected failures. The reduced-motion case made only one health call instead of the required final second call; a rejected final health check still left the phase `complete` instead of `failed`; and the overlapping-poll case made two calls instead of a separate third final revalidation.
- The first attempted E2E RED used a renderer reload to force reduced motion and failed for the wrong reason: Playwright reported `net::ERR_ABORTED` because the reload interrupted lifecycle `window.loadURL()`, which also produced a native startup-failure dialog in that temporary test instance. That harness path was discarded. After waiting for the initial load, the intended RED reached the application assertion and timed out waiting for `failed` because the old implementation entered online. The final E2E does not reload the renderer; reduced motion is covered deterministically by the runtime test.

### Follow-up architecture

When the completion delay expires, the renderer now:

- invalidates and aborts any scheduled or in-flight polling generation;
- starts one separately tracked final health request;
- accepts completion only when that current response contains both `ready: true` and `code: 'READY'`;
- turns false, malformed, non-exact, or rejected responses into a stable redacted recoverable failure and resumes 500 ms polling;
- ignores late responses from the invalidated poll, while catching every request path so an abort cannot become an unhandled rejection;
- stops health, progress, and display timers only after the exact final READY response succeeds.

The source E2E now confirms first, waits for `completing`, triggers the fake bridge disconnect, and records every scene mutation to prove online was never entered before the UI revoked confirmation. It then removes the signal, retries locally, reaches READY, confirms again, and completes normally.

### Follow-up GREEN evidence

- `node --test tests/boot-runtime.test.cjs`: 15/15 passed, including reduced-motion, final-error recovery, and overlapping old-poll generation coverage.
- `node --test tests/e2e/boot.test.cjs`: 1/1 passed after the implementation; the final E2E is also included in the focused aggregate below.
- `node --test tests/window-options.test.cjs tests/service-security.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs`: 58/58 passed in 22.0 seconds.
- `npm run verify`: ESLint passed and 102/102 unit, integration, and security tests passed.
- `git diff --check`: passed.

### Follow-up self-review

- The final gate does not accept the legacy ambiguous `{ready:true}` shape; both exact fields are required.
- A failed final check revokes `confirmed` through the reducer, leaves confirmation disabled, exposes only a stable diagnostic, keeps retry available, and schedules recovery polling.
- A completion revalidation can overlap an already issued poll only after that older request has been aborted and its generation invalidated; either order of late settlement is harmless.
- Destroy and retry still own their controllers, invalidate generations, and prevent later DOM writes.
- The E2E has no renderer reload or media emulation, so it cannot reproduce the discarded `loadURL()` interruption.
- The pre-existing untracked remediation plan remains untouched and will not be staged.

No known blocker remains after the P1 follow-up.
