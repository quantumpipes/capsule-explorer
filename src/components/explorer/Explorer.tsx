import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowDownUp,
  Boxes,
  Brain,
  Code2,
  Maximize2,
  Network,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  Fingerprint,
  Link2,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { loadChain, loadIndex, loadMeta, metaEntry, MODE, verifyOnServer } from "@/lib/data-source";
import { verifyChain, verifyHash, keyResolver } from "@/lib/crypto";
import type { Capsule, Chain, ChainIndex, ChainVerdict, CapsuleVerdict, MetaEntry } from "@/lib/types";

/* ------------------------------------------------------------------ helpers */

const TYPE_STYLE: Record<string, { dot: string; chip: string }> = {
  agent: { dot: "bg-info-400", chip: "bg-info-500/10 text-info-400 ring-info-500/20" },
  tool: { dot: "bg-accent-400", chip: "bg-accent-500/10 text-accent-400 ring-accent-500/20" },
  chat: { dot: "bg-success-400", chip: "bg-success-500/10 text-success-400 ring-success-500/20" },
  system: { dot: "bg-violet-400", chip: "bg-violet-500/10 text-violet-300 ring-violet-500/20" },
  workflow: { dot: "bg-primary-400", chip: "bg-primary-500/10 text-primary-400 ring-primary-500/20" },
  vault: { dot: "bg-warning-400", chip: "bg-warning-500/10 text-warning-400 ring-warning-500/20" },
};
const typeStyle = (t: string) =>
  TYPE_STYLE[t] ?? { dot: "bg-slate-400", chip: "bg-slate-500/10 text-slate-300 ring-slate-500/20" };

const short = (h: string | null | undefined, n = 10) => (h ? h.slice(0, n) : "genesis");

/** Compact relative date for chain recency: "3h ago", "2d ago", or "Jun 9". */
function relDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function str(v: unknown, max = 800): string {
  if (v == null) return "";
  if (typeof v === "string") return v.length > max ? v.slice(0, max) + "…" : v;
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(v);
  }
}

function asNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function tokensOf(cap: Capsule): { input: number; output: number } {
  const ru = (cap.execution?.resources_used ?? {}) as Record<string, unknown>;
  return { input: asNum(ru.input_tokens), output: asNum(ru.output_tokens) };
}
function reasonedOf(cap: Capsule): { blocks: number; redacted: boolean; sigs: string[] } {
  const env = (cap.context?.environment ?? {}) as Record<string, unknown>;
  return {
    blocks: asNum(env.thinking_blocks),
    redacted: Boolean(env.thinking_redacted),
    sigs: Array.isArray(env.thinking_signatures) ? (env.thinking_signatures as string[]) : [],
  };
}
function authorityOf(cap: Capsule): string {
  return String((cap.authority as Record<string, unknown>)?.type ?? "");
}

function Copyable({ value, children, className = "" }: { value: string; children: React.ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 900);
        });
      }}
      title="Copy"
      className={`inline-flex items-center gap-1 rounded hover:text-slate-200 ${className}`}
    >
      {children}
      {done ? <CheckCircle2 className="h-3 w-3 text-success-400" /> : <Copy className="h-3 w-3 opacity-50" />}
    </button>
  );
}

function KeyVals({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data || {}).filter(([, v]) => {
    if (v == null || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) return false;
    return true;
  });
  if (entries.length === 0) return <p className="text-xs italic text-slate-600">empty</p>;
  return (
    <dl className="grid gap-2">
      {entries.map(([k, v]) => {
        // Objects/arrays get a full-width block so nested JSON has room to breathe;
        // scalars stay in the compact label/value grid. min-w-0 + overflow-wrap let
        // long paths and UUIDs wrap instead of forcing a horizontal scrollbar.
        const isBlock = typeof v === "object" && v !== null;
        return (
          <div
            key={k}
            className={
              isBlock
                ? "min-w-0"
                : "grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-start gap-3"
            }
          >
            <dt className="pt-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="mt-1 min-w-0 whitespace-pre-wrap font-mono text-xs text-slate-300 [overflow-wrap:anywhere]">
              {str(v, isBlock ? 4000 : 800)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const SECTIONS: { key: keyof Capsule; name: string; icon: typeof Zap; color: string }[] = [
  { key: "trigger", name: "Trigger", icon: Zap, color: "text-rose-400" },
  { key: "context", name: "Context", icon: Database, color: "text-sky-400" },
  { key: "reasoning", name: "Reasoning", icon: Brain, color: "text-violet-400" },
  { key: "authority", name: "Authority", icon: UserCheck, color: "text-amber-400" },
  { key: "execution", name: "Execution", icon: Play, color: "text-emerald-400" },
  { key: "outcome", name: "Outcome", icon: CheckCircle2, color: "text-cyan-400" },
];

function VerdictPips({ v }: { v: CapsuleVerdict | undefined }) {
  if (!v) return null;
  const pip = (ok: boolean, label: string) => (
    <span
      title={`${label}: ${ok ? "valid" : "invalid"}`}
      className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9px] ring-1 ${
        ok ? "bg-success-500/10 text-success-400 ring-success-500/20" : "bg-error-500/10 text-error-400 ring-error-500/20"
      }`}
    >
      {ok ? "✓" : "✗"}
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {pip(v.hashOk, "sha3")}
      {pip(v.sigOk, "ed25519")}
      {pip(v.linkOk, "link")}
    </div>
  );
}

type Highlight = "none" | "ok" | "fail" | "pending";

/* ---------------------------------------------------------- timeline item */

function CapsuleListItem({
  cap,
  index,
  selected,
  verdict,
  highlight,
  onSelect,
}: {
  cap: Capsule;
  index: number;
  selected: boolean;
  verdict: CapsuleVerdict | undefined;
  highlight: Highlight;
  onSelect: () => void;
}) {
  const ts = typeStyle(cap.type);
  const summary = str((cap.outcome?.summary as string) || (cap.trigger?.request as string) || "", 90);
  const reasoned = reasonedOf(cap).blocks > 0;
  const node =
    highlight === "ok"
      ? "border-success-400 bg-success-500/20 text-success-300 shadow-[0_0_14px_rgba(34,197,94,0.45)]"
      : highlight === "fail"
        ? "border-error-400 bg-error-500/20 text-error-300 shadow-[0_0_14px_rgba(239,68,68,0.5)]"
        : highlight === "pending"
          ? "border-primary-400 bg-primary-500/10 text-primary-300"
          : "border-white/15 bg-surface-2 text-slate-400";

  return (
    <div id={`cap-${index}`} className="relative scroll-mt-4 pl-10">
      <motion.div
        layout
        className={`absolute left-1.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] transition-colors duration-300 ${node}`}
      >
        {cap.sequence}
      </motion.div>
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
          selected
            ? "border-primary-500/50 bg-primary-500/[0.07]"
            : "border-white/[0.06] bg-surface-1/50 hover:border-white/15 hover:bg-white/[0.02]"
        }`}
      >
        <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${ts.chip}`}>
          {cap.type}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200">
          {summary || <span className="text-slate-600">·</span>}
        </span>
        {reasoned && (
          <span title="reasoned before this action" className="shrink-0">
            <Brain className="h-3.5 w-3.5 text-violet-400/70" />
          </span>
        )}
        <VerdictPips v={verdict} />
        <ChevronRight className={`h-4 w-4 shrink-0 transition-colors ${selected ? "text-primary-400" : "text-slate-600"}`} />
      </button>
    </div>
  );
}

/* --------------------------------------------------------------- detail pane */

function CapsuleDetail({
  cap,
  verdict,
  onClose,
  onExpand,
}: {
  cap: Capsule | null;
  verdict: CapsuleVerdict | undefined;
  onClose?: () => void;
  onExpand?: () => void;
}) {
  if (!cap) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Boxes className="mb-3 h-8 w-8 text-slate-700" />
        <p className="font-display text-sm text-slate-500">Select a capsule</p>
        <p className="mt-1 max-w-[220px] text-xs text-slate-600">
          Inspect its six sections and cryptographic seal.
        </p>
      </div>
    );
  }
  const ts = typeStyle(cap.type);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${ts.chip}`}>
          {cap.type}
        </span>
        <span className="font-mono text-xs text-slate-500">#{cap.sequence}</span>
        <VerdictPips v={verdict} />
        {onExpand && (
          <button
            onClick={onExpand}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-primary-500/40 hover:text-primary-300"
            title="Expand capsule (deep dive) · E"
            aria-label="Expand capsule"
          >
            <Maximize2 className="h-3 w-3" /> Expand
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className={`rounded p-1 text-slate-500 hover:text-slate-200 lg:hidden ${onExpand ? "" : "ml-auto"}`} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-4">
        {(() => {
          const rz = reasonedOf(cap);
          const tk = tokensOf(cap);
          const auth = authorityOf(cap);
          const model = String((cap.reasoning as Record<string, unknown>)?.model ?? "");
          const chip = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1";
          return (
            <div className="flex flex-wrap gap-2">
              {rz.blocks > 0 && (
                <span
                  title={`Claude Code redacts thinking text; ${rz.sigs.length} signature(s) prove the model reasoned here`}
                  className={`${chip} bg-violet-500/10 text-violet-300 ring-violet-500/20`}
                >
                  <Brain className="h-3 w-3" /> reasoned · {rz.blocks} block{rz.blocks > 1 ? "s" : ""}
                  {rz.redacted && <span className="opacity-60">(redacted)</span>}
                </span>
              )}
              {tk.input + tk.output > 0 && (
                <span className={`${chip} bg-slate-500/10 text-slate-300 ring-white/10`} title="input → output tokens">
                  {fmt(tk.input)} → {fmt(tk.output)} tok
                </span>
              )}
              {auth && (
                <span className={`${chip} ${auth === "autonomous" ? "bg-amber-500/10 text-amber-300 ring-amber-500/20" : "bg-info-500/10 text-info-300 ring-info-500/20"}`} title="authority / permission posture">
                  <UserCheck className="h-3 w-3" /> {auth}
                </span>
              )}
              {model && <span className={`${chip} bg-slate-500/10 text-slate-400 ring-white/10`}>{model}</span>}
            </div>
          );
        })()}
        {SECTIONS.map(({ key, name, icon: Icon, color }) => (
          <div key={name} className="rounded-lg border border-white/[0.06] bg-surface-0/60 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icon className={`h-3.5 w-3.5 ${color}`} />
              <h4 className="font-display text-[11px] font-semibold uppercase tracking-wider text-slate-300">{name}</h4>
            </div>
            <KeyVals data={cap[key] as Record<string, unknown>} />
          </div>
        ))}
        <div className="rounded-lg border border-primary-500/20 bg-primary-500/[0.04] p-3">
          <div className="mb-2 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-primary-400" />
            <h4 className="font-display text-[11px] font-semibold uppercase tracking-wider text-primary-300">Cryptographic Seal</h4>
          </div>
          <dl className="grid gap-1.5 font-mono text-[10px] text-slate-400">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <dt className="text-slate-500">hash</dt>
              <dd className="min-w-0"><Copyable value={cap.hash} className="break-all text-left text-slate-300">{short(cap.hash, 40)}…</Copyable></dd>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-2"><dt className="text-slate-500">prev</dt><dd className="break-all">{cap.previous_hash ?? "∅ genesis"}</dd></div>
            <div className="grid grid-cols-[80px_1fr] gap-2"><dt className="text-slate-500">sig</dt><dd className="break-all">{short(cap.signature, 40)}…</dd></div>
            <div className="grid grid-cols-[80px_1fr] gap-2"><dt className="text-slate-500">signed_by</dt><dd>{cap.signed_by || "n/a"}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- capsule deep dive */

// The full-canvas reveal: every section with room to breathe, plus the exact
// signed bytes laid bare with a live SHA3-256 check — proof that what you read
// is what was sealed. Esc or backdrop closes.
function CapsuleDeepDive({
  cap,
  verdict,
  onClose,
}: {
  cap: Capsule;
  verdict: CapsuleVerdict | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ts = typeStyle(cap.type);
  const rz = reasonedOf(cap);
  const tk = tokensOf(cap);
  const auth = authorityOf(cap);
  const model = String((cap.reasoning as Record<string, unknown>)?.model ?? "");
  const hashOk = verifyHash(cap.canonical, cap.hash);
  const headline = str(cap.trigger?.request, 240) || str(cap.outcome?.summary, 240) || `${cap.type} capsule`;
  const reduce = prefersReducedMotion();
  const chip = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ring-1";

  const sealRows: [string, string][] = [
    ["hash", cap.hash],
    ["previous", cap.previous_hash ?? "∅ genesis"],
    ["signature", cap.signature],
    ["signature_pq", cap.signature_pq || "—"],
    ["signed_by", cap.signed_by || "n/a"],
    ["signed_at", cap.signed_at || "—"],
  ];

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden border border-white/10 bg-surface-0 shadow-2xl shadow-black/60 sm:max-h-[90vh] sm:rounded-2xl"
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-3.5">
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${ts.chip}`}>{cap.type}</span>
          <span className="font-mono text-xs text-slate-500">#{cap.sequence}</span>
          <VerdictPips v={verdict} />
          <span className="ml-2 hidden min-w-0 flex-1 truncate text-sm text-slate-300 md:block">{headline}</span>
          <button
            onClick={onClose}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:border-white/20 hover:text-slate-200"
            aria-label="Close deep dive"
          >
            <X className="h-3.5 w-3.5" /> Close <span className="hidden font-mono text-[10px] text-slate-600 sm:inline">Esc</span>
          </button>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-5">
          <div className="flex flex-wrap gap-2">
            {rz.blocks > 0 && (
              <span className={`${chip} bg-violet-500/10 text-violet-300 ring-violet-500/20`}>
                <Brain className="h-3 w-3" /> reasoned · {rz.blocks} block{rz.blocks > 1 ? "s" : ""}
                {rz.redacted && <span className="opacity-60">(redacted)</span>}
              </span>
            )}
            {tk.input + tk.output > 0 && (
              <span className={`${chip} bg-slate-500/10 text-slate-300 ring-white/10`}>{fmt(tk.input)} → {fmt(tk.output)} tok</span>
            )}
            {auth && (
              <span className={`${chip} ${auth === "autonomous" ? "bg-amber-500/10 text-amber-300 ring-amber-500/20" : "bg-info-500/10 text-info-300 ring-info-500/20"}`}>
                <UserCheck className="h-3 w-3" /> {auth}
              </span>
            )}
            {model && <span className={`${chip} bg-slate-500/10 text-slate-400 ring-white/10`}>{model}</span>}
          </div>

          {/* six sections, two columns for breathing room (Miyazaki's ma) */}
          <div className="grid gap-3 lg:grid-cols-2">
            {SECTIONS.map(({ key, name, icon: Icon, color }) => (
              <div key={name} className="min-w-0 rounded-xl border border-white/[0.06] bg-surface-1/40 p-4">
                <div className="mb-2.5 flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                  <h4 className="font-display text-[11px] font-semibold uppercase tracking-wider text-slate-300">{name}</h4>
                </div>
                <KeyVals data={cap[key] as Record<string, unknown>} />
              </div>
            ))}
          </div>

          {/* the reveal: the exact bytes that were hashed and signed */}
          <div className="overflow-hidden rounded-xl border border-primary-500/20 bg-primary-500/[0.03]">
            <div className="flex flex-wrap items-center gap-2 border-b border-primary-500/15 px-4 py-2.5">
              <Code2 className="h-3.5 w-3.5 text-primary-400" />
              <h4 className="font-display text-[11px] font-semibold uppercase tracking-wider text-primary-300">Raw canonical · the exact signed bytes</h4>
              <span className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] ring-1 ${hashOk ? "text-success-300 ring-success-500/30" : "text-error-300 ring-error-500/30"}`}>
                {hashOk ? <ShieldCheck className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} SHA3-256 {hashOk ? "matches seal" : "MISMATCH"}
              </span>
              <Copyable value={cap.canonical} className="text-slate-400 hover:text-slate-200">copy</Copyable>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[11px] leading-relaxed text-slate-400 [overflow-wrap:anywhere]">{cap.canonical}</pre>
          </div>

          {/* full seal */}
          <div className="rounded-xl border border-white/[0.06] bg-surface-1/40 p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-primary-400" />
              <h4 className="font-display text-[11px] font-semibold uppercase tracking-wider text-slate-300">Cryptographic Seal</h4>
            </div>
            <dl className="grid gap-2 font-mono text-[11px]">
              {sealRows.map(([label, val]) => (
                <div key={label} className="grid min-w-0 grid-cols-[92px_minmax(0,1fr)] gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">
                    <Copyable value={val} className="text-left text-slate-300">{val}</Copyable>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* --------------------------------------------------------------- meta-chain */

type MetaStatus = "intact" | "changed" | "missing";
type MetaRow = MetaEntry & { status: MetaStatus; title: string; present: boolean };

const metaStatusStyle: Record<MetaStatus, { dot: string; label: string; ring: string }> = {
  intact: { dot: "bg-success-400", label: "intact", ring: "text-success-300 ring-success-500/25" },
  changed: { dot: "bg-warning-400", label: "changed", ring: "text-warning-300 ring-warning-500/25" },
  missing: { dot: "bg-error-400", label: "missing", ring: "text-error-300 ring-error-500/25" },
};

function MetaView({
  meta,
  rows,
  verdict,
  onVerify,
  onOpen,
}: {
  meta: Chain;
  rows: MetaRow[];
  verdict: ChainVerdict | null;
  onVerify: () => void;
  onOpen: (chainId: string) => void;
}) {
  const intact = rows.filter((r) => r.status === "intact").length;
  const issues = rows.length - intact;
  const ordered = useMemo(() => [...rows].reverse(), [rows]); // newest conversation first

  return (
    <section className="flex min-h-0 min-w-0 flex-col lg:col-span-2">
      {/* header */}
      <div className="border-b border-white/[0.06] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary-400" />
            <h1 className="font-display text-base font-bold text-slate-100">Meta-chain</h1>
          </div>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-slate-400">
            {rows.length} conversations
          </span>
          <button
            onClick={onVerify}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-primary-500/30 bg-primary-500/[0.08] px-3 py-1.5 text-sm font-semibold text-primary-200 transition-colors hover:border-primary-500/50"
          >
            <ShieldCheck className="h-4 w-4" /> Verify meta-chain
          </button>
          {verdict && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                verdict.valid
                  ? "border-success-500/30 bg-success-500/[0.06] text-success-300"
                  : "border-error-500/30 bg-error-500/[0.06] text-error-300"
              }`}
            >
              {verdict.valid ? <ShieldCheck className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {verdict.valid ? `${verdict.verified} links + signatures verified` : `broken at #${verdict.brokenAt}`}
            </span>
          )}
        </div>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-slate-400">
          One capsule per sealed conversation, each committing to that conversation's head hash. The
          meta-chain's single head proves the whole corpus is complete: delete or truncate any
          conversation and the seal recorded here no longer matches.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Link2 className="h-3 w-3" /> head <Copyable value={meta.head_hash} className="text-slate-300">{short(meta.head_hash, 24)}…</Copyable>
          </span>
          <span className="text-success-400">{intact} intact</span>
          {issues > 0 && <span className="text-warning-400">{issues} need attention</span>}
        </div>
      </div>

      {/* conversation seals */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-1.5">
          {ordered.map((r) => {
            const ss = metaStatusStyle[r.status];
            const v = verdict?.results[r.sequence];
            return (
              <button
                key={r.sequence}
                onClick={() => r.present && onOpen(r.chain_id)}
                disabled={!r.present}
                className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                  r.present
                    ? "border-white/[0.06] bg-surface-1/40 hover:border-primary-500/30 hover:bg-primary-500/[0.04]"
                    : "cursor-not-allowed border-error-500/20 bg-error-500/[0.03]"
                }`}
              >
                <span className="flex w-9 shrink-0 items-center gap-1.5 font-mono text-[10px] text-slate-500">
                  <span className={`h-2 w-2 rounded-full ${ss.dot}`} />
                  {r.sequence}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-slate-200">{r.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-slate-500">
                    <span className={`rounded px-1 py-0.5 uppercase tracking-wide ring-1 ${ss.ring}`}>{ss.label}</span>
                    <span>{r.capsule_count} capsules</span>
                    <span className="flex items-center gap-1"><Link2 className="h-2.5 w-2.5" />{short(r.head_hash, 12)}</span>
                    {v && (
                      <span className={v.ok ? "text-success-400" : "text-error-400"}>{v.ok ? "✓ sealed" : "✗ seal"}</span>
                    )}
                  </span>
                </span>
                {r.present && <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 group-hover:text-primary-400" />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ explorer */

const PAGE = 60;
const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function Explorer() {
  const [index, setIndex] = useState<ChainIndex | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [working, setWorking] = useState<Capsule[] | null>(null);
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [revealed, setRevealed] = useState(0);
  const [visible, setVisible] = useState(PAGE);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [tampered, setTampered] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [meta, setMeta] = useState<Chain | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [metaVerdict, setMetaVerdict] = useState<ChainVerdict | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    loadIndex().then(setIndex).catch((e) => setError(String(e.message ?? e)));
    loadMeta().then(setMeta).catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    if (!index || activeId || !index.chains.length) return;
    const fromUrl = new URLSearchParams(window.location.search).get("chain");
    const match = index.chains.find((c) => c.id === fromUrl);
    setActiveId(match ? match.id : index.chains[0].id);
  }, [index, activeId]);

  const selectChain = useCallback(async (id: string) => {
    timers.current.forEach(clearTimeout);
    setChain(null);
    setWorking(null);
    setVerdict(null);
    setPhase("idle");
    setRevealed(0);
    setVisible(PAGE);
    setSelectedSeq(null);
    setTampered(false);
    setQuery("");
    setTypeFilter("all");
    setServerMsg(null);
    try {
      const c = await loadChain(id);
      setChain(c);
      setWorking(c.capsules);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void selectChain(activeId);
    const url = new URL(window.location.href);
    url.searchParams.set("chain", activeId);
    window.history.replaceState({}, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const resolveKey = useMemo(
    () => keyResolver(index?.keys, index?.public_key ?? ""),
    [index],
  );

  // Cross-check each meta-chain seal against the conversation actually present in
  // the bundle: head matches = intact, differs = changed, absent = missing.
  const metaRows = useMemo<MetaRow[]>(() => {
    if (!meta || !index) return [];
    const byId = new Map(index.chains.map((c) => [c.id, c]));
    const rows: MetaRow[] = [];
    meta.capsules.forEach((cap, i) => {
      const e = metaEntry(cap, i);
      if (!e) return;
      const present = byId.get(e.chain_id);
      const status: MetaStatus = !present
        ? "missing"
        : present.head_hash === e.head_hash
          ? "intact"
          : "changed";
      rows.push({ ...e, status, present: !!present, title: present?.title ?? e.session_id });
    });
    return rows;
  }, [meta, index]);

  const runMetaVerify = useCallback(() => {
    if (meta) setMetaVerdict(verifyChain(meta, resolveKey));
  }, [meta, resolveKey]);

  const openChainFromMeta = useCallback((chainId: string) => {
    setShowMeta(false);
    setActiveId(chainId);
  }, []);

  const runVerify = useCallback(() => {
    if (!chain || !working || !index) return;
    timers.current.forEach(clearTimeout);

    if (MODE === "live") {
      setPhase("running");
      setServerMsg(null);
      verifyOnServer()
        .then((r) =>
          setServerMsg(
            r.valid
              ? `Server verified the chain · ${r.capsules_verified} capsules`
              : `Server reports a break${r.broken_at ? ` at ${r.broken_at.slice(0, 10)}` : ""}${r.error ? ` · ${r.error}` : ""}`,
          ),
        )
        .catch((e) => setServerMsg(`Server verify failed: ${(e as Error).message}`))
        .finally(() => setPhase("done"));
      return;
    }

    const c: Chain = { ...chain, capsules: working };
    const v = verifyChain(c, resolveKey);
    setVerdict(v);
    setPhase("running");
    setRevealed(0);
    const target = v.brokenAt === null ? c.capsules.length : v.brokenAt + 1;
    if (prefersReducedMotion()) {
      setRevealed(target);
      setPhase("done");
    } else {
      const steps = Math.min(target, 60);
      const stepMs = Math.max(12, Math.floor(700 / Math.max(steps, 1)));
      for (let i = 1; i <= steps; i++) {
        timers.current.push(window.setTimeout(() => setRevealed(i === steps ? target : i), i * stepMs));
      }
      timers.current.push(window.setTimeout(() => setPhase("done"), steps * stepMs + 120));
    }
    if (v.brokenAt !== null) {
      const at = v.brokenAt;
      timers.current.push(
        window.setTimeout(() => {
          setVisible((vis) => Math.max(vis, at + 6));
          setSelectedSeq(at);
          document.getElementById(`cap-${at}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 340),
      );
    }
  }, [chain, working, index, resolveKey]);

  const runTamper = useCallback(() => {
    if (!chain) return;
    const caps = chain.capsules.map((c) => ({ ...c }));
    const idx = Math.min(Math.floor(caps.length / 2), caps.length - 1);
    caps[idx] = { ...caps[idx], canonical: caps[idx].canonical + " " };
    setWorking(caps);
    setTampered(true);
    setPhase("idle");
    setVerdict(null);
    setRevealed(0);
  }, [chain]);

  const restore = useCallback(() => {
    if (!chain) return;
    setWorking(chain.capsules);
    setTampered(false);
    setVerdict(null);
    setPhase("idle");
    setRevealed(0);
  }, [chain]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const caps = working ?? [];
  const types = useMemo(() => {
    const s = new Set<string>();
    caps.forEach((c) => s.add(c.type));
    return ["all", ...Array.from(s).sort()];
  }, [caps]);

  const stats = useMemo(() => {
    let inTok = 0;
    let outTok = 0;
    let reasoned = 0;
    const byType: Record<string, number> = {};
    const tools = new Set<string>();
    for (const c of caps) {
      const t = tokensOf(c);
      inTok += t.input;
      outTok += t.output;
      if (reasonedOf(c).blocks > 0) reasoned += 1;
      byType[c.type] = (byType[c.type] ?? 0) + 1;
      const tc = c.execution?.tool_calls?.[0]?.tool;
      if (tc) tools.add(tc);
    }
    return { inTok, outTok, reasoned, byType, tools: tools.size };
  }, [caps]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = caps
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => typeFilter === "all" || c.type === typeFilter)
      .filter(({ c }) => {
        if (!q) return true;
        const hay = `${c.type} ${str(c.outcome?.summary, 200)} ${str(c.trigger?.request, 200)} ${c.hash}`.toLowerCase();
        return hay.includes(q);
      });
    // Display newest-first by default; `i` stays the canonical sequence index so
    // verification, links, and selection are unaffected by display order.
    return order === "newest" ? list.reverse() : list;
  }, [caps, query, typeFilter, order]);
  const filtering = query.trim() !== "" || typeFilter !== "all";

  const verdictByIdx = useMemo(() => {
    const m = new Map<number, CapsuleVerdict>();
    verdict?.results.forEach((r, i) => m.set(i, r));
    return m;
  }, [verdict]);

  const highlightFor = (i: number): Highlight => {
    if (phase === "idle" || !verdict) return "none";
    const r = verdictByIdx.get(i);
    if (verdict.brokenAt !== null && i >= verdict.brokenAt) return phase === "done" ? "fail" : "pending";
    if (i < revealed) return r && r.ok ? "ok" : "fail";
    return phase === "running" ? "pending" : "none";
  };

  const selectedCap = selectedSeq != null ? caps[selectedSeq] ?? null : null;

  // Press E to expand the selected capsule into the deep dive (ignore while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (selectedCap) setExpanded(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCap]);

  /* ----------------------------------------------------------------- render */

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-error-500/30 bg-error-500/5 p-6 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-error-400" />
          <p className="font-display text-lg text-slate-200">Could not load chains</p>
          <p className="mt-2 font-mono text-sm text-slate-400">{error}</p>
          <p className="mt-4 text-sm text-slate-500">
            Run <code className="text-primary-400">npm run export</code> to generate the chain bundle.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,400px)]">
      {/* ---------- chains rail ---------- */}
      <aside className="hidden min-h-0 flex-col border-r border-white/[0.06] bg-surface-1/30 lg:flex">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-400">Chains</h2>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[9px] text-slate-500">{MODE}</span>
        </div>
        {meta && (
          <div className="px-3 pb-2">
            <button
              onClick={() => setShowMeta(true)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all ${
                showMeta ? "border-primary-500/40 bg-primary-500/[0.08]" : "border-white/[0.06] bg-surface-1/40 hover:border-white/15"
              }`}
            >
              <Network className="h-4 w-4 shrink-0 text-primary-400" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-slate-200">Meta-chain</span>
                <span className="block font-mono text-[9px] text-slate-500">{meta.length} conversations · 1 head</span>
              </span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.all_hashes_ok ? "bg-success-400" : "bg-error-400"}`} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
          {index?.chains.map((ch) => {
            const active = ch.id === activeId && !showMeta;
            return (
              <button
                key={ch.id}
                onClick={() => {
                  setShowMeta(false);
                  setActiveId(ch.id);
                }}
                className={`group w-full rounded-lg border p-2.5 text-left transition-all ${
                  active ? "border-primary-500/40 bg-primary-500/[0.07]" : "border-white/[0.06] bg-surface-1/40 hover:border-white/15"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ch.all_hashes_ok ? "bg-success-400" : "bg-error-400"}`} />
                  <span className="truncate text-[13px] text-slate-200">{ch.title}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 pl-3.5 font-mono text-[9px] text-slate-500">
                  {ch.tool && (
                    <span className="rounded bg-white/[0.06] px-1 py-0.5 text-[8px] uppercase tracking-wide text-slate-400 ring-1 ring-white/10">
                      {ch.tool}
                    </span>
                  )}
                  <span>{ch.length} capsules</span>
                  {ch.ended_at && <span className="ml-auto text-slate-500">{relDate(ch.ended_at)}</span>}
                </div>
              </button>
            );
          })}
        </div>
        {index && (
          <div className="border-t border-white/[0.06] px-4 py-3 font-mono text-[9px] text-slate-500">
            <div className="flex items-center gap-1.5 text-slate-400">
              <Fingerprint className="h-3 w-3" /> signing key
            </div>
            <div className="mt-1 break-all text-slate-300">{index.fingerprint}</div>
          </div>
        )}
      </aside>

      {showMeta && meta ? (
        <MetaView
          meta={meta}
          rows={metaRows}
          verdict={metaVerdict}
          onVerify={runMetaVerify}
          onOpen={openChainFromMeta}
        />
      ) : (
        <>
      {/* ---------- center: chain context + timeline ---------- */}
      <section className="flex min-h-0 min-w-0 flex-col">
        {!chain ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> loading chain…
          </div>
        ) : (
          <>
            {/* chain header */}
            <div className="border-b border-white/[0.06] px-4 py-3">
              {/* mobile chain picker */}
              <select
                value={activeId ?? ""}
                onChange={(e) => setActiveId(e.target.value)}
                className="mb-2 w-full rounded-lg border border-white/10 bg-surface-1 px-2 py-1.5 text-sm text-slate-200 lg:hidden"
              >
                {index?.chains.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.title} ({ch.length})
                  </option>
                ))}
              </select>

              <h1 className="truncate font-display text-base font-bold text-slate-100">{chain.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-500">
                <span>{chain.length} capsules</span>
                <span className="flex items-center gap-1"><Link2 className="h-3 w-3" /> {short(chain.genesis_hash)}</span>
                <ChevronRight className="h-3 w-3" />
                <span>{short(chain.head_hash)}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                {Object.entries(stats.byType).map(([t, n]) => (
                  <span key={t} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium uppercase tracking-wide ring-1 ${typeStyle(t).chip}`}>
                    {n} {t}
                  </span>
                ))}
                {stats.reasoned > 0 && (
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-violet-300 ring-1 ring-violet-500/20">
                    <Brain className="h-3 w-3" /> {stats.reasoned} reasoned
                  </span>
                )}
                {stats.inTok + stats.outTok > 0 && (
                  <span className="rounded px-1.5 py-0.5 font-mono text-slate-400 ring-1 ring-white/10">
                    {fmt(stats.inTok)} → {fmt(stats.outTok)} tok
                  </span>
                )}
                {stats.tools > 0 && <span className="rounded px-1.5 py-0.5 font-mono text-slate-400 ring-1 ring-white/10">{stats.tools} tools</span>}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={runVerify}
                  disabled={phase === "running"}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3.5 py-1.5 text-sm font-semibold text-surface-0 transition-all hover:bg-primary-400 disabled:opacity-60"
                >
                  {phase === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {phase === "running" ? "Verifying…" : "Verify chain"}
                </button>
                {MODE === "static" &&
                  (!tampered ? (
                    <button onClick={runTamper} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-error-500/40 hover:text-error-300">
                      <AlertTriangle className="h-4 w-4" /> Tamper
                    </button>
                  ) : (
                    <button onClick={restore} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-white/30">
                      <RotateCcw className="h-4 w-4" /> Restore
                    </button>
                  ))}

                {/* inline verdict chip */}
                <AnimatePresence>
                  {phase === "done" && verdict && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                        verdict.valid ? "border-success-500/30 bg-success-500/[0.06] text-success-300" : "border-error-500/30 bg-error-500/[0.06] text-error-300"
                      }`}
                    >
                      {verdict.valid ? <ShieldCheck className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {verdict.valid ? `${verdict.verified} verified · 0 tampering` : `broken at #${verdict.brokenAt}`}
                    </motion.span>
                  )}
                  {phase === "done" && serverMsg && (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="inline-flex items-center gap-1.5 rounded-lg border border-info-500/30 bg-info-500/[0.06] px-2.5 py-1.5 text-xs font-semibold text-info-300">
                      <ShieldCheck className="h-3.5 w-3.5" /> {serverMsg}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {/* filter row */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter capsules…"
                    className="w-full rounded-lg border border-white/[0.08] bg-surface-1/60 py-1.5 pl-8 pr-8 text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-primary-500/40 focus:outline-none"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label="Clear">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 overflow-x-auto">
                  {types.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(t)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                        typeFilter === t ? "bg-primary-500/15 text-primary-300 ring-1 ring-primary-500/30" : "text-slate-400 hover:bg-white/[0.05]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setOrder((o) => (o === "newest" ? "oldest" : "newest"))}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11px] font-medium text-slate-400 transition-colors hover:border-white/20 hover:text-slate-200"
                  title={order === "newest" ? "Newest first (head → genesis)" : "Oldest first (genesis → head)"}
                >
                  <ArrowDownUp className="h-3 w-3" />
                  {order === "newest" ? "Newest" : "Oldest"}
                </button>
              </div>
            </div>

            {/* timeline (scrolls) */}
            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="pointer-events-none absolute bottom-3 left-[1.45rem] top-3 w-px bg-gradient-to-b from-primary-500/30 via-white/10 to-transparent" />
              <div className="space-y-1.5">
                {(filtering ? shown : shown.slice(0, visible)).map(({ c, i }) => (
                  <CapsuleListItem
                    key={c.id}
                    cap={c}
                    index={i}
                    selected={selectedSeq === i}
                    verdict={verdictByIdx.get(i)}
                    highlight={highlightFor(i)}
                    onSelect={() => setSelectedSeq(i)}
                  />
                ))}
              </div>
              {filtering && shown.length === 0 && <p className="py-8 pl-10 text-sm text-slate-500">No capsules match this filter.</p>}
              {!filtering && visible < caps.length && (
                <div className="pl-10 pt-2">
                  <button onClick={() => setVisible((v) => v + PAGE)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:border-white/25 hover:text-slate-200">
                    Show {Math.min(PAGE, caps.length - visible)} more · {caps.length - visible} remaining
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ---------- detail pane (lg column) ---------- */}
      <aside className="hidden min-h-0 border-l border-white/[0.06] bg-surface-1/30 lg:block">
        <CapsuleDetail
          cap={selectedCap}
          verdict={selectedSeq != null ? verdictByIdx.get(selectedSeq) : undefined}
          onExpand={selectedCap ? () => setExpanded(true) : undefined}
        />
      </aside>
        </>
      )}

      {/* ---------- detail slide-over (mobile) ---------- */}
      <AnimatePresence>
        {selectedCap && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 right-0 z-50 w-[88%] max-w-md border-l border-white/10 bg-surface-0 shadow-2xl lg:hidden"
          >
            <CapsuleDetail
              cap={selectedCap}
              verdict={selectedSeq != null ? verdictByIdx.get(selectedSeq) : undefined}
              onClose={() => setSelectedSeq(null)}
              onExpand={() => setExpanded(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- capsule deep dive (full canvas) ---------- */}
      <AnimatePresence>
        {expanded && selectedCap && (
          <CapsuleDeepDive
            cap={selectedCap}
            verdict={selectedSeq != null ? verdictByIdx.get(selectedSeq) : undefined}
            onClose={() => setExpanded(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
