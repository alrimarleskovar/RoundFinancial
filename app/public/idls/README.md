# IDL bundle

Files in this directory are consumed by the app at runtime (`/idls/*.json`)
to construct Anchor `Program<Idl>` handles for real mode.

They are **build artefacts**, not hand-authored — do not edit by hand.

## Populating

```bash
anchor build                          # from the repo root
pnpm --filter @roundfi/app prepare-idls
```

Expected files after the script runs:

- `roundfi_core.json`
- `roundfi_reputation.json`
- `roundfi_yield_mock.json`

The app falls back to a visible `action.fail` event when any IDL is
missing, so "real mode" just tells you what to do instead of crashing.
