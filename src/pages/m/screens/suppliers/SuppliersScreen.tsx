// ===========================================================================
// SuppliersScreen — L1 /m/suppliers (Batch 4, Claude Design "Suppliers
// (standalone)", approved). KPI tiles, search, status chips, sort & filter
// sheet and the supplier cards; "+" opens the prototype's Add supplier form.
//   GET /api/suppliers       the whole list (no paging server-side)
//   GET /api/organisations   purchase companies (filter + form options)
// Status is the supplier's `status` (ACTIVE / INACTIVE / BLACKLISTED), never
// `isActive`. "+" needs suppliers:create; the server still checks it.
// A wide tablet shows the list left and the first supplier right (TwoPane).
// ===========================================================================
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BadgeCheck, Ban, CloudOff, Factory, SearchX, Star } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { useResponsiveLayout } from "../../lib/responsive-layout";
import { useDebounced } from "../../lib/use-debounced";
import {
  BottomSheet, ChipRail, KpiGrid, OptGroup, PlusButton, SearchSort, SectionLabel, SheetButtons, ShowMore, Skeleton, StateCard, SupFrame, SupplierCard, TopBar,
  type StateV,
} from "./sup-kit";
import { C } from "./sup-style";
import { STATUS, TERMS, filterSort, rowsOf, termsLabel, toSupplier, type Chip, type SortKey } from "./sup-lib";
import { useOrgOptions, useSupPerms } from "./sup-data";
import { SupplierForm } from "./SupplierForm";
import { useSupToast } from "./sup-toast";

const PAGE = 30;
type Draft = { sort: SortKey; terms: string; org: string };
const DEFAULT_DRAFT: Draft = { sort: "name", terms: "all", org: "all" };

export function SuppliersScreen() {
  const navigate = useNavigate();
  const layout = useResponsiveLayout();
  const { id: openId } = useParams();
  const inPane = layout.canSplitDetail && !!openId;
  const tabletGrid = layout.mode !== "phone" && !layout.canSplitDetail;
  const perms = useSupPerms();
  const orgs = useOrgOptions();
  const toast = useSupToast();

  const resp = useCachedJson<unknown>("/api/suppliers");
  const all = useMemo(() => rowsOf(resp.data).map(toSupplier).filter((p) => p.id), [resp.data]);

  const [chip, setChip] = useState<Chip>("all");
  const [q, setQ] = useState("");
  const [opt, setOpt] = useState<Draft>(DEFAULT_DRAFT);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [page, setPage] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const [lastKey, setLastKey] = useState("");
  const key = `${chip}|${dq}|${JSON.stringify(opt)}`;
  if (key !== lastKey) {
    setLastKey(key);
    setPage(PAGE);
  }

  const rows = useMemo(() => filterSort(all, { chip, q: dq, sort: opt.sort, terms: opt.terms, org: opt.org }), [all, chip, dq, opt]);
  const cnt = (k: Chip) => (k === "all" ? all.length : all.filter((p) => p.status === k).length);
  const avg = all.length ? (all.reduce((a, p) => a + p.rating, 0) / all.length).toFixed(1) : "—";
  const fN = (opt.sort !== "name" ? 1 : 0) + (opt.terms !== "all" ? 1 : 0) + (opt.org !== "all" ? 1 : 0);

  const hasData = resp.data != null;
  const loading = resp.loading && !hasData;
  const failed = !hasData && !!resp.failure;
  const forbidden = failed && resp.failure?.status === 403;

  // Wide tablet: list left + the first supplier right, as the prototype opens.
  const firstId = rows[0]?.id;
  useEffect(() => {
    if (layout.canSplitDetail && !openId && firstId) navigate(`/m/suppliers/${encodeURIComponent(firstId)}`, { replace: true });
  }, [layout.canSplitDetail, openId, firstId, navigate]);

  const clearAll = () => { setQ(""); setChip("all"); setOpt(DEFAULT_DRAFT); };
  const st: StateV | null = forbidden
    ? { icon: Ban, t: "You can't see suppliers", s: "Your role doesn't include the supplier list. Ask an admin.", c: C.neu, bg: C.neub, alert: true }
    : failed
      ? { icon: CloudOff, t: "Couldn't load suppliers", s: "The procurement service didn't answer.", c: C.bad, bg: C.badb, btn: "Try again", onTap: () => resp.refresh(), alert: true }
      : !loading && !all.length
        ? { icon: Factory, t: "No suppliers yet", s: perms.create ? "Add the suppliers you buy materials from." : "No suppliers have been added.", c: C.br, bg: C.tint, btn: perms.create ? "Add supplier" : undefined, onTap: () => setAdding(true) }
        : !loading && !rows.length
          ? { icon: SearchX, t: "No suppliers match", s: "Try another search, chip or filter.", c: C.br, bg: C.tint, btn: "Clear filters", onTap: clearAll }
          : null;

  // Filter options: the fixed terms plus any other value a supplier carries; the purchase companies plus any code in use.
  const termKeys = [...TERMS, ...[...new Set(all.map((p) => p.terms))].filter((t) => t && !(TERMS as readonly string[]).includes(t)).sort()];
  const orgKeys = [...new Set([...orgs.map((o) => o.code), ...all.map((p) => p.org)])].filter(Boolean);

  return (
    <SupFrame label="Suppliers list">
      <TopBar title="Suppliers" menu right={perms.create ? <PlusButton label="Add supplier" onTap={() => setAdding(true)} /> : null} />

      {!failed && (all.length > 0 || loading) ? (
        <>
          <KpiGrid items={[
            { l: "Active", v: loading ? "…" : String(cnt("ACTIVE")), icon: BadgeCheck, c: C.ok, t: C.okb },
            { l: "Total", v: loading ? "…" : String(all.length), icon: Factory, c: C.br, t: C.tint },
            { l: "Blacklisted", v: loading ? "…" : String(cnt("BLACKLISTED")), icon: Ban, c: C.bad, t: C.badb },
            { l: "Avg rating", v: loading ? "…" : avg, icon: Star, c: C.star, t: C.warnb },
          ]} />
          <SearchSort q={q} onQ={setQ} placeholder="Code, name, contact or phone" ariaLabel="Search suppliers" count={fN} onSort={() => setDraft({ ...opt })} />
          <ChipRail label="Supplier status" items={(["all", "ACTIVE", "INACTIVE", "BLACKLISTED"] as Chip[]).map((k) => ({
            k, l: k === "all" ? "All" : STATUS[k].l, dot: k === "all" ? null : STATUS[k].c, n: loading ? "" : cnt(k), on: chip === k, onTap: () => setChip(k),
          }))} />
        </>
      ) : null}

      {loading ? <Skeleton /> : null}
      {st ? <StateCard v={st} /> : null}

      {!loading && !failed && rows.length > 0 ? (
        <>
          <SectionLabel t={`${rows.length} SUPPLIER${rows.length === 1 ? "" : "S"}`} />
          <div style={{ display: "grid", gridTemplateColumns: tabletGrid ? "repeat(auto-fill,minmax(320px,1fr))" : "minmax(0,1fr)", gap: 8, padding: "0 16px" }}>
            {rows.slice(0, page).map((p) => (
              <SupplierCard key={p.id} p={{
                code: p.code || "—", name: p.name || "—", contact: p.contact || "No contact", phone: p.phone || "—", terms: termsLabel(p.terms), org: p.org,
                rating: p.rating, st: STATUS[p.status], dim: p.status !== "ACTIVE", selected: inPane && p.id === openId,
                onTap: () => navigate(`/m/suppliers/${encodeURIComponent(p.id)}`, inPane ? { replace: true } : undefined),
              }} />
            ))}
          </div>
          {rows.length > page ? <ShowMore label={`Show more · ${rows.length - page} left`} onTap={() => setPage((x) => x + PAGE)} /> : null}
        </>
      ) : null}
      <div style={{ height: 28 }} />

      <BottomSheet open={!!draft} onClose={() => setDraft(null)} title="Sort & filter" label="Sort and filter">
        {draft ? (
          <>
            <OptGroup first t="SORT BY" rows={([["name", "Name A–Z"], ["code", "Code"], ["rating", "Highest rating"]] as [SortKey, string][]).map(([k, l]) => ({ k, l, on: draft.sort === k, onTap: () => setDraft({ ...draft, sort: k }) }))} />
            <OptGroup t="PAYMENT TERMS" rows={["all", ...termKeys].map((k) => ({ k, l: k === "all" ? "Any" : termsLabel(k), on: draft.terms === k, onTap: () => setDraft({ ...draft, terms: k }) }))} />
            <OptGroup t="PURCHASE COMPANY" rows={["all", ...orgKeys].map((k) => ({ k, l: k === "all" ? "Any" : k, on: draft.org === k, onTap: () => setDraft({ ...draft, org: k }) }))} />
            <SheetButtons onReset={() => setDraft({ ...DEFAULT_DRAFT })} onApply={() => { setOpt(draft); setDraft(null); }} />
          </>
        ) : null}
      </BottomSheet>

      {adding ? (
        <SupplierForm editing={null} orgs={orgs} onClose={() => setAdding(false)} onSaved={({ id, message }) => {
          setAdding(false);
          // The new supplier's page shows the toast (this list may unmount on a phone).
          if (id) navigate(`/m/suppliers/${encodeURIComponent(id)}`, { state: { supToast: message } });
          else toast.show(message);
        }} />
      ) : null}
      {toast.node}
    </SupFrame>
  );
}
