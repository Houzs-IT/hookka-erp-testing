// scan-timing — per-stage scan timings (HK-0005 slice 1). "Scanning is slow"
// is split into stages before anything is sped up. Each scan writes one JSON
// log line (filter Workers Logs on `scan_timing`) and one point on the existing
// ERP_METRICS Analytics Engine dataset (see lib/observability.ts).
//
// Stages, in the order a queued scan runs them:
//   load   — read the stored file out of the scan_queue row
//   decode — base64 text -> bytes
//   detect — Haiku page-boundary call (multi-page PDFs only)
//   encode — bytes -> base64 for the Claude request
//   prep   — catalog / rules / few-shot DB reads, prompt build
//   ai     — the Claude extract call, until the body is read
//   parse  — JSON parse + sanitise
//   save   — learning-loop sample row insert
//
// AE layout (fixed; a reader must match it): blob1='scan', blob2=kind,
// blob3=outcome, blob4=id; double1=total_ms, double2.. = STAGES in order.

type Metrics = {
  ERP_METRICS?: {
    writeDataPoint?: (p: { indexes?: string[]; blobs?: string[]; doubles?: number[] }) => void;
  };
};

export const STAGES = ["load", "decode", "detect", "encode", "prep", "ai", "parse", "save"] as const;
export type Stage = (typeof STAGES)[number];
export type ScanTimer = ReturnType<typeof scanTimer>;

export function scanTimer(kind: string) {
  const t0 = Date.now();
  let last = t0;
  const ms = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  return {
    /** The time since the previous mark (or start) is charged to `stage`. */
    mark(stage: Stage): void {
      const now = Date.now();
      ms[stage] += now - last;
      last = now;
    },
    /** `id` joins the line to its scan (queue row id or sample id). */
    done(env: unknown, id: string | null, outcome: "ok" | "error" | "split"): void {
      const total = Date.now() - t0;
      const line: Record<string, unknown> = { event: "scan_timing", kind, id: id ?? "", outcome, total_ms: total };
      for (const s of STAGES) line[`${s}_ms`] = ms[s];
      console.log(JSON.stringify(line));
      try {
        (env as Metrics | null)?.ERP_METRICS?.writeDataPoint?.({
          indexes: [`scan|${kind}`],
          blobs: ["scan", kind, outcome, id ?? ""],
          doubles: [total, ...STAGES.map((s) => ms[s])],
        });
      } catch {
        /* never let observability break a scan */
      }
    },
  };
}
