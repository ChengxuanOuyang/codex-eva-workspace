# Task 15 report — live readiness ownership and packaged attribution

## Outcome

- `account/updated` is treated only as a snapshot signal. The active bridge immediately
  revokes `READY`, then serially rereads `configRequirements/read`, `account/read`, and every
  paginated `model/list` page before publishing another redacted readiness snapshot.
- Notification bursts are coalesced, bridge generations gate late results, and both disconnect
  and notification listeners are detached when a bridge is replaced or the coordinator closes.
  Malformed and unrelated notifications are ignored without reading or rendering their payloads.
- Completing the boot presentation now transfers health ownership to the mounted workbench
  shell. The shell renders only stable readiness codes and local diagnostics, exposes the same
  authenticated same-origin retry action when recovery is possible, and returns to `READY`
  without replaying boot or mounting another controller.
- The package now carries `assets.json` and `ASSET-LICENSE.md`. Every runtime WebP has a SHA-256
  record and an explicit PNG-to-WebP adaptation note. Code remains MIT-licensed separately.
- The art notice says CC BY 4.0 applies only to contributors' original expression to the extent
  they own it. It does not license or clear third-party character or trademark rights and is not
  a commercial-use guarantee. This is provenance and license documentation, not legal clearance.

## TDD evidence

Tests were written and run before production changes.

The lifecycle RED run failed 2/2 targeted tests because an exact `account/updated` notification
left the snapshot at `READY` and no notification listener existed. The shell RED run failed 2/2
targeted tests because completion stopped health polling and a post-shell disconnect still
displayed `ready`. The package RED run failed because the manifest and art notice were absent from
`build.files`.

After the minimum implementation:

- focused lifecycle, renderer, package, and fake-bridge tests passed 51/51;
- source Electron E2E passed 1/1, including a real fake-bridge disconnect after shell mount,
  local retry, return to `READY`, and proof that boot stayed hidden;
- the retained package-focused tests passed 4/4 after adding exact runtime-file enumeration and
  checksum comparison.

## Final verification

- `npm run verify`: exit 0; ESLint passed and 111/111 Node tests passed.
- `npm run test:e2e`: exit 0; source and packaged Electron tests passed 2/2.
- `npm run pack`: exit 0; a fresh arm64 directory package was generated.
- `git diff --check`: exit 0.

## Fresh ASAR inspection

The final arm64 `app.asar` was inspected directly with `@electron/asar`:

- all three runtime WebP files were present;
- `assets/themes/project-zero/assets.json` and `ASSET-LICENSE.md` were present;
- SHA-256 values for all three extracted WebP files exactly matched the packaged manifest;
- no path matching tests, fixtures, `.env`, credentials, or private assets was present;
- the packaged notice contained the CC BY ownership limitation, third-party character/trademark
  limitation, no-commercial-use-guarantee statement, PNG-to-WebP adaptation record, and separate
  MIT code-license statement.

## Boundaries

This task does not decide the public-REI-versus-private-theme release direction and does not claim
that any third-party character or trademark rights are cleared. The package remains an unsigned,
unnotarized macOS preview using the default Electron icon; those existing release limitations are
outside Task 15.
