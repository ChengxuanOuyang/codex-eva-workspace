# Public theme Task 1 report — private local theme isolation

## Outcome

- Preserved the current three PNG masters and three WebP runtime scenes under the
  Git-ignored `private-themes/rei/` tree without changing their tracked sources.
- Added the exact private theme manifest, a minimal three-asset SHA-256 manifest,
  and a private-use notice that grants no third-party character, trademark, or
  commercial-use rights.
- Anchored the private theme, private staging, and private distribution output
  directories at the repository root in `.gitignore`.

## TDD evidence

The new foundation assertion was written before changing `.gitignore`.

- RED: `node --test tests/foundation.test.cjs` produced 2 passes and 1 expected
  failure because `/private-themes/` was not present as an exact root rule.
- GREEN: the same command passed 3/3 after adding `/private-themes/`,
  `/.private-build/`, and `/dist-private/`.

## Private asset verification

The copied runtime hashes are:

- `scene-a-sync.webp`: `464b75c15fd37ab25fa8ac4e4770b82a50552c71ff8ff8d8875b165cf5e58e00`
- `scene-b-awakening.webp`: `938ef1f5d11b812e0e8b802a03ae84f1a23c2e2e918b2dfec459093c788492de`
- `scene-c-online.webp`: `e8fe96e26efbf0021b2dbb36ec11a1a4b3849e40f4662738468557ac68e253d9`

All three PNG masters and all three WebP runtime files compare byte-for-byte with
their tracked sources. A Node verification also confirmed that the private
`assets.json` has exactly `schemaVersion` and `assets` at the top level, exactly
`file` and `sha256` per asset, and three hashes matching the local files.

## Git isolation evidence

- `git check-ignore -v private-themes/rei/package/theme.json` resolves to the
  root-anchored `/private-themes/` rule.
- Before staging, `git status --short` listed only `.gitignore` and
  `tests/foundation.test.cjs`; no private asset appeared.
- `git diff --check` passed.

The ignored private files remain available in the shared worktree and were not
added to Git. No blocker remains for Task 1.
