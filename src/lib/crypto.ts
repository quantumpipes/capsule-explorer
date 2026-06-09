// Client-side cryptographic verification of capsule hashchains.
//
// Mirrors qp-capsule's Seal exactly:
//   hash      = SHA3-256( canonical_json_utf8 ).hex()
//   signature = Ed25519.sign( utf8( hash_hex_string ) )     <- signs the HEX STRING
// so verification recomputes the SHA3-256 over the exact canonical bytes the
// exporter captured, then verifies the Ed25519 signature over that hex string.
// Everything runs in the browser; no network, no backend.

import { sha3_256 } from "@noble/hashes/sha3";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";
import type { Capsule, Chain, ChainVerdict, CapsuleVerdict } from "./types";

// @noble/ed25519 v2 needs SHA-512 wired in for synchronous verification.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export function recomputeHash(canonical: string): string {
  return bytesToHex(sha3_256(utf8ToBytes(canonical)));
}

export function verifyHash(canonical: string, storedHash: string): boolean {
  return recomputeHash(canonical) === storedHash;
}

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

// Resolve the public key for a capsule from its signer fingerprint (`signed_by`).
// Chains imported from a different or rotated key carry a fingerprint that maps,
// via the bundled keyring, to the right key; everything else falls back to the
// bundle's own public key.
export type KeyResolver = (signedBy?: string) => string;

export function keyResolver(
  keys: Record<string, string> | undefined,
  fallback: string,
): KeyResolver {
  return (signedBy?: string) => (signedBy && keys?.[signedBy]) || fallback;
}

export function verifyCapsule(
  cap: Capsule,
  prev: Capsule | null,
  index: number,
  resolveKey: KeyResolver,
): CapsuleVerdict {
  const hashOk = verifyHash(cap.canonical, cap.hash);
  const sigOk = verifySignature(cap.hash, cap.signature, resolveKey(cap.signed_by));
  const linkOk =
    cap.sequence === index &&
    (prev === null ? cap.previous_hash == null : cap.previous_hash === prev.hash);
  return { sequence: cap.sequence, id: cap.id, hashOk, sigOk, linkOk, ok: hashOk && sigOk && linkOk };
}

export function verifyChain(chain: Chain, resolveKey: KeyResolver): ChainVerdict {
  const results: CapsuleVerdict[] = [];
  let brokenAt: number | null = null;
  chain.capsules.forEach((cap, i) => {
    const v = verifyCapsule(cap, i === 0 ? null : chain.capsules[i - 1], i, resolveKey);
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
