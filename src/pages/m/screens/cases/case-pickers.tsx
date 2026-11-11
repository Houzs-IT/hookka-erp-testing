// Shared pickers for Quick Report + the edit overlays (prototype bottom sheets):
//  - PartsPickerSheet: damaged parts from the CANONICAL BOM breakdown
//    (GET /api/sales-orders/repair-components) — never typed, never re-derived.
//  - CatalogPickerSheet: real products from GET /api/products (productId is the
//    catalogue id — no free-text product codes).
import { useMemo, useState } from "react";
import { CirclePlus } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { Sheet } from "../../components";
import { M } from "../../theme";
import { repairComponentsUrl, type ComponentPick, type ProductVariant, type RepairComponentOption } from "./repair-components";
import { Chip, SearchField, Stepper } from "./case-ui";
import { CC, SH_CARD } from "./case-style";

const sub = (t: string) => <div style={{ fontSize: 12, color: M.ink, marginTop: -8, marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</div>;

// ---------------------------------------------------------------------------
type PartsProps = {
  open: boolean;
  onClose: () => void;
  productLabel: string;
  variant: ProductVariant | null;
  picks: ComponentPick[];
  onDone: (next: ComponentPick[]) => void;
};

function PartsPickerInner({ open, onClose, productLabel, variant, picks, onDone }: PartsProps) {
  const url = open && variant ? repairComponentsUrl(variant) : null;
  const { data, loading, error } = useCachedJson<{ success?: boolean; data?: RepairComponentOption[] }>(url, 60);
  const options = useMemo(() => (Array.isArray(data?.data) ? data.data : []), [data]);
  const [draft, setDraft] = useState<ComponentPick[]>(picks);

  const toggle = (o: RepairComponentOption) =>
    setDraft((d) => (d.some((p) => p.key === o.key) ? d.filter((p) => p.key !== o.key) : [...d, { key: o.key, label: o.label, qty: 1 }]));
  const setQty = (o: RepairComponentOption, delta: number) => {
    const max = Math.max(1, Math.floor(o.qty) || 1);
    setDraft((d) => d.map((p) => (p.key === o.key ? { ...p, qty: Math.min(max, Math.max(1, p.qty + delta)) } : p)));
  };

  return (
    <Sheet open={open} onClose={onClose} title="Damaged parts">
      {sub(productLabel)}
      {loading && !data ? (
        <div aria-busy="true">
          <div style={{ fontSize: 12.5, color: M.ink, marginBottom: 10 }}>Loading parts from the product’s BOM…</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {[110, 84, 130].map((w) => <span key={w} style={{ width: w, height: 36, borderRadius: 999, background: "#EFEAE1" }} />)}
          </div>
        </div>
      ) : error && !data ? (
        <div role="alert" style={{ padding: "10px 12px", borderRadius: 12, background: CC.errBg, color: CC.dangerDark, fontSize: 13 }}>
          Couldn’t load this product’s parts. Without a pick the whole product is recorded.
        </div>
      ) : options.length === 0 ? (
        <div style={{ padding: "10px 12px", borderRadius: 12, background: M.card, color: M.ink, fontSize: 13, lineHeight: 1.45, boxShadow: SH_CARD }}>
          This product’s BOM has no separate parts to pick, so the whole product is recorded.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {options.map((o) => {
            const pick = draft.find((p) => p.key === o.key);
            const max = Math.max(1, Math.floor(o.qty) || 1);
            return (
              <div key={o.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Chip role="checkbox" label={max > 1 ? `${o.label} ×${max}` : o.label} on={!!pick} onClick={() => toggle(o)} h={36} pad={14} />
                {pick && max > 1 ? <Stepper label={`${o.label} quantity`} value={pick.qty} decDisabled={pick.qty <= 1} incDisabled={pick.qty >= max} onDec={() => setQty(o, -1)} onInc={() => setQty(o, 1)} /> : null}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 12, color: M.ink, marginTop: 12 }}>
        {draft.length ? `${draft.length} part${draft.length === 1 ? "" : "s"} picked` : "None picked = whole product"}
      </div>
      <div style={{ position: "sticky", bottom: -16, margin: "12px -16px -16px", padding: "12px 16px calc(16px + env(safe-area-inset-bottom, 0px))", background: M.paper, boxShadow: "0 -1px 0 #E6E0D9" }}>
        <button type="button" onClick={() => { onDone(draft); onClose(); }} style={{ width: "100%", height: 46, border: "none", borderRadius: 12, background: M.taupe, color: "var(--m-text-on-accent)", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Done</button>
      </div>
    </Sheet>
  );
}

export function PartsPickerSheet(p: PartsProps) {
  return p.open ? <PartsPickerInner {...p} /> : null;
}

// ---------------------------------------------------------------------------
export type CatalogProduct = { id: string; code: string; name: string };

export function CatalogPickerSheet({
  open,
  onClose,
  excludeIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  excludeIds: string[];
  onPick: (p: CatalogProduct) => void;
}) {
  const { data, loading } = useCachedJson<{ data?: CatalogProduct[] }>(open ? "/api/products" : null);
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const skip = new Set(excludeIds);
    return (data?.data ?? [])
      .filter((p) => !skip.has(p.id) && (p.code.toLowerCase().includes(t) || p.name.toLowerCase().includes(t)))
      .slice(0, 10);
  }, [q, data, excludeIds]);
  return (
    <Sheet open={open} onClose={onClose} title="Add from catalogue">
      {sub("Catalogue products only — no free text")}
      <div style={{ display: "flex" }}><SearchField value={q} onChange={setQ} placeholder="Search product code or name" label="Search catalogue" /></div>
      {loading && !data ? <div style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>Loading products…</div> : null}
      {q.trim() && hits.length === 0 && data ? <div role="status" style={{ padding: "18px 12px", textAlign: "center", fontSize: 13, color: M.ink }}>No catalogue products match.</div> : null}
      <div style={{ display: "grid", gap: 8, marginTop: 10, paddingBottom: 12 }}>
        {hits.map((p) => (
          <button key={p.id} type="button" onClick={() => { onPick(p); onClose(); setQ(""); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", border: "none", borderRadius: 14, background: M.card, fontFamily: "inherit", textAlign: "left", cursor: "pointer", boxShadow: "0 1px 2px rgba(31,29,27,.05),0 8px 22px -12px rgba(31,29,27,.18)" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{p.name || p.code}</span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: CC.brown, marginTop: 1 }}>{p.code}</span>
            </span>
            <CirclePlus size={20} strokeWidth={1.9} color={CC.brown} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
