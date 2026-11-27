// ---------------------------------------------------------------------------
// mcp-proactive.ts — AI Connector round 4d (owner 2026-11-26 「加 全部一起做」):
// the morning brief email (D1), urgent alerts (D2) and the shape of the weekly
// data-gaps list (D4). PURE: no database, no network — the route
// (routes/mcp-proactive.ts) reads AS THE PERSON and hands the replies here.
//
//   D1  isBriefDue        is this person's brief due on this tick?
//       buildBriefEmail   clean English HTML: sections with counts + top 5,
//                         each line a link into the ERP; Monday adds data gaps.
//   D2  computeAlerts     newly overdue PO / SO above a value, newly late
//                         production orders, materials newly short for the
//                         next 7 days — from the person's own (redacted) reads.
//       alertsToSend      the debounce: drop keys already sent in the window.
//       buildAlertEmail   one email per tick with every new alert.
//   D4  summariseDataGaps BOMs without non-fabric materials, products without
//                         a cost, SOs without a delivery date, workers without
//                         a department, suppliers without a binding.
//
// Every threshold lives in PROACTIVE_CONFIG (the settings page shows it
// read-only). Money is integer sen; RM appears only in words.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** The ONE place the thresholds live. Shown read-only on Settings › AI Connector. */
export const PROACTIVE_CONFIG = {
  /** Brief time offered by default (Malaysia time). Times are on the half hour — the check runs every 30 minutes. */
  briefDefaultTime: "08:00",
  /** A brief not sent within this many hours of its time (the check was down) is skipped for the day. */
  briefLateCutoffHours: 4,
  /** At most this many briefs are built on one 30-minute tick; the rest go on the next tick. */
  maxBriefsPerTick: 15,
  alerts: {
    /** A purchase order newly overdue alerts only from this value (sen; RM 5,000). */
    poOverdueMinSen: 500_000,
    /** A sales order newly overdue alerts only from this value (sen; RM 5,000). */
    soOverdueMinSen: 500_000,
    /** "Newly" overdue / late = at most this many days past its date (so a missed day still alerts once). */
    newlyWindowDays: 2,
    /** A material counts as short when the MRP page says short and it is first needed within this many days. */
    materialHorizonDays: 7,
    /** The same material shortage alerts again only after this many days. */
    materialRepeatDays: 7,
    /** Alerts are checked between these Malaysia hours (from inclusive, to exclusive). */
    hoursMyt: { from: 7, to: 20 },
    /** At most this many alert lines per email (the rest are counted). */
    maxLinesPerEmail: 10,
    /** At most this many people are checked on one tick (least recently checked first). */
    maxPeoplePerTick: 15,
  },
} as const;

export type BriefDays = "weekdays" | "daily";
export type Subscription = {
  userId: string;
  briefEnabled: boolean;
  briefTime: string; // HH:MM, Malaysia time, on the half hour
  briefDays: BriefDays;
  alertsEnabled: boolean;
};

export const DEFAULT_SUBSCRIPTION: Omit<Subscription, "userId"> = {
  briefEnabled: false,
  briefTime: PROACTIVE_CONFIG.briefDefaultTime,
  briefDays: "weekdays",
  alertsEnabled: false,
};

// ── time (Malaysia, UTC+8, no daylight saving) ──────────────────────────────

export type MytNow = { day: string; hhmm: string; minutes: number; weekday: number };

/** Malaysia wall-clock parts. weekday: 0 = Sunday … 6 = Saturday. */
export function mytNow(now: Date = new Date()): MytNow {
  const m = new Date(now.getTime() + 8 * 3600 * 1000);
  const hh = m.getUTCHours();
  const mm = m.getUTCMinutes();
  return {
    day: m.toISOString().slice(0, 10),
    hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
    minutes: hh * 60 + mm,
    weekday: m.getUTCDay(),
  };
}

/** YYYY-MM-DD plus n days (calendar arithmetic). */
export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayDiff = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const ymd = (v: unknown): string => {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ── opt-in (D1 / D2) ────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;

/** The settings form → a subscription, or the reason it is refused. Unknown keys are ignored. */
export function parseSubscriptionInput(body: unknown, userId: string): { ok: true; value: Subscription } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the settings as an object." };
  const b = body as Obj;
  const bool = (k: string, dflt: boolean): boolean | null => (b[k] === undefined ? dflt : typeof b[k] === "boolean" ? (b[k] as boolean) : null);
  const briefEnabled = bool("briefEnabled", DEFAULT_SUBSCRIPTION.briefEnabled);
  const alertsEnabled = bool("alertsEnabled", DEFAULT_SUBSCRIPTION.alertsEnabled);
  if (briefEnabled === null) return { ok: false, error: "briefEnabled must be true or false." };
  if (alertsEnabled === null) return { ok: false, error: "alertsEnabled must be true or false." };
  const briefTime = b.briefTime === undefined ? DEFAULT_SUBSCRIPTION.briefTime : str(b.briefTime);
  if (!TIME_RE.test(briefTime)) return { ok: false, error: "briefTime must be HH:MM on the hour or half hour (Malaysia time), e.g. 08:00 or 07:30." };
  const briefDays = b.briefDays === undefined ? DEFAULT_SUBSCRIPTION.briefDays : str(b.briefDays);
  if (briefDays !== "weekdays" && briefDays !== "daily") return { ok: false, error: "briefDays must be weekdays or daily." };
  return { ok: true, value: { userId, briefEnabled, briefTime, briefDays, alertsEnabled } };
}

/** A database row → a subscription (dual-keyed reads; integers or booleans). */
export function subscriptionFromRow(r: Obj): Subscription {
  const flag = (...k: string[]) => {
    for (const x of k) if (r[x] !== undefined && r[x] !== null) return r[x] === true || Number(r[x]) === 1;
    return false;
  };
  const time = str(r.brief_time ?? r.briefTime);
  const days = str(r.brief_days ?? r.briefDays);
  return {
    userId: str(r.user_id ?? r.userId),
    briefEnabled: flag("brief_enabled", "briefEnabled"),
    briefTime: TIME_RE.test(time) ? time : PROACTIVE_CONFIG.briefDefaultTime,
    briefDays: days === "daily" ? "daily" : "weekdays",
    alertsEnabled: flag("alerts_enabled", "alertsEnabled"),
  };
}

/**
 * Is the brief due on this tick? On (opted in), a day it is wanted, at or past
 * its time but not more than briefLateCutoffHours past it. "Already sent today"
 * is the store's job (one claimed key per person per day), not this function's.
 */
export function isBriefDue(sub: Subscription, now: MytNow, cutoffHours: number = PROACTIVE_CONFIG.briefLateCutoffHours): boolean {
  if (!sub.briefEnabled) return false;
  if (sub.briefDays === "weekdays" && (now.weekday === 0 || now.weekday === 6)) return false;
  const m = TIME_RE.exec(sub.briefTime);
  if (!m) return false;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return now.minutes >= at && now.minutes < at + cutoffHours * 60;
}

/** Alerts are checked only in working hours (Malaysia time). */
export function inAlertHours(now: MytNow, hours: { from: number; to: number } = PROACTIVE_CONFIG.alerts.hoursMyt): boolean {
  const h = Math.floor(now.minutes / 60);
  return h >= hours.from && h < hours.to;
}

/** Monday's brief carries the data-gaps list (D4). */
export const isMonday = (now: MytNow): boolean => now.weekday === 1;

/** A person's alerts are not re-checked within this many minutes (two beats close together). */
export const MIN_ALERT_GAP_MIN = 25;

/**
 * Who one tick serves: briefs due and not yet sent today (capped), and the
 * alert checks in working hours — least recently checked first, not one
 * checked in the last MIN_ALERT_GAP_MIN minutes (capped). Bounded per tick.
 */
export function pickTickWork<T extends Subscription & { lastAlertCheckAt: string }>(subs: T[], now: MytNow, briefedToday: Set<string>, nowMs: number = Date.now()): { briefs: T[]; alerts: T[] } {
  const briefs = subs.filter((s) => isBriefDue(s, now) && !briefedToday.has(s.userId)).slice(0, PROACTIVE_CONFIG.maxBriefsPerTick);
  const alerts = inAlertHours(now)
    ? subs
        .filter((s) => s.alertsEnabled)
        .filter((s) => !s.lastAlertCheckAt || nowMs - Date.parse(s.lastAlertCheckAt) >= MIN_ALERT_GAP_MIN * 60_000)
        .sort((a, b) => (a.lastAlertCheckAt || "").localeCompare(b.lastAlertCheckAt || ""))
        .slice(0, PROACTIVE_CONFIG.alerts.maxPeoplePerTick)
    : [];
  return { briefs, alerts };
}

// ── alerts (D2) ─────────────────────────────────────────────────────────────

export type AlertKind = "po" | "so" | "prod" | "mat";
export type Alert = { key: string; kind: AlertKind; title: string; detail: string; link: string };

const rows = (body: unknown): Obj[] => {
  if (Array.isArray(body)) return body as Obj[];
  const b = (body && typeof body === "object" ? body : {}) as Obj;
  for (const k of ["data", "items", "rows", "results"]) {
    const v = b[k];
    if (Array.isArray(v)) return v as Obj[];
    if (v && typeof v === "object") {
      const inner = rows(v);
      if (inner.length) return inner;
    }
  }
  return [];
};

// Same "open" rules as po_overdue / so_overdue / production_late (the pages' rules).
const PO_DONE = ["RECEIVED", "CLOSED", "CANCELLED"];
const SO_DONE = ["DELIVERED", "INVOICED", "CLOSED", "CANCELLED"];
const PROD_DONE = ["COMPLETED", "CANCELLED", "TRANSFERRED"];
const enc = encodeURIComponent;
const rmWords = (sen: number) => `RM ${(Math.round(sen) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A money value only when the person was shown it: a hidden (removed / null) figure never passes a threshold. */
const visibleSen = (r: Obj, key: string): number | null => (key in r && r[key] !== null && r[key] !== undefined && Number.isFinite(Number(r[key])) ? Number(r[key]) : null);

export type AlertInputs = {
  today: string;
  origin: string;
  /** GET /api/purchase-orders/stats as the person (null = no access). */
  poStats: unknown;
  /** GET /api/sales-orders?fields=orders-due as the person. */
  soDue: unknown;
  /** GET /api/production-orders/board as the person. */
  board: unknown;
  /** GET /api/mrp/plan as the person. */
  mrpPlan: unknown;
  cfg?: Partial<typeof PROACTIVE_CONFIG.alerts>;
};

/**
 * Today's alert candidates from the person's own reads. Nothing here widens
 * what they see: a read they may not make arrives as null and yields nothing,
 * and a value the ERP hid from them (redacted) never counts as "above the
 * threshold" — so a value alert never reveals a figure they cannot see.
 */
export function computeAlerts(x: AlertInputs): Alert[] {
  const cfg = { ...PROACTIVE_CONFIG.alerts, ...(x.cfg ?? {}) };
  const out: Alert[] = [];
  const newly = (date: string) => {
    if (!date || date >= x.today) return 0;
    const late = dayDiff(date, x.today);
    return late >= 1 && late <= cfg.newlyWindowDays ? late : 0;
  };

  if (x.poStats !== null && x.poStats !== undefined) {
    for (const p of rows(x.poStats)) {
      if (PO_DONE.includes(str(p.status)) || p.deliveredInFull === true) continue;
      const late = newly(ymd(p.expectedDate));
      const sen = visibleSen(p, "totalSen");
      if (!late || sen === null || sen < cfg.poOverdueMinSen) continue;
      out.push({
        key: `po:${str(p.id)}`,
        kind: "po",
        title: `PO ${str(p.poNo) || str(p.id)} is overdue`,
        detail: `${str(p.supplierName) || "(no supplier)"} · expected ${ymd(p.expectedDate)} · ${rmWords(sen)}`,
        link: `${x.origin}/procurement/${enc(str(p.id))}`,
      });
    }
  }

  if (x.soDue !== null && x.soDue !== undefined) {
    for (const r of rows(x.soDue)) {
      if (SO_DONE.includes(str(r.status))) continue;
      const late = newly(ymd(r.hookkaExpectedDD));
      const sen = visibleSen(r, "totalSen");
      if (!late || sen === null || sen < cfg.soOverdueMinSen) continue;
      out.push({
        key: `so:${str(r.id)}`,
        kind: "so",
        title: `Sales order ${str(r.companySOId ?? r.companySO) || str(r.id)} is overdue`,
        detail: `${str(r.customerName) || "(no customer)"} · due ${ymd(r.hookkaExpectedDD)} · ${rmWords(sen)}`,
        link: `${x.origin}/sales/${enc(str(r.id))}`,
      });
    }
  }

  if (x.board !== null && x.board !== undefined) {
    for (const r of rows(x.board)) {
      if (PROD_DONE.includes(str(r.status))) continue;
      const late = newly(ymd(r.targetEndDate));
      if (!late) continue;
      const product = `${str(r.productCode)} ${str(r.productName)}`.trim();
      out.push({
        key: `prod:${str(r.id)}`,
        kind: "prod",
        title: `Production order ${str(r.poNo) || str(r.id)} is late`,
        detail: [str(r.customerName), product, `target ${ymd(r.targetEndDate)}`].filter(Boolean).join(" · "),
        link: `${x.origin}/production/${enc(str(r.id))}`,
      });
    }
  }

  if (x.mrpPlan !== null && x.mrpPlan !== undefined) {
    const plan = (x.mrpPlan && typeof x.mrpPlan === "object" ? ((x.mrpPlan as Obj).data ?? x.mrpPlan) : {}) as Obj;
    const mats = Array.isArray(plan.materials) ? (plan.materials as Obj[]) : [];
    const horizon = plusDays(x.today, cfg.materialHorizonDays);
    for (const m of mats) {
      const need = ymd(m.firstNeedBy);
      if (num(m.short) <= 0 || !need || need > horizon) continue;
      const code = str(m.code);
      if (!code) continue;
      out.push({
        key: `mat:${code}`,
        kind: "mat",
        title: `${code} is short`,
        detail: [str(m.description), `short ${num(m.short)} ${str(m.uom)}`.trim(), `needed by ${need}`].filter(Boolean).join(" · "),
        link: `${x.origin}/planning/mrp`,
      });
    }
  }
  return out;
}

/** How far back a key counts as "already sent" — once per newly-overdue item, once a week per shortage. */
export function debounceDays(kind: AlertKind, cfg: Partial<typeof PROACTIVE_CONFIG.alerts> = {}): number {
  const c = { ...PROACTIVE_CONFIG.alerts, ...cfg };
  return kind === "mat" ? c.materialRepeatDays : c.newlyWindowDays;
}

/**
 * The debounce. `sent` = key → the latest day it was sent to this person.
 * A key sent today is always dropped (at most one email per key per person
 * per day); a key sent within its debounce window is dropped too.
 */
export function alertsToSend(alerts: Alert[], sent: Map<string, string>, today: string, cfg: Partial<typeof PROACTIVE_CONFIG.alerts> = {}): Alert[] {
  const seen = new Set<string>();
  return alerts.filter((a) => {
    if (seen.has(a.key)) return false;
    seen.add(a.key);
    const last = sent.get(a.key);
    if (!last) return true;
    return dayDiff(last, today) >= debounceDays(a.kind, cfg);
  });
}

/** The earliest day the debounce must look back to. */
export function debounceSince(today: string, cfg: Partial<typeof PROACTIVE_CONFIG.alerts> = {}): string {
  const c = { ...PROACTIVE_CONFIG.alerts, ...cfg };
  return plusDays(today, -Math.max(c.newlyWindowDays, c.materialRepeatDays));
}

// ── data gaps (D4) ──────────────────────────────────────────────────────────

export type GapLine = { label: string; link: string };
export type Gap = { count: number; top: GapLine[]; countedFrom?: string };
export const GAP_TOP = 5;
export const GAP_SO_SCAN = 500;

const gap = (lines: GapLine[], countedFrom?: string): Gap => ({ count: lines.length, top: lines.slice(0, GAP_TOP), ...(countedFrom ? { countedFrom } : {}) });

export type GapInputs = {
  today: string;
  origin: string;
  /** GET /api/products/setup-incomplete (null = no access). */
  setupIncomplete: unknown;
  /** GET /api/product-costing/summary: { data: { [productCode]: { materialLines, otherLines, missingLines, totalSen? } } }. */
  costSummary: unknown;
  /** GET /api/sales-orders?page=1&limit=500 (newest first). */
  salesOrders: unknown;
  /** GET /api/workers. */
  workers: unknown;
  /** GET /api/suppliers. */
  suppliers: unknown;
  /** GET /api/supplier-materials (the bindings). */
  bindings: unknown;
};

/**
 * The weekly data-gaps list. Each gap: a count and the first five, every line a
 * link. A list the person may not read arrives as null and is left out (the
 * route reports it under noAccess). No money in the answer: counts and names.
 */
export function summariseDataGaps(x: GapInputs) {
  const gaps: Record<string, Gap> = {};
  const has = (v: unknown) => v !== null && v !== undefined;

  if (has(x.setupIncomplete)) {
    const list = rows(x.setupIncomplete);
    const by = (f: string) => list.filter((r) => Array.isArray(r.missing) && (r.missing as unknown[]).includes(f));
    const line = (r: Obj): GapLine => ({ label: `${str(r.code)} — missing ${(Array.isArray(r.missing) ? (r.missing as unknown[]) : []).join(", ") || "set-up"}`, link: `${x.origin}/products/${enc(str(r.id))}/bom` });
    gaps.productsWithoutBom = gap(by("bom").map(line));
    gaps.productsWithoutPrice = gap(by("price").map(line));
  }

  if (has(x.costSummary)) {
    const d = (x.costSummary && typeof x.costSummary === "object" ? ((x.costSummary as Obj).data ?? x.costSummary) : {}) as Obj;
    const entries = Object.entries(d).filter(([, v]) => v && typeof v === "object") as [string, Obj][];
    entries.sort(([a], [b]) => a.localeCompare(b));
    const link = `${x.origin}/products`;
    gaps.bomsMissingNonFabricMaterials = gap(
      entries.filter(([, v]) => num(v.otherLines) === 0).map(([code, v]) => ({ label: `${code} — BOM has ${num(v.fabricLines) ? "only the fabric line" : "no material lines"}`, link })),
    );
    gaps.productsWithoutCost = gap(
      entries
        .filter(([, v]) => num(v.missingLines) > 0 || (v.totalSen !== undefined && v.totalSen !== null && num(v.totalSen) === 0))
        .map(([code, v]) => ({ label: num(v.missingLines) > 0 ? `${code} — ${num(v.missingLines)} BOM line(s) without a price` : `${code} — cost is zero`, link })),
    );
  }

  if (has(x.salesOrders)) {
    const list = rows(x.salesOrders);
    const open = list.filter((r) => !SO_DONE.includes(str(r.status)) && !ymd(r.hookkaExpectedDD));
    gaps.salesOrdersWithoutDeliveryDate = gap(
      open.map((r) => ({ label: `${str(r.companySOId ?? r.companySO) || str(r.id)} — ${str(r.customerName) || "(no customer)"} · ${str(r.status) || "no status"}`, link: `${x.origin}/sales/${enc(str(r.id))}` })),
      list.length >= GAP_SO_SCAN ? `the ${GAP_SO_SCAN} newest sales orders` : undefined,
    );
  }

  if (has(x.workers)) {
    const list = rows(x.workers).filter((w) => !["RESIGNED", "INACTIVE", "TERMINATED"].includes(str(w.status).toUpperCase()));
    gaps.workersWithoutDepartment = gap(
      list
        .filter((w) => !str(w.departmentId).trim() && !str(w.departmentCode).trim())
        .map((w) => ({ label: `${str(w.empNo)} ${str(w.name)}`.trim() || str(w.id), link: `${x.origin}/employees` })),
    );
  }

  if (has(x.suppliers) && has(x.bindings)) {
    const bound = new Set(rows(x.bindings).map((b) => str(b.supplierId)).filter(Boolean));
    const list = rows(x.suppliers).filter((s) => str(s.status || "ACTIVE").toUpperCase() === "ACTIVE");
    gaps.suppliersWithoutBinding = gap(
      list.filter((s) => !bound.has(str(s.id))).map((s) => ({ label: `${str(s.code)} ${str(s.name)}`.trim() || str(s.id), link: `${x.origin}/suppliers/${enc(str(s.id))}` })),
    );
  }

  const totalGaps = Object.values(gaps).reduce((t, g) => t + g.count, 0);
  return {
    date: x.today,
    note: "Data the ERP is missing, from the lists this person may read: active products without a BOM or price, BOMs with no material besides the fabric line, products whose BOM has lines without a price (so no full cost), open sales orders without a Hookka expected delivery date, active workers without a department, active suppliers with no material binding. Counts, and the first five of each with a link.",
    totalGaps,
    gaps,
  };
}

// ── email HTML ──────────────────────────────────────────────────────────────

export function escapeHtml(s: unknown): string {
  return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only http(s) links are rendered as links — anything else becomes plain text. */
const safeLink = (v: unknown): string => {
  const s = str(v);
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
};

const BRIEF_LABELS: Record<string, string> = {
  salesOrdersOverdue: "Sales orders overdue",
  salesOrdersDueIn3Days: "Sales orders due in the next 3 days",
  purchaseOrdersOverdue: "Purchase orders overdue",
  purchaseOrdersDueIn3Days: "Purchase orders due in the next 3 days",
  mailWaitingForYou: "Mail waiting for you",
  serviceCaseApprovals: "Service cases waiting for your approval",
  leaveApprovals: "Leave waiting for your approval",
};

const GAP_LABELS: Record<string, string> = {
  bomsMissingNonFabricMaterials: "BOMs with no material besides fabric",
  productsWithoutCost: "Products without a full cost",
  productsWithoutBom: "Products without a BOM",
  productsWithoutPrice: "Products without a selling price",
  salesOrdersWithoutDeliveryDate: "Open sales orders without a delivery date",
  workersWithoutDepartment: "Workers without a department",
  suppliersWithoutBinding: "Suppliers with no material binding",
};

/** One brief line in words (the shape buildDailyBrief gives each section's rows). */
export function briefLineText(section: string, l: Obj): string {
  const late = num(l.daysLate) ? ` · ${num(l.daysLate)} day${num(l.daysLate) === 1 ? "" : "s"} late` : "";
  switch (section) {
    case "salesOrdersOverdue":
    case "salesOrdersDueIn3Days":
      return `${str(l.so)} · ${str(l.customer)}${late || (l.due ? ` · due ${str(l.due)}` : "")}`;
    case "purchaseOrdersOverdue":
    case "purchaseOrdersDueIn3Days":
      return `${str(l.po)} · ${str(l.supplier)}${late || (l.expected ? ` · expected ${str(l.expected)}` : "")}`;
    case "mailWaitingForYou":
      return `${str(l.subject) || "(no subject)"} — ${str(l.from)}`;
    case "serviceCaseApprovals":
      return `${str(l.case)} · ${str(l.customer)}${l.issue ? ` · ${str(l.issue)}` : ""}`;
    case "leaveApprovals":
      return `${str(l.name)} · ${str(l.type)} · ${str(l.from)} to ${str(l.to)}`;
    default:
      return str(l.label) || Object.values(l).filter((v) => typeof v === "string" && !/^https?:/.test(v)).slice(0, 3).join(" · ");
  }
}

type Section = { title: string; count: number; note?: string; lines: { text: string; link: string }[]; more: number };

const FONT = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function sectionHtml(s: Section): string {
  const items = s.lines
    .map((l) => {
      const href = safeLink(l.link);
      const t = escapeHtml(l.text);
      return `<li style="margin:0 0 6px 0">${href ? `<a href="${escapeHtml(href)}" style="color:#6B5C32;text-decoration:underline">${t}</a>` : t}</li>`;
    })
    .join("");
  const more = s.more > 0 ? `<p style="margin:4px 0 0 0;color:#6B6B66;font-size:13px">…and ${s.more} more.</p>` : "";
  const note = s.note ? `<p style="margin:2px 0 6px 0;color:#6B6B66;font-size:12px">${escapeHtml(s.note)}</p>` : "";
  return `<tr><td style="padding:14px 20px;border-top:1px solid #EFEBE2">
<h3 style="margin:0 0 4px 0;font-size:15px;color:#1F1D1A">${escapeHtml(s.title)} <span style="display:inline-block;min-width:22px;padding:1px 8px;border-radius:10px;background:${s.count ? "#F3EEDF" : "#EEF5EF"};color:${s.count ? "#6B5A2E" : "#1E6B3F"};font-size:13px;text-align:center">${s.count}</span></h3>
${note}${s.lines.length ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:14px;color:#1F1D1A">${items}</ul>` : ""}${more}
</td></tr>`;
}

function shell(title: string, intro: string, body: string, footer: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:#F6F4EF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4EF;${FONT}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border:1px solid #E6E1D6;border-radius:12px;${FONT}">
<tr><td style="padding:20px 20px 8px 20px"><h2 style="margin:0;font-size:19px;color:#1F1D1A">${escapeHtml(title)}</h2><p style="margin:6px 0 0 0;font-size:14px;color:#55534E">${intro}</p></td></tr>
${body}
<tr><td style="padding:16px 20px;border-top:1px solid #EFEBE2;font-size:12px;color:#6B6B66">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function footerHtml(settingsUrl: string, unsubscribeUrl: string, why: string): string {
  const s = safeLink(settingsUrl);
  const u = safeLink(unsubscribeUrl);
  return `${escapeHtml(why)} It shows only what your Hookka ERP permissions let you see.<br>${s ? `<a href="${escapeHtml(s)}" style="color:#6B5C32">Change the time or what you get</a> · ` : ""}${u ? `<a href="${escapeHtml(u)}" style="color:#6B5C32">Unsubscribe</a>` : ""}`;
}

function sectionsText(sections: Section[]): string {
  return sections
    .map((s) => [`${s.title}: ${s.count}`, ...s.lines.map((l) => `  - ${l.text}${safeLink(l.link) ? ` <${safeLink(l.link)}>` : ""}`), ...(s.more > 0 ? [`  …and ${s.more} more.`] : [])].join("\n"))
    .join("\n\n");
}

export type BriefEmailInputs = {
  /** daily_brief's answer (structuredContent / parsed text), as the person. */
  brief: Obj;
  /** data_gaps' answer — Monday only. */
  gaps?: Obj | null;
  name: string;
  date: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  /** Fields the ERP hid from this person (named only, never shown). */
  hiddenFields?: string[];
  test?: boolean;
};

const gapSections = (gaps: Obj | null | undefined): Section[] => {
  const g = (gaps?.gaps && typeof gaps.gaps === "object" ? gaps.gaps : {}) as Record<string, Obj>;
  return Object.entries(g).map(([k, v]) => {
    const top = Array.isArray(v.top) ? (v.top as Obj[]) : [];
    return {
      title: GAP_LABELS[k] ?? k,
      count: num(v.count),
      note: v.countedFrom ? `Counted from ${str(v.countedFrom)}.` : undefined,
      lines: top.slice(0, GAP_TOP).map((l) => ({ text: str(l.label), link: str(l.link ?? l.url) })),
      more: Math.max(0, num(v.count) - Math.min(top.length, GAP_TOP)),
    };
  });
};

/** D1: the morning brief email. Clean English HTML + a plain-text part. */
export function buildBriefEmail(x: BriefEmailInputs): { subject: string; html: string; text: string; items: number } {
  const secs = (x.brief.sections && typeof x.brief.sections === "object" ? x.brief.sections : {}) as Record<string, Obj>;
  const sections: Section[] = Object.entries(secs).map(([k, v]) => {
    const top = Array.isArray(v.top) ? (v.top as Obj[]) : [];
    const count = num(v.count);
    const notes = [v.atLeast ? "At least this many." : "", v.countedFrom ? `Counted from ${str(v.countedFrom)}.` : ""].filter(Boolean).join(" ");
    return {
      title: BRIEF_LABELS[k] ?? k,
      count,
      note: notes || undefined,
      lines: top.slice(0, 5).map((l) => ({ text: briefLineText(k, l), link: str(l.link ?? l.url) })),
      more: Math.max(0, count - Math.min(top.length, 5)),
    };
  });
  const items = num(x.brief.itemsNeedingAttention) || sections.reduce((t, s) => t + s.count, 0);
  const noAccess = Array.isArray(x.brief.noAccess) ? (x.brief.noAccess as unknown[]).map(str) : [];
  const gaps = x.gaps ? gapSections(x.gaps) : [];
  const first = (x.name || "").trim().split(/\s+/)[0] || "there";
  const dayWords = new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const subject = `${x.test ? "[Test] " : ""}Your Hookka morning brief — ${items} item${items === 1 ? "" : "s"} · ${x.date}`;
  const intro = `Good morning, ${escapeHtml(first)}. ${escapeHtml(dayWords)}: ${items ? `<b>${items}</b> item${items === 1 ? "" : "s"} need${items === 1 ? "s" : ""} a look.` : "nothing needs a look today."}`;
  let body = sections.length ? sections.map(sectionHtml).join("\n") : `<tr><td style="padding:14px 20px;border-top:1px solid #EFEBE2;font-size:14px;color:#55534E">There is nothing in your brief: your ERP permissions do not cover any of its lists.</td></tr>`;
  if (noAccess.length) body += `\n<tr><td style="padding:10px 20px;border-top:1px solid #EFEBE2;font-size:12px;color:#6B6B66">${noAccess.map(escapeHtml).join(" ")}</td></tr>`;
  if (gaps.length) {
    body += `\n<tr><td style="padding:18px 20px 4px 20px;border-top:2px solid #E6E1D6"><h2 style="margin:0;font-size:17px;color:#1F1D1A">Monday: data gaps to fill</h2><p style="margin:4px 0 0 0;font-size:13px;color:#55534E">What the ERP is missing, so costs, planning and reports stay right.</p></td></tr>\n${gaps.map(sectionHtml).join("\n")}`;
  }
  const footer = footerHtml(x.settingsUrl, x.unsubscribeUrl, x.test ? "A test brief you asked for on Settings › AI Connector." : "You get this because you turned on the morning brief on Settings › AI Connector.");
  const html = shell(`${x.test ? "[Test] " : ""}Morning brief`, intro, body, footer);
  const text = [
    `Good morning, ${first}. ${dayWords}: ${items} item(s) need a look.`,
    "",
    sectionsText(sections),
    noAccess.length ? `\n${noAccess.join(" ")}` : "",
    gaps.length ? `\nMONDAY: DATA GAPS TO FILL\n\n${sectionsText(gaps)}` : "",
    "",
    `Change the time or what you get: ${safeLink(x.settingsUrl)}`,
    `Unsubscribe: ${safeLink(x.unsubscribeUrl)}`,
  ].join("\n");
  return { subject, html, text, items };
}

const ALERT_TITLES: Record<AlertKind, string> = {
  po: "Purchase orders newly overdue",
  so: "Sales orders newly overdue",
  prod: "Production orders newly late",
  mat: "Materials newly short (next 7 days)",
};

/** D2: one email with every new alert of this tick, grouped by kind. */
export function buildAlertEmail(x: { alerts: Alert[]; name: string; date: string; settingsUrl: string; unsubscribeUrl: string; maxLines?: number }): { subject: string; html: string; text: string } {
  const max = x.maxLines ?? PROACTIVE_CONFIG.alerts.maxLinesPerEmail;
  const kinds: AlertKind[] = ["po", "so", "prod", "mat"];
  let budget = max;
  const sections: Section[] = [];
  for (const k of kinds) {
    const list = x.alerts.filter((a) => a.kind === k);
    if (!list.length) continue;
    const shown = list.slice(0, Math.max(0, budget));
    budget -= shown.length;
    sections.push({ title: ALERT_TITLES[k], count: list.length, lines: shown.map((a) => ({ text: `${a.title} — ${a.detail}`, link: a.link })), more: list.length - shown.length });
  }
  const n = x.alerts.length;
  const subject = `Hookka alert: ${n} new item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
  const intro = `These became urgent since the last check (${escapeHtml(x.date)}). Each one is sent to you once.`;
  const footer = footerHtml(x.settingsUrl, x.unsubscribeUrl, "You get this because you turned on urgent alerts on Settings › AI Connector.");
  return {
    subject,
    html: shell("Urgent alerts", intro, sections.map(sectionHtml).join("\n"), footer),
    text: [`These became urgent since the last check (${x.date}).`, "", sectionsText(sections), "", `Settings: ${safeLink(x.settingsUrl)}`, `Unsubscribe: ${safeLink(x.unsubscribeUrl)}`].join("\n"),
  };
}

/** The threshold table the settings page shows (read-only). */
export function thresholdsForDisplay(): { label: string; value: string }[] {
  const a = PROACTIVE_CONFIG.alerts;
  return [
    { label: "Purchase order newly overdue", value: `${rmWords(a.poOverdueMinSen)} or more, up to ${a.newlyWindowDays} days past its expected date` },
    { label: "Sales order newly overdue", value: `${rmWords(a.soOverdueMinSen)} or more, up to ${a.newlyWindowDays} days past its Hookka expected delivery date` },
    { label: "Production order newly late", value: `up to ${a.newlyWindowDays} days past its target end date` },
    { label: "Material newly short", value: `short on the MRP page and needed within ${a.materialHorizonDays} days; repeated after ${a.materialRepeatDays} days at most` },
    { label: "When alerts are checked", value: `every 30 minutes, ${a.hoursMyt.from}:00–${a.hoursMyt.to}:00 Malaysia time` },
    { label: "Each alert", value: "emailed to you once (never twice in a day)" },
    { label: "Values you cannot see", value: "a PO / SO whose value your role hides is never value-alerted" },
  ];
}
