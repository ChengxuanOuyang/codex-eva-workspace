# Task 11 report — readiness schema and error redaction

## Schema source

- Source command: `/Applications/ChatGPT.app/Contents/Resources/codex app-server generate-json-schema --out <temporary-directory>`
- Codex version: `codex-cli 0.150.0-alpha.8`
- Inspected artifacts: `v2/GetAccountResponse.json` and `v2/ModelListResponse.json`.

`GetAccountResponse` requires `requiresOpenaiAuth` and allows `account` to be an
official account variant or `null`. `ModelListResponse` requires `data`; its
models require identity, visibility, default-reasoning, and supported-reasoning
fields. The local readiness gate additionally requires one launchable catalog
entry: visible, nonblank identity/display values, nonempty reasoning choices,
and a default effort included in those choices.

## Red evidence

Before implementation, `node --test tests/window-options.test.cjs tests/bridge.test.cjs`
failed as intended:

1. RPC errors exposed the injected raw message containing a token and absolute path.
2. `disconnected` exposed the raw pipe-error message containing a token and absolute path.
3. An empty model catalog was accepted as ready.
4. `{account: null, requiresOpenaiAuth: true}` was rejected as malformed instead
   of yielding a signed-out status.

## Green evidence

After implementation:

- `node --test tests/window-options.test.cjs tests/bridge.test.cjs tests/fake-codex.test.cjs`
  passed: 35 tests, 0 failures.
- `npm run lint` passed.
- `npm run verify` passed: 88 tests, 0 failures (and lint passed).

The signed-out response is schema-valid and emits only the stable readiness
snapshot `{ready:false,status:'SIGNED_OUT',checks:{account:true,models:true}}`.
RPC failures retain their machine-readable `code` and allowlisted structured
data, while their public message is `Codex request failed`; disconnect events
emit only `CODEX_DISCONNECTED`.

## Review remediation

The same local v2 schema generation was also checked for
`v2/ModelListParams.json`: the first `model/list` request may use `{}`, and a
following page uses the opaque response cursor as `{cursor: nextCursor}`.

### Red evidence

The added review regressions initially failed because:

1. An omitted `account` property with `requiresOpenaiAuth: true` was treated as
   ready.
2. A string RPC error code could retain injected secret content.
3. Only the first model-list page was read, so a later visible model was missed,
   and later malformed or repeated-cursor pages were never checked.

### Green evidence

- `node --test tests/window-options.test.cjs tests/bridge.test.cjs tests/fake-codex.test.cjs`
  passed: 40 tests, 0 failures.
- `npm run lint` passed.
- `npm run verify` passed: 93 tests, 0 failures (and lint passed).

The catalog reader now validates every page, aggregates launchability across
pages, rejects repeated cursors, and caps traversal at 100 pages. Only integer
JSON-RPC codes are preserved; all other codes are omitted from the public
error object.
