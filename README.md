<div align="center">

# 🔍 Capsule Explorer

### Re-verify any AI coding agent's session, in your browser, offline.

A static site that recomputes every SHA3-256 hash and checks every Ed25519
signature of a capsule hashchain, client-side, with no backend and nothing to
trust but the math. It is the companion verifier for
[**agent-capsule**](https://github.com/quantumpipes/agent-capsule), which seals
**Claude Code, Cursor, Codex, and Cline** sessions into tamper-evident chains.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Verify](https://img.shields.io/badge/verify-in%20your%20browser-9cf.svg)](#run)
[![Crypto](https://img.shields.io/badge/crypto-SHA3--256%20%2B%20Ed25519-2ea44f.svg)](https://github.com/quantumpipes/agent-capsule/blob/main/docs/wire-format.md)

</div>

The headline capability: the page **re-verifies the entire chain in your
browser**. It recomputes SHA3-256 over each capsule's canonical bytes and
verifies the Ed25519 signature (`@noble/hashes` + `@noble/ed25519`), then checks
`previous_hash` linkage and sequence order. No network, no trust required. Flip
one byte and it scrolls straight to the break.

It is **tool-agnostic**: a capsule is a capsule, whatever produced it. Chains
from every agent show up side by side, each tagged with its tool.

## Data flow

```
~/.agent-capsule/chains/<tool>/*.db    (per-session chains, written by agent-capsule)
   |                                    tool = claude-code | cursor | codex | cline
   v
scripts/export_chains.py               (reads SQLite -> JSON; includes the exact
   |                                    canonical bytes + the Ed25519 public key)
   v
public/data/chains/index.json          (chain summaries + public key + tools)
public/data/chains/<chain-id>.json     (per chain, loaded on demand)
   v
src/lib/data-source.ts -> src/lib/crypto.ts (in-browser verify) -> Explorer.tsx
```

## Run

```bash
npm install
npm run export      # regenerate public/data/chains from ~/.agent-capsule/chains
npm run dev         # http://localhost:4840
```

`npm run export` runs `python3 scripts/export_chains.py`, which needs Python 3
with PyNaCl (`pip install PyNaCl`). It reads `~/.agent-capsule/chains/*/*.db` by
default; pass `--db PATH` or `--glob PAT` to point elsewhere. (You can also run
`agent-capsule export --out public/data/chains` from the agent-capsule package.)

## Tests

```bash
npm run build && npm test
```

- `verify.test.ts`: recomputes SHA3-256 + Ed25519 over the real exported chains,
  asserts every chain verifies, a one-byte tamper breaks at the exact index, and
  a wrong public key is rejected.
- `build-integrity.test.ts`: discovery/security surface, CSP + immutable caching,
  canonical + JSON-LD + OG.

## Layout

App shell: a slim top bar over a full-height three-pane master-detail view
(chains rail tagged by tool, capsule timeline, capsule detail). In-chain search,
type filters, deep-linking (`?chain=id`), copy-hash, and scroll-to-break on
tamper.

## License

Apache License 2.0. Copyright 2026 Quantum Pipes Technologies, LLC.
