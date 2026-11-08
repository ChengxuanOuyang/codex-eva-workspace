# Task 14 report — deterministic product data and packaged verification

## Outcome

- Electron now sets `userData` to `appData/Project Zero` before loading or starting the
  lifecycle. The helper accepts an injected path implementation for isolated tests.
- `npm run pack` now removes the complete prior `dist/` tree before invoking electron-builder.
  The builder environment omits the external test bridge, trace, and disconnect-signal keys.
- The packaged smoke selects only the exact current-architecture output (`mac-arm64` or `mac`)
  and can no longer sort and launch an older `dist/mac*` directory.
- Production packaging configuration does not enable `PROJECT_ZERO_TEST_BRIDGE_MODULE`.
  Packaged Electron continues to reject hostile injection through `app.isPackaged` before it
  loads the supplied module.
- Public documentation distinguishes deterministic source E2E from the owner-machine real
  Codex/login packaged smoke. The stale Task 6 fake-gate assertions were synchronized.
- The final branch remediation plan is now tracked as the workflow record for Tasks 10–14.

## TDD evidence

Tests were changed before production code.

`node --test tests/fake-codex.test.cjs tests/package-scripts.test.cjs` initially produced six
passes and two expected failures:

- `configureProductUserData is not a function` proved the fixed product directory was absent;
- the package script was still `electron-builder --dir` instead of a clean deterministic pack.

After the implementation, the same focused command passed 8/8.

## Final verification

- `npm run verify`: exit 0; ESLint passed and 106/106 Node tests passed.
- `npm run test:e2e`: exit 0; it removed the old output, rebuilt the arm64 directory package,
  and both Electron tests passed (source E2E plus owner-machine packaged smoke).
- `npm run pack`: exit 0; a second clean arm64 package was generated at the exact expected
  `dist/mac-arm64/PROJECT ZERO — REI CODEX WORKBENCH.app` path.
- `git diff --check`: exit 0.

## Package inspection

The freshly generated `app.asar` contained 25 entries. Extraction and direct search confirmed:

- no `tests`, `scripts`, `.superpowers`, `private-themes`, `auth.json`, or `.env` entry;
- no private-key marker or API-key-shaped credential;
- packaged `package.json` contains no test bridge, trace, disconnect-signal, or `NODE_ENV=test`
  setting;
- packaged `app/main.cjs` sets `Project Zero` using `appData` before bootstrap;
- the same main file checks `isPackaged` before reading or loading
  `PROJECT_ZERO_TEST_BRIDGE_MODULE`.

The packaged smoke additionally launched with hostile test environment values, reached real
readiness on the owner machine, and confirmed the trace file was never created. This proves the
test module was not loaded by the package.

## Boundaries

The directory package remains intentionally unsigned and unnotarized, uses the default Electron
icon, and reports missing author metadata. Those are existing preview/release-stage limitations,
not failures of this deterministic directory-pack task. Windows installers remain outside the
current macOS scope.
