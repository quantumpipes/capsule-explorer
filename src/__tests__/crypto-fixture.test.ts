// Deterministic crypto coverage against a tiny committed fixture bundle, so CI
// verifies hashing, the keyring, tamper detection, and the meta-chain without
// needing the (gitignored, multi-hundred-MB) real exported corpus.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCapsule } from "@/lib/data-source";
import { verifyChain, keyResolver } from "@/lib/crypto";
import type { ChainIndex, RawChain } from "@/lib/types";

const dir = join(process.cwd(), "src", "__tests__", "fixtures", "bundle");
const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as ChainIndex;
const load = (id: string) => {
  const raw = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as RawChain;
  return { ...raw, capsules: raw.capsules.map(parseCapsule) };
};
const resolve = keyResolver(index.keys, index.public_key);

describe("crypto (committed fixture bundle)", () => {
  it("every chain verifies end to end via the keyring", () => {
    expect(index.chains.length).toBeGreaterThan(0);
    for (const s of index.chains) {
      const v = verifyChain(load(s.id), resolve);
      expect(v.valid, `chain ${s.id} should verify`).toBe(true);
      expect(v.brokenAt).toBeNull();
    }
  });

  it("detects a one-byte tamper at the exact capsule index", () => {
    const chain = load(index.chains[0].id);
    const mid = Math.floor(chain.capsules.length / 2);
    chain.capsules[mid] = { ...chain.capsules[mid], canonical: chain.capsules[mid].canonical + " " };
    const v = verifyChain(chain, resolve);
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(mid);
  });

  it("rejects the chain under the wrong public key", () => {
    const v = verifyChain(load(index.chains[0].id), () => "00".repeat(32));
    expect(v.valid).toBe(false);
  });

  it("verifies the meta-chain and confirms every conversation is intact", () => {
    const raw = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as RawChain;
    const meta = { ...raw, capsules: raw.capsules.map(parseCapsule) };
    expect(verifyChain(meta, resolve).valid).toBe(true);

    const heads = new Map(index.chains.map((c) => [c.id, c.head_hash]));
    let intact = 0;
    for (const cap of meta.capsules) {
      const r = (cap.outcome?.result ?? {}) as Record<string, unknown>;
      if (r.kind !== "conversation_seal") continue;
      if (heads.get(`claude-code-${String(r.session_id)}`) === String(r.head_hash)) intact += 1;
    }
    expect(intact).toBe(index.chain_count);
  });
});
