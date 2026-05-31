# Changelog

All notable changes to Capsule Explorer are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow semantic versioning.

## [Unreleased]

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
