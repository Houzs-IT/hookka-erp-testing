// ---------------------------------------------------------------------------
// bom-copy.ts (pure) — copy parts of one model's BOM onto another (owner
// 2026-11-22, plan D7): "WIP processes / WIP time / raw materials", any
// combination, any time. Each part replaces only that part; the rest of the
// target stays.
//
//   processes  the WIP tree (nodes, types, pieces) and each node's departments
//   time       minutes per process, matched to the same WIP + department here
//   materials  each WIP's raw materials (qty, unit, scaling, "from order")
//
// Matching a node across two models: product codes differ, so names cannot be
// compared. A node is identified by its path of WIP types, counting repeats —
// "2nd Divan → 1st Foam" — which is what the BOM author sees as "the same
// WIP". Processes inside a node match by department (and repeat count).
//
// Every copied node and material is a DEEP copy with a NEW id: the old BOM
// Builder copy shared child objects with the source (editing one edited both
// in memory) and reused ids.
// ---------------------------------------------------------------------------

type Proc = { dept?: string; deptCode?: string; category?: string; minutes?: number | string; [k: string]: unknown };
type Mat = { [k: string]: unknown };
export type CopyNode = {
  id?: string;
  wipType?: string;
  quantity?: number | string;
  processes?: Proc[];
  materials?: Mat[];
  children?: CopyNode[];
  [k: string]: unknown;
};
export type CopyBom = { l1Processes?: Proc[]; l1Materials?: Mat[]; wipComponents?: CopyNode[]; [k: string]: unknown };
export type CopyParts = { processes: boolean; time: boolean; materials: boolean };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;
let seq = 0;
const newId = () => `wip-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const deptKey = (p: Proc) => String(p.deptCode || p.dept || "").trim().toUpperCase();

/** "TYPE#n" per sibling, so the 2nd Divan is not the 1st. */
function siblingKeys(list: CopyNode[]): string[] {
  const seen = new Map<string, number>();
  return list.map((n) => {
    const t = String(n.wipType ?? "").trim().toUpperCase();
    const i = seen.get(t) ?? 0;
    seen.set(t, i + 1);
    return `${t}#${i}`;
  });
}

function indexTree(list: CopyNode[] | undefined, prefix = "", out = new Map<string, CopyNode>()): Map<string, CopyNode> {
  const nodes = list ?? [];
  const keys = siblingKeys(nodes);
  nodes.forEach((n, i) => {
    const k = `${prefix}/${keys[i]}`;
    out.set(k, n);
    indexTree(n.children, k, out);
  });
  return out;
}

/** Minutes of `from` copied onto `onto` by department (repeat-aware). */
function copyMinutes(onto: Proc[], from: Proc[]): { procs: Proc[]; matched: number } {
  const pool = new Map<string, Proc[]>();
  for (const p of from) {
    const k = deptKey(p);
    pool.set(k, [...(pool.get(k) ?? []), p]);
  }
  let matched = 0;
  const procs = onto.map((p) => {
    const hit = pool.get(deptKey(p))?.shift();
    if (!hit) return { ...p };
    matched += 1;
    return { ...p, minutes: Number(hit.minutes) || 0 };
  });
  return { procs, matched };
}

export type CopyResult = { bom: CopyBom; matchedNodes: number; unmatchedNodes: number; matchedProcesses: number };

export function copyBomParts(target: CopyBom, source: CopyBom, parts: CopyParts): CopyResult {
  const out = clone(target) ?? {};
  let matchedNodes = 0;
  let unmatchedNodes = 0;
  let matchedProcesses = 0;
  const tIndex = indexTree(target.wipComponents);

  // ---- L1 (product level) ----
  if (parts.processes) {
    const procs = clone(source.l1Processes ?? []).map((p) => ({ ...p, minutes: 0 }));
    const timed = copyMinutes(procs, parts.time ? source.l1Processes ?? [] : target.l1Processes ?? []);
    out.l1Processes = timed.procs;
    matchedProcesses += parts.time ? timed.matched : 0;
  } else if (parts.time) {
    const timed = copyMinutes(target.l1Processes ?? [], source.l1Processes ?? []);
    out.l1Processes = timed.procs;
    matchedProcesses += timed.matched;
  }
  if (parts.materials) out.l1Materials = clone(source.l1Materials ?? []);

  // ---- WIP tree ----
  if (parts.processes) {
    // The tree takes the source's shape; minutes and materials come from the
    // source only when those parts are ticked, otherwise from the matching
    // node of what was here (or blank).
    const build = (list: CopyNode[] | undefined, prefix: string): CopyNode[] => {
      const nodes = list ?? [];
      const keys = siblingKeys(nodes);
      return nodes.map((n, i) => {
        const k = `${prefix}/${keys[i]}`;
        const here = tIndex.get(k);
        if (here) matchedNodes += 1;
        else unmatchedNodes += 1;
        const blank = clone(n.processes ?? []).map((p) => ({ ...p, minutes: 0 }));
        const timed = copyMinutes(blank, parts.time ? n.processes ?? [] : here?.processes ?? []);
        if (parts.time) matchedProcesses += timed.matched;
        const copy: CopyNode = {
          ...clone(n),
          id: newId(),
          processes: timed.procs,
          materials: parts.materials ? clone(n.materials ?? []) : clone(here?.materials ?? []),
          children: build(n.children, k),
        };
        return copy;
      });
    };
    out.wipComponents = build(source.wipComponents, "");
  } else if (parts.time || parts.materials) {
    const sIndex = indexTree(source.wipComponents);
    const walk = (list: CopyNode[] | undefined, prefix: string): CopyNode[] => {
      const nodes = list ?? [];
      const keys = siblingKeys(nodes);
      return nodes.map((n, i) => {
        const k = `${prefix}/${keys[i]}`;
        const src = sIndex.get(k);
        if (src) matchedNodes += 1;
        else unmatchedNodes += 1;
        let processes = clone(n.processes ?? []);
        if (parts.time && src) {
          const timed = copyMinutes(processes, src.processes ?? []);
          processes = timed.procs;
          matchedProcesses += timed.matched;
        }
        return {
          ...clone(n),
          processes,
          materials: parts.materials && src ? clone(src.materials ?? []) : clone(n.materials ?? []),
          children: walk(n.children, k),
        };
      });
    };
    out.wipComponents = walk(target.wipComponents, "");
  }
  return { bom: out, matchedNodes, unmatchedNodes, matchedProcesses };
}
