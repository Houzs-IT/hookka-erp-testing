// ---------------------------------------------------------------------------
// /api/dashboard/floor-live — Dashboard › Operations › Floor Live
// (owner 2026-11-10). Read-only.
//
//   GET /                today, live (refreshed by the page every 5 minutes)
//   GET /?date=Y-M-D     a past day: its saved snapshot (frozen); a day before
//                        snapshots began is recomputed and marked so
//   GET /summary?from&to Month / Quarter / Year — per worker over the saved
//                        days (days, pieces, efficiency, non-production
//                        hours, days over an hour in non-production)
//
// Shaping: src/api/lib/floor-live.ts. Data + snapshots: floor-live-data.ts.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Env } from "../worker";
import { requireReadOrDashboardTab } from "../lib/rbac";
import { getOrgId } from "../lib/tenant";
import { summarizeFloorLive } from "../lib/floor-live";
import { computeFloorLive, readFloorLiveSnapshot, readFloorLiveSnapshots } from "../lib/floor-live-data";

const app = new Hono<Env>();
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function myClock() {
  const myNow = new Date(Date.now() + 8 * 3600_000);
  return { today: myNow.toISOString().slice(0, 10), nowMin: myNow.getUTCHours() * 60 + myNow.getUTCMinutes() };
}

app.get("/", async (c) => {
  const denied = await requireReadOrDashboardTab(c, "production-orders", "operations");
  if (denied) return denied;
  const db = c.var.DB;
  const orgId = getOrgId(c);
  const { today, nowMin } = myClock();
  const asked = c.req.query("date") ?? "";
  if (asked && (!YMD.test(asked) || asked > today)) {
    return c.json({ success: false, error: "date must be YYYY-MM-DD, today or earlier" }, 400);
  }
  const date = asked || today;
  try {
    c.header("Cache-Control", "no-store");
    if (date === today) {
      const day = await computeFloorLive(db, orgId, date, nowMin);
      return c.json({
        success: true,
        live: true,
        frozen: false,
        asOf: `${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`,
        ...day,
      });
    }
    // A past day: the saved snapshot if there is one (owner: one copy a day,
    // never changed); otherwise recompute and say it is not the saved copy.
    const saved = await readFloorLiveSnapshot(db, orgId, date);
    if (saved) return c.json({ success: true, live: false, frozen: true, asOf: "end of day", ...saved });
    const day = await computeFloorLive(db, orgId, date, null);
    return c.json({ success: true, live: false, frozen: false, asOf: "end of day", ...day });
  } catch (e) {
    console.error("[floor-live]", e);
    return c.json({ success: false, error: e instanceof Error ? e.message : "Could not load the floor" }, 500);
  }
});

app.get("/summary", async (c) => {
  const denied = await requireReadOrDashboardTab(c, "production-orders", "operations");
  if (denied) return denied;
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!YMD.test(from) || !YMD.test(to) || from > to) {
    return c.json({ success: false, error: "from and to must be YYYY-MM-DD, from <= to" }, 400);
  }
  try {
    const db = c.var.DB;
    const orgId = getOrgId(c);
    const days = await readFloorLiveSnapshots(db, orgId, from, to);
    const latest = days[days.length - 1];
    c.header("Cache-Control", "no-store");
    return c.json({
      success: true,
      from,
      to,
      savedDays: days.map((d) => d.date),
      departments: latest?.departments ?? [],
      rows: summarizeFloorLive(days),
    });
  } catch (e) {
    console.error("[floor-live summary]", e);
    return c.json({ success: false, error: e instanceof Error ? e.message : "Could not load the summary" }, 500);
  }
});

export default app;
