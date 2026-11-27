// ---------------------------------------------------------------------------
// howto/types.ts — the shape of the AI Connector's process help ("how do I…").
// Owner 2026-11-27: staff who don't know how to do something ask Claude and
// get click-by-click guidance, written to an SOP standard. Every guide is
// written from the real frontend code; tests/mcp-howto.test.mjs checks every
// page path against the router and every double-quoted UI label against src/.
//
// Writing rules (enforced by the test where possible):
//   - 100% English.
//   - A UI label the person clicks / reads is written in DOUBLE quotes and must
//     appear verbatim in src/ (pages / components). Typical values the person
//     types go in single quotes, never double quotes.
//   - No vague steps ("fill in the details"): every field is listed.
// ---------------------------------------------------------------------------

/** One input the person fills in. `label` is the exact UI label. */
export type HowToField = {
  label: string;
  required: boolean;
  /** Format / validation rule and what to put there. */
  value: string;
  /** A typical value, e.g. '2026-12-05' or 'Lv2'. */
  example?: string;
};

export type HowToStep = {
  /** The action, with the exact button / tab / menu label in double quotes. */
  do: string;
  /** The page this step happens on (router path, may contain :id). Defaults to the guide's page. */
  page?: string;
  /** The exact label of the button / tab to press — the ERP link carries ?highlight=<this>. */
  highlight?: string;
  fields?: HowToField[];
  /** What to check before confirming this step. */
  check?: string;
  /** What happens after the click, and where you land next. */
  then?: string;
};

export type HowToMistake = { mistake: string; fix: string };

export type HowToGuide = {
  id: string;
  title: string;
  /** English plus the Chinese / Malay words staff type. */
  keywords: string[];
  module: string;
  /** Purpose / when to use it. */
  purpose: string;
  /** What must exist first. */
  prerequisites: string[];
  /** The role(s) that normally do this. */
  who: string;
  /** The ERP permission(s) the route checks, "resource:action". All must hold for canDo. */
  permission: string[];
  /** Optional OR-gate: when set, at least one of these must ALSO hold (e.g. product-costing:read OR cost-ledger:read). */
  permissionAny?: string[];
  /** The page where the task starts (router path, no :id). */
  page: string;
  /** How to reach `page` from the sidebar, e.g. "SALES & CUSTOMERS → Sales Orders". */
  sidebar: string;
  steps: HowToStep[];
  /** What to verify before the final confirm. */
  checkBefore: string[];
  /** What changes, and where you see it afterwards. */
  result: string;
  /** Locks a document, moves stock or money, sends to a customer / supplier, cannot be undone. */
  warnings: string[];
  /** How to fix a mistake after confirming, and who can. */
  undo: string;
  /** Approvals needed, if any. */
  approvals?: string;
  /** Cut-offs the system enforces, if any. */
  deadlines?: string;
  commonMistakes: HowToMistake[];
  /** One short realistic example (made-up names). */
  workedExample: string;
  related: string[];
  nextStep?: string;
  /** Which role to ask. */
  contact: string;
  /**
   * Companies this guide applies to. Hookka runs ONE tenant org ("hookka");
   * the organisations registry (SYSTEM → Organisations) holds its companies —
   * HOOKKA and sister companies such as OHANA — which appear as the "Purchase
   * company" / sales org on documents (letterhead), while accounting stays
   * HOOKKA. "ALL" = every company in the registry.
   */
  companies: string[];
  /** Where a company or customer type changes the flow (consignment, customer hubs, per-customer pricing, purchase company). */
  variants?: HowToVariant[];
};

export type HowToVariant = {
  /** When this applies, e.g. "Consignment customer" or "Company OHANA". */
  case: string;
  /** Company codes this variant is for, when it is company-specific. */
  companies?: string[];
  /** What is different, with exact UI labels in double quotes. */
  differences: string[];
};

/** One step of an end-to-end business chain: a task guide, who does it, and the hand-off. */
export type HowToFlowStep = {
  guide: string;
  role: string;
  /** What must be true before this step / what the previous step handed over. */
  handoff: string;
};

export type HowToFlow = {
  id: string;
  title: string;
  keywords: string[];
  summary: string;
  steps: HowToFlowStep[];
};
