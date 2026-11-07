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
