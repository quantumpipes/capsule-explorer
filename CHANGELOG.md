# Changelog

All notable changes to Capsule Explorer are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow semantic versioning.

## [Unreleased]

## [0.2.0] - 2026-06-09

The keyring + meta-chain + deep-dive release.

### Added

- **Keyring verification.** Each capsule is verified against its own signer,
  resolved from the bundle's `keys` map by the capsule's `signed_by` fingerprint
  (falling back to the bundle public key). Chains from imported or rotated keys
  now verify green, not just the local key. New `keyResolver` in `crypto.ts`.
- **Meta-chain view.** A chain-of-conversations surface: each row is one sealed
  conversation with an intact / changed / missing cross-check against the chains
  present in the bundle, in-browser verification, and click-through to the
  conversation.
- **Capsule deep dive.** A full-canvas modal (Expand button, or `E`) showing
  every section with room to breathe, the exact signed bytes with a live
  SHA3-256 match check, and the full cryptographic seal, all copyable.
- **Newest-first ordering.** Capsule timeline defaults to newest-first with an
  order toggle; chains are sorted by recency with relative dates.

### Fixed

- Detail pane no longer overflows horizontally on long paths / UUIDs
  (`min-w-0` + `overflow-wrap: anywhere`).

### Tests

- Added a committed fixture bundle and `crypto-fixture.test.ts` so CI verifies
  hashing, the keyring, tamper detection, and the meta-chain without the
  multi-hundred-MB real corpus.

## [0.1.0] - 2026-05-31

Initial standalone release, extracted from the agent-capsule repository into its
own project.

### Added
- In-browser, offline verification of capsule hashchains: recompute SHA3-256 over
  each capsule's canonical bytes, verify the Ed25519 signature, and check
  `previous_hash` linkage and sequence order, all client-side with audited
  `@noble` libraries.
- Tool-agnostic chains rail: sessions from Claude Code, Cursor, Codex, and Cline
  appear side by side, each tagged with its tool.
- Three-pane master-detail UI (chains rail, capsule timeline, six-section capsule
  detail) with in-chain search, type filters, deep-linking, copy-hash, and a
  tamper test that scrolls to the exact break.
- Self-contained `scripts/export_chains.py` that reads
  `~/.agent-capsule/chains/<tool>/*.db` into the static JSON bundle.
- Static (default, air-gapped) and live (`PUBLIC_CAPSULE_API`) data modes.
- Documentation: how-it-works and deploying guides.
