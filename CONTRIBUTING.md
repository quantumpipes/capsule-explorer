# Contributing to Capsule Explorer

Capsule Explorer is the in-browser verifier for
[agent-capsule](https://github.com/quantumpipes/agent-capsule) hashchains. It is
deliberately small: fetch a chain bundle, recompute the crypto client-side,
render the result. Keep it that way.

## Dev setup

```bash
npm install
npm run export      # build the chain bundle from ~/.agent-capsule/chains (needs Python 3 + PyNaCl)
npm run dev         # http://localhost:4840
```

No chains yet? Seal a session with
[agent-capsule](https://github.com/quantumpipes/agent-capsule) first, then
`npm run export` again. You can also point the exporter elsewhere:
`python3 scripts/export_chains.py --glob '/path/to/chains/*/*.db'`.

## Tests

```bash
npm run build && npm test
```

- `src/__tests__/verify.test.ts` recomputes SHA3-256 + Ed25519 over the real
  exported chains and asserts every chain verifies, a one-byte tamper breaks at
  the exact index, and a wrong public key is rejected. If you touch
  `src/lib/crypto.ts`, this must stay green.
- `src/__tests__/build-integrity.test.ts` checks the discovery and security
  surface (CSP, caching, canonical, Open Graph).

## Project layout

| Path | Role |
|------|------|
| `src/lib/crypto.ts` | The three client-side checks (hash, signature, link). The trust core. |
| `src/lib/data-source.ts` | Fetch and parse the chain bundle (static and live modes). |
| `src/lib/types.ts` | Chain and capsule shapes. |
| `src/components/explorer/Explorer.tsx` | The three-pane UI: chains rail, timeline, capsule detail. |
| `scripts/export_chains.py` | Reads `~/.agent-capsule/chains` SQLite into the JSON bundle. |

## Conventions

- Keep the crypto auditable: only `@noble/hashes` and `@noble/ed25519` do crypto,
  and the verifier must match agent-capsule's
  [wire-format](https://github.com/quantumpipes/agent-capsule/blob/main/docs/wire-format.md)
  exactly. Never re-serialize a capsule; always hash the shipped `canonical` bytes.
- No em dashes or en dashes in docs (use commas, colons, periods, semicolons,
  parentheses).
- Conventional commit messages (feat, fix, docs, refactor, test).
- The static path is the canonical one. Anything that needs a backend belongs in
  the optional live mode, never the default.

## License

By contributing you agree your contributions are licensed under Apache-2.0.
Copyright 2026 Quantum Pipes Technologies, LLC.
