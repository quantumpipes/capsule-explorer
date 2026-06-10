# How verification works

Capsule Explorer re-verifies a capsule hashchain entirely in your browser, offline. There is no backend to trust, no API call to authenticate, and nothing to install. This page walks through exactly what runs, in the order it runs, so you can read the code and confirm it for yourself.

The verifier lives in [`src/lib/crypto.ts`](../src/lib/crypto.ts). The parse and load path lives in [`src/lib/data-source.ts`](../src/lib/data-source.ts). The UI that drives them is [`src/components/explorer/Explorer.tsx`](../src/components/explorer/Explorer.tsx).

## The three checks

A chain is one ordered line of capsules. Each capsule is verified against three independent properties. A capsule passes only when all three pass, and the chain is valid only when every capsule passes.

### 1. Hash

Recompute `SHA3-256` over the capsule's exact `canonical` bytes and compare it to the stored `hash`.

```ts
import { sha3_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export function recomputeHash(canonical: string): string {
  return bytesToHex(sha3_256(utf8ToBytes(canonical)));
}

export function verifyHash(canonical: string, storedHash: string): boolean {
  return recomputeHash(canonical) === storedHash;
}
```

If a single byte of the capsule's content changed after sealing, this hash changes, and the check fails.

### 2. Signature

`Ed25519`-verify the `signature` over the UTF-8 of the `hash` **hex string** (not the raw hash bytes), against the signer's public key. This mirrors agent-capsule's Seal exactly: the signer signs the hex string of the hash.

The key is resolved per capsule from its `signed_by` fingerprint against the bundle's `keys` map (the **keyring**), falling back to the top-level `public_key`. A bundle can therefore carry chains from more than one signer (an imported chain, a rotated key, a peer) and still verify every one of them offline. See [`keyResolver` in crypto.ts](../src/lib/crypto.ts).

```ts
import { sha512 } from "@noble/hashes/sha512";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";

// @noble/ed25519 v2 needs SHA-512 wired in for synchronous verification.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export function verifySignature(
  hashHex: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    if (!signatureHex || !publicKeyHex || !hashHex) return false;
    return ed.verify(hexToBytes(signatureHex), utf8ToBytes(hashHex), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
```

A wrong public key, a forged signature, or a hash that does not match what was signed all fail this check.

### 3. Link

Each capsule must point back to the one before it, and the sequence must be unbroken from genesis.

```ts
const linkOk =
  cap.sequence === index &&
  (prev === null ? cap.previous_hash == null : cap.previous_hash === prev.hash);
```

The genesis capsule (sequence `0`) has no `previous_hash`. Every later capsule stores the prior capsule's `hash`. Because the hash covers the content, changing any capsule changes its hash, which breaks the `previous_hash` link of the next capsule, and so on down the chain. You cannot delete, reorder, or insert a record in the middle without breaking every link after it.

## Verifying the whole chain

`verifyChain` walks the capsules in order, runs the three checks per capsule, and records the first index that fails:

```ts
export function verifyChain(chain: Chain, publicKey: string): ChainVerdict {
  const results: CapsuleVerdict[] = [];
  let brokenAt: number | null = null;
  chain.capsules.forEach((cap, i) => {
    const v = verifyCapsule(cap, i === 0 ? null : chain.capsules[i - 1], i, publicKey);
    results.push(v);
    if (!v.ok && brokenAt === null) brokenAt = i;
  });
  return {
    valid: brokenAt === null,
    verified: brokenAt === null ? results.length : brokenAt,
    brokenAt,
    results,
  };
}
```

The verdict the UI renders is: every capsule passed (`valid: true`, all green), or it broke at `brokenAt` (the timeline scrolls there and everything from that index on goes red).

## Why the bundle ships `canonical` bytes

A signature is over specific bytes. If the browser re-serialized a capsule from parsed fields, it might produce different bytes (key order, whitespace, number formatting) than the signer used, and the hash would not match even for an honest chain.

So the exporter ships the **exact** `canonical` bytes the signer hashed. The browser hashes those bytes verbatim. Every human-readable field shown in the UI is parsed out of `canonical` client-side; the canonical bytes themselves are never reconstructed. See [`parseCapsule` in data-source.ts](../src/lib/data-source.ts):

```ts
export function parseCapsule(raw: RawCapsule): Capsule {
  let d: Record<string, unknown> = {};
  try {
    d = JSON.parse(raw.canonical) as Record<string, unknown>;
  } catch {
    d = {};
  }
  // ...display fields parsed from `canonical`; raw.canonical kept verbatim for hashing
}
```

The exact byte layout (canonical JSON rules, hashing input, signature scheme) is pinned in agent-capsule's [wire-format.md](https://github.com/quantumpipes/agent-capsule/blob/main/docs/wire-format.md). The two implementations agree because they hash the same bytes.

## The data-source flow

```
public/data/chains/index.json      loadIndex()  -> chain summaries + public_key + keys (keyring) + meta
public/data/chains/<id>.json       loadChain(id) -> RawChain { capsules: RawCapsule[] }
                                                    -> parseCapsule() per capsule
                                                    -> Chain { capsules: Capsule[] }
                                   verifyChain(chain, keyResolver(index.keys, index.public_key))
public/data/chains/meta.json       loadMeta()   -> the meta-chain (chain-of-conversations)
```

`loadIndex` and `loadChain` fetch the static JSON in the default (static) mode. The keys signatures are checked against come from `index.json`'s `keys` map (the keyring), written by the exporter from `~/.agent-capsule/key`'s public half plus any registered known keys. In live mode (`PUBLIC_CAPSULE_API` set) the same shapes come from a server and verification is delegated to that server's `verify-chain` endpoint, because the client-side crypto needs the canonical bytes the static export carries.

## The meta-chain

`meta.json` is a second hashchain whose capsules each seal one conversation: they record that conversation's head hash and capsule count. Because the meta-chain is itself hash-linked, its single head commits to every conversation ever sealed. The Explorer verifies it the same way (hashes, links, signatures via the keyring) and cross-checks each seal against the chains actually present in the bundle: a head that matches is **intact**, one that differs is **changed** (the conversation grew or was truncated), and one with no matching chain is **missing** (the conversation was deleted). This closes the two gaps a per-conversation chain cannot close alone: whole-conversation deletion and tail truncation.

## The tamper test

Static mode includes a one-click tamper test so you can watch the chain catch a change. It clones the loaded chain, appends a single space to one capsule's `canonical` bytes (near the middle), and lets you re-verify:

```ts
const runTamper = useCallback(() => {
  if (!chain) return;
  const caps = chain.capsules.map((c) => ({ ...c }));
  const idx = Math.min(Math.floor(caps.length / 2), caps.length - 1);
  caps[idx] = { ...caps[idx], canonical: caps[idx].canonical + " " };
  setWorking(caps);
  // ...
}, [chain]);
```

That extra byte changes the `SHA3-256` of that capsule, so its hash check fails, its signature no longer matches the recomputed hash, and the next capsule's `previous_hash` link breaks. Re-verifying surfaces `brokenAt` at that index, scrolls the timeline to it, and turns it and everything after it red. **Restore** drops the working copy back to the original. Nothing is written to disk; the tamper exists only in browser memory.

## Run the checks against the real chains

The test suite re-verifies your actual exported chains, not fixtures:

```bash
npm run build && npm test
```

`verify.test.ts` recomputes SHA3-256 and Ed25519 over the real exported bundle, asserts every chain verifies, that a one-byte tamper breaks at the exact index, and that a wrong public key is rejected.
