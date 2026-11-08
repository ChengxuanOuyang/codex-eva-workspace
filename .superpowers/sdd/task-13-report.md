# Task 13 report: immediate Skip and empty workbench shell

## Outcome

Skip now atomically ends the presentation at `99.2%` in the `waiting` phase without inventing backend readiness or user confirmation. It stops the progress ticker, display clock, and opening-scene timer while the serialized health polling loop continues. Confirmation remains disabled until a real `READY` snapshot arrives.

After the final exact readiness revalidation succeeds, the state reaches `100%`, the boot controller releases every timer, request, and event listener, and `#boot-screen` is hidden from the accessibility tree. The local `#workbench-shell` becomes visible with Scene C as its transition background. The shell contains only a navigation placeholder, a local status area, and the explicit phase-2 notice; it does not simulate chat or remote functionality.

The browser reducer duplicate in `renderer/shared/api.js` was updated with the CommonJS reducer because it is the production reducer used by `boot.js`, and the parity test requires both implementations to remain identical.

## RED evidence

The tests were changed before production code.

`node --test tests/boot-state.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs` produced 19 passes and five expected failures:

- reducer Skip retained progress `20` instead of moving atomically to `99.2`;
- runtime Skip retained progress `0` and kept the 80 ms ticker active;
- a later real readiness snapshot could not make the skipped presentation immediately confirmable;
- completion left `#boot-screen` visible and `#workbench-shell` hidden;
- Electron E2E timed out waiting for `99.2` within one second after Skip.

These failures were behavioral assertions against the previous implementation, not harness or syntax errors.

## Implementation

- Both reducer copies now set only `phase: 'waiting'` and `progress: 99.2` on an eligible Skip, preserving the existing `ready` and `confirmed` values.
- `stopPresentation()` owns the progress interval, display-clock interval, Skip timer, and opening-scene timer. Skip calls it without stopping health polling.
- Final completion hides the boot container, reveals the shell, then destroys the boot controller so polling, abort controllers, timers, keyboard handlers, button handlers, and the pagehide handler are all released.
- The shell uses the existing local Scene C WebP asset and contains no chat controls, message list, remote script, or fabricated conversation state.
- Responsive shell layout keeps navigation, the phase-2 notice, and status content reachable at narrow widths.

## GREEN evidence

- `node --test tests/boot-state.test.cjs tests/boot-runtime.test.cjs`: 23/23 passed.
- `node --test tests/e2e/boot.test.cjs`: 1/1 passed.
- `node --test tests/boot-state.test.cjs tests/boot-runtime.test.cjs tests/e2e/boot.test.cjs`: 24/24 passed.
- `npm run verify`: ESLint passed and 103/103 unit, integration, and security tests passed.
- `git diff --check`: passed.

## Self-review

- Skip remains unavailable until the existing three-second disclosure timer and never changes actual Codex readiness or confirmation.
- Health polling remains serial after Skip and immediately updates the confirmation control when readiness changes.
- Completion still requires the exact final `{ready:true, code:'READY'}` response implemented by Task 12.
- Hiding the boot container removes its grid and controls from the accessibility tree; the E2E verifies both button roles disappear.
- The controller has no intervals, timeouts, or registered root listeners after shell entry.
- Scene C is loaded from the existing allowlisted local asset, and no remote content or chat affordance was introduced.
- The pre-existing untracked remediation plan was neither modified nor staged.

No known blocker remains.

## Reviewer follow-up: recovered waiting state

### Finding and RED evidence

The first implementation treated every `waiting` state as an idempotent Skip. A real failure followed by recovery creates `waiting` while presentation progress may still be below `99.2`; clicking Skip then stopped the presentation timers but left progress below the confirmation threshold.

Regression tests were added before the fix. `node --test tests/boot-state.test.cjs tests/boot-runtime.test.cjs` produced 22 passes and two expected failures:

- the reducer sequence `syncing/20 -> failed -> ready -> skip` remained at `waiting/20`;
- the runtime sequence `syncing/0 -> health failure -> READY -> skip` remained at `waiting/0`, leaving confirmation disabled.

### Fix and GREEN evidence

Skip is now idempotent only for `completing`, `complete`, or an already capped `waiting/99.2` state. A recovered `waiting` state below the cap is moved atomically to `99.2` while its real `ready` and `confirmed` values are preserved. Both reducer copies were updated.

- `node --test tests/boot-state.test.cjs tests/boot-runtime.test.cjs`: 24/24 passed.
- The runtime regression confirms the progress and display timers stop, the 500 ms health poll remains scheduled, and an already recovered READY state enables confirmation immediately.
