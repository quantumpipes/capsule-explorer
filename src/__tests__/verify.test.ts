import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCapsule } from "@/lib/data-source";
import { verifyChain, keyResolver } from "@/lib/crypto";
import type { ChainIndex, RawChain } from "@/lib/types";

const dir = join(process.cwd(), "public", "data", "chains");
const indexPath = join(dir, "index.json");
const hasData = existsSync(indexPath);

function load(id: string) {
  const raw = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")) as RawChain;
  return { ...raw, capsules: raw.capsules.map(parseCapsule) };
}

describe.skipIf(!hasData)("client-side chain verification (real exported data)", () => {
  const index = hasData ? (JSON.parse(readFileSync(indexPath, "utf8")) as ChainIndex) : null;

  it(
    "recomputes SHA3-256 + Ed25519 and chains verify end to end",
    () => {
      // The exported corpus can be large (the hook keeps appending across live
      // sessions). Verify smallest-first up to a capsule budget so the test is
      // fast and deterministic while still covering many full chains.
      const BUDGET = 2000;
      const resolve = keyResolver(index!.keys, index!.public_key);
      const ordered = [...index!.chains].sort((a, b) => a.length - b.length);
      let spent = 0;
      let covered = 0;
      for (const summary of ordered) {
        if (spent + summary.length > BUDGET && covered > 0) break;
        const chain = load(summary.id);
        const v = verifyChain(chain, resolve);
        expect(v.valid, `chain ${summary.id} should be valid`).toBe(true);
        expect(v.verified).toBe(chain.capsules.length);
        expect(v.brokenAt).toBeNull();
        spent += summary.length;
        covered++;
      }
      expect(covered).toBeGreaterThan(0);
    },
    30_000,
  );

  it("detects a one-byte tamper at the exact capsule index", () => {
    const summary = index!.chains[index!.chains.length - 1]; // smallest chain
    const chain = load(summary.id);
    const mid = Math.floor(chain.capsules.length / 2);
    chain.capsules[mid] = { ...chain.capsules[mid], canonical: chain.capsules[mid].canonical + " " };
    const v = verifyChain(chain, keyResolver(index!.keys, index!.public_key));
    expect(v.valid).toBe(false);
    expect(v.brokenAt).toBe(mid);
  });

  it("rejects the chain under the wrong public key", () => {
    const chain = load(index!.chains[index!.chains.length - 1].id);
    const v = verifyChain(chain, () => "00".repeat(32));
    expect(v.valid).toBe(false);
  });

  it("verifies the meta-chain and confirms every conversation is intact", () => {
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath)) return; // no meta-chain in this bundle
    const raw = JSON.parse(readFileSync(metaPath, "utf8")) as RawChain;
    const meta = { ...raw, capsules: raw.capsules.map(parseCapsule) };

    // The meta-chain itself verifies (hashes, links, and signatures via keyring).
    const v = verifyChain(meta, keyResolver(index!.keys, index!.public_key));
    expect(v.valid, "meta-chain should verify end to end").toBe(true);

    // Every seal's recorded head matches a conversation actually in the bundle.
    const heads = new Map(index!.chains.map((c) => [c.id, c.head_hash]));
    let intact = 0;
    for (const cap of meta.capsules) {
      const r = (cap.outcome?.result ?? {}) as Record<string, unknown>;
      if (r.kind !== "conversation_seal") continue;
      const id = `claude-code-${String(r.session_id)}`;
      if (heads.get(id) === String(r.head_hash)) intact += 1;
    }
    expect(intact).toBe(index!.chain_count);
  });
});
