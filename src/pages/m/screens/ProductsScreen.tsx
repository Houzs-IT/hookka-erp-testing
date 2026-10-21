// ===========================================================================
// ProductsScreen — L1 Products (phone): SKU Master | Catalog.
//
// Owner 2026-10-15, PHONE ONLY (<720px). Tablet keeps the generic
// ModuleListScreen exactly as before; the L2 detail (/m/products/:id, with
// BOM, dept working times and files) is the unchanged DocumentDetailScreen.
//
// Visual reference: Claude Design `Products Hub.dc.html`. Typography and
// shared pieces follow the approved phone Sales Orders screen. Everything shown
// is real data; the prototype's sample products, photos and prices are not used.
//   • SKUs        — GET /api/products (ACTIVE only; the API already withholds
//                   selling prices from roles without product-pricing:read).
//   • Families    — familyOf(code) → baseModel, as desktop Catalog.
//   • Photos      — GET /api/files?resourceType=modular (family photos, the
//                   same storage the desktop Catalog uploads to); cover first.
//   • Sofa prices — seatHeightPrices × tier (P1 / P2 / P3) behind "View
//                   prices"; rows follow Maintenance → Sofa → Sizes.
//   • Bedframe    — Price 1 (price1Sen) and Price 2 (basePriceSen).
//   • Accessory   — base price (basePriceSen).
// A missing price reads "No price" / "—", never RM 0.00. No "from" prices.
// Setup completeness and the prototype's ⋮ menu are deliberately not here.
// Pure logic lives in ../lib/products-hub.ts (tests/m-products-hub.test.mjs).
// ===========================================================================
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDownUp,
  BedDouble,
  Box,
  ChevronRight,
  Images,
  List,
  Package,
  Search,
  SearchX,
  Shapes,
  Sofa,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { useSofaSeatHeights } from "@/lib/use-sofa-seat-heights";
import { sofaSeatLabel } from "@/lib/sofa-seat-heights";
import { formatCurrency } from "@/lib/utils";
import { MobileCard, MobileHeader, Sheet } from "../components";
import { M, M_ACCENT, SEMANTIC } from "../theme";
import { productsConfig } from "../config/modules";
import { useDebounced } from "../lib/use-debounced";
import {
  SEGMENT_WRAP,
  SEGMENT_ICON,
  segmentTrack,
  segmentButton,
  CHIP_ROW,
  CHIP_ROW_CLASS,
  CHIP_COUNT,
  chip as chipStyle,
} from "../lib/control-styles";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { ModuleListScreen } from "./ModuleListScreen";
import {
  EMPTY_FILTERS,
  SOFA_TIERS,
  SOFA_TIER_KEY,
  buildFamilies,
  categoryKeys,
  categoryLabel,
  coverByFamily,
  familyCounts,
  familyPasses,
  fmtM3,
  fmtMinutes,
  inCategory,
  passesFilters,
  priceDisplay,
  readSofaTier,
  searchHub,
  seatPrice,
  seatRows,
  sizeOptions,
  sortFamilies,
  sortProducts,
  toHubProduct,
  type HubFamily,
  type HubFilters,
  type HubProduct,
  type SofaTier,
} from "../lib/products-hub";

// Prototype shadows (same values as the phone Sales Orders screen).
const SHADOW_CONTROL = "0 1px 2px rgba(31,29,27,.05),0 8px 22px -10px rgba(31,29,27,.18)";
const SHADOW_CARD = "0 1px 2px rgba(31,29,27,.05),0 10px 26px -14px rgba(31,29,27,.22)";
const SHADOW_LIST = "0 1px 2px rgba(31,29,27,.05),0 10px 28px -12px rgba(31,29,27,.20)";
const SHADOW_CHIP = "0 1px 2px rgba(31,29,27,.06),0 3px 8px -4px rgba(31,29,27,.10)";
const SHADOW_CHIP_ON = "0 4px 12px -6px rgba(107,92,50,.45)";
const SHADOW_SEG = "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)";
const SHADOW_ON = "0 6px 14px -6px rgba(107,92,50,.6)";
const SHADOW_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65)";
const SHADOW_FILTER_ON = "0 8px 18px -8px rgba(107,92,50,.6)";
// Repo label colour (v20 SoCard / DocCard; Sales Metric labels).
const LABEL = "#A89F8D";
const CHEVRON = "#C4BDB2";

const PRODUCTS_URL = productsConfig.sources[0].url;
const PHOTOS_URL = "/api/files?resourceType=modular";

type View = "sku" | "catalog";

/** Category glyph (static component, so React never sees a new type per render). */
function CatIcon({
  category,
  size,
  strokeWidth,
  color,
}: {
  category: string;
  size: number;
  strokeWidth: number;
  color?: string;
}) {
  const props = { size, strokeWidth, color };
  if (category === "SOFA") return <Sofa {...props} />;
  if (category === "BEDFRAME") return <BedDouble {...props} />;
  if (category === "ACCESSORY") return <Package {...props} />;
  return <Shapes {...props} />;
}

const money = (sen: number) => formatCurrency(sen);

function readTierPref(): SofaTier {
  try {
    return readSofaTier(window.localStorage.getItem(SOFA_TIER_KEY));
  } catch {
    return "PRICE_2";
  }
}

/** Phone gets the Products Hub; tablet keeps the existing config-driven list. */
export function ProductsScreen() {
  const phone = useResponsiveLayout().mode === "phone";
  return phone ? <PhoneProducts /> : <ModuleListScreen config={productsConfig} />;
}

function PhoneProducts() {
  const navigate = useNavigate();
  // View, category and search live in the URL (replace), so Back from a SKU
  // detail returns to the same view instead of resetting it.
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "catalog" ? "catalog" : "sku";
  const chip = (params.get("category") || "all").toUpperCase() === "ALL"
    ? "all"
    : (params.get("category") || "").toUpperCase();
  const [q, setQState] = useState(() => params.get("q") ?? "");
  const dq = useDebounced(q);

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setQ = (v: string) => {
    setQState(v);
    setParam("q", v.trim() ? v : null);
  };

  const { data, loading, error } = useCachedJson<unknown>(PRODUCTS_URL);
  const { data: photoData, loading: photosLoading } = useCachedJson<{ data?: unknown }>(PHOTOS_URL);
  const heights = useSofaSeatHeights();
  const { hasPermission, loading: permLoading } = usePermissions();
  const canPrice = !permLoading && hasPermission("product-pricing", "read");

  const [filters, setFilters] = useState<HubFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [famKey, setFamKey] = useState<string | null>(null);
  const [priceId, setPriceId] = useState<string | null>(null);
  const [tier, setTierState] = useState<SofaTier>(readTierPref);
  const setTier = (t: SofaTier) => {
    setTierState(t);
    try {
      window.localStorage.setItem(SOFA_TIER_KEY, t);
    } catch {
      /* preference only */
    }
  };

  const products = useMemo<HubProduct[]>(
    () => (data ? productsConfig.sources[0].select(data).map(toHubProduct) : []),
    [data],
  );
  const families = useMemo(() => buildFamilies(products), [products]);
  const covers = useMemo(() => coverByFamily(photoData?.data), [photoData]);
  const photosReady = !(photosLoading && !photoData);

  const skuList = useMemo(
    () =>
      sortProducts(
        products.filter((p) => inCategory(p.category, chip) && passesFilters(p, filters)),
        filters.sort,
      ),
    [products, chip, filters],
  );
  const famList = useMemo(
    () =>
      sortFamilies(
        families.filter((f) => inCategory(f.category, chip) && familyPasses(f, filters)),
        filters.sort,
      ),
    [families, chip, filters],
  );
  const searching = dq.trim().length > 0;
  const hits = useMemo(
    () => searchHub(products, families, dq, chip),
    [products, families, dq, chip],
  );

  const chips = useMemo(() => {
    return categoryKeys(products).map((k) => ({
      key: k,
      label: k === "all" ? "All" : categoryLabel(k),
      n:
        view === "sku"
          ? products.filter((p) => inCategory(p.category, k) && passesFilters(p, filters)).length
          : families.filter((f) => inCategory(f.category, k) && familyPasses(f, filters)).length,
    }));
  }, [products, families, view, filters]);

  const openSku = (p: HubProduct) => {
    setFamKey(null);
    navigate(`/m/products/${encodeURIComponent(p.id)}`);
  };
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const closeFam = useCallback(() => setFamKey(null), []);
  const closePrices = useCallback(() => setPriceId(null), []);

  const famRow = famKey ? families.find((f) => f.familyKey === famKey) ?? null : null;
  const priceRow = priceId ? products.find((p) => p.id === priceId) ?? null : null;
  const count = view === "sku" ? skuList.length : famList.length;
  const fCount = filters.sizes.length;
  // One URL write: two back-to-back setParams calls would clobber each other.
  const resetAll = () => {
    setQState("");
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("q");
        next.delete("category");
        return next;
      },
      { replace: true },
    );
    setFilters(EMPTY_FILTERS);
  };

  return (
    <>
      <MobileHeader title="Products" onBack={() => navigate(-1)} menu />

      <ViewSwitch view={view} onChange={(v) => setParam("view", v === "sku" ? null : v)} />
      <SearchField q={q} setQ={setQ} />
      <CategoryChips
        chips={chips}
        active={chip}
        onPick={(k) => setParam("category", k === "all" ? null : k)}
      />

      {loading && !data ? (
        <Msg text="Loading…" />
      ) : error && !data ? (
        <Msg text="Couldn’t load products." />
      ) : searching ? (
        <SearchResults
          q={dq.trim()}
          skus={hits.skus}
          exactId={hits.exactId}
          families={hits.families}
          onSku={openSku}
          onFamily={(f) => setFamKey(f.familyKey)}
          onReset={resetAll}
        />
      ) : (
        <>
          <ListBar
            count={count}
            word={view === "sku" ? (count === 1 ? "SKU" : "SKUS") : count === 1 ? "FAMILY" : "FAMILIES"}
            fCount={fCount}
            onFilter={() => setFilterOpen(true)}
          />
          {fCount > 0 ? (
            <ActiveFilters
              sizes={filters.sizes}
              onRemove={(z) => setFilters((f) => ({ ...f, sizes: f.sizes.filter((x) => x !== z) }))}
              onClear={() => setFilters((f) => ({ ...f, sizes: [] }))}
            />
          ) : null}
          {count === 0 ? (
            <Msg
              icon
              text={
                products.length === 0
                  ? "No active products yet."
                  : view === "sku"
                    ? "No SKUs match these filters."
                    : "No product families match these filters."
              }
              onReset={products.length > 0 ? resetAll : undefined}
            />
          ) : view === "sku" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 18px 120px" }}>
              {skuList.map((p) => (
                <SkuCard
                  key={p.id}
                  p={p}
                  canPrice={canPrice}
                  onOpen={() => openSku(p)}
                  onPrices={() => setPriceId(p.id)}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                columnGap: 12,
                rowGap: 14,
                padding: "8px 18px 120px",
              }}
            >
              {famList.map((f) => (
                <FamilyTile
                  key={`${f.category}:${f.familyKey}`}
                  f={f}
                  coverId={covers.get(f.familyKey) ?? null}
                  photosReady={photosReady}
                  onOpen={() => setFamKey(f.familyKey)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <FilterSheetProducts
        open={filterOpen}
        onClose={closeFilter}
        products={products}
        families={families}
        chip={chip}
        view={view}
        filters={filters}
        onApply={(f) => {
          setFilters(f);
          setFilterOpen(false);
        }}
      />
      <FamilySheet
        family={famRow}
        coverId={famRow ? covers.get(famRow.familyKey) ?? null : null}
        onClose={closeFam}
        onSku={openSku}
      />
      <PriceSheet
        product={priceRow}
        heights={heights}
        tier={tier}
        setTier={setTier}
        onClose={closePrices}
      />
    </>
  );
}

// ---- Top controls ------------------------------------------------------------

function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { key: View; label: string; icon: LucideIcon }[] = [
    { key: "sku", label: "SKU Master", icon: List },
    { key: "catalog", label: "Catalog", icon: Images },
  ];
  // Handoff segmented switch (lib/control-styles.ts, owner 2026-10-21).
  return (
    <div style={SEGMENT_WRAP}>
      <div role="group" aria-label="Products view" style={segmentTrack(opts.length)}>
        {opts.map(({ key, label, icon: Icon }) => {
          const on = view === key;
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => onChange(key)} style={segmentButton(on)}>
              <Icon {...SEGMENT_ICON} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SearchField({ q, setQ }: { q: string; setQ: (v: string) => void }) {
  return (
    <div style={{ padding: "14px 18px 4px" }}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 44,
          padding: "0 4px 0 13px",
          boxSizing: "border-box",
          backgroundColor: M.card,
          borderRadius: 14,
          boxShadow: SHADOW_CONTROL,
        }}
      >
        <Search size={18} strokeWidth={1.75} color={M.muted} style={{ flexShrink: 0 }} />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          placeholder="Search SKU code, product or model"
          aria-label="Search SKUs and product families"
          onChange={(e) => setQ(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            padding: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 16,
            color: M.raisin,
            textOverflow: "ellipsis",
          }}
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            style={{
              width: 40,
              height: 44,
              flexShrink: 0,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              color: M.muted,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                backgroundColor: M.divider,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={13} strokeWidth={2.4} />
            </span>
          </button>
        ) : null}
      </label>
    </div>
  );
}

function CategoryChips({
  chips,
  active,
  onPick,
}: {
  chips: { key: string; label: string; n: number }[];
  active: string;
  onPick: (k: string) => void;
}) {
  // Handoff filter chips (lib/control-styles.ts, owner 2026-10-21).
  return (
    <div role="group" aria-label="Category" className={CHIP_ROW_CLASS} style={CHIP_ROW}>
      {chips.map((c) => {
        const on = active === c.key;
        return (
          <button key={c.key} type="button" onClick={() => onPick(c.key)} aria-pressed={on} style={chipStyle(on)}>
            {c.label}
            <span style={CHIP_COUNT}>{c.n}</span>
          </button>
        );
      })}
    </div>
  );
}

function ListBar({
  count,
  word,
  fCount,
  onFilter,
}: {
  count: number;
  word: string;
  fCount: number;
  onFilter: () => void;
}) {
  const active = fCount > 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 15px 1px 18px" }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: M.muted,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count} {word}
      </span>
      <span style={{ flex: 1, minWidth: 8, height: 1, backgroundColor: M.hairline }} />
      <button
        type="button"
        onClick={onFilter}
        aria-label={active ? `Filter and sort, ${fCount} active` : "Filter and sort"}
        aria-haspopup="dialog"
        title="Filter & sort"
        style={{
          width: 44,
          height: 44,
          flex: "none",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "none",
          border: "none",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          style={{
            position: "relative",
            width: 38,
            height: 38,
            borderRadius: 999,
            backgroundColor: active ? M.taupe : M.card,
            color: active ? M.paper : M.taupe,
            boxShadow: active ? SHADOW_FILTER_ON : SHADOW_CONTROL,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ArrowDownUp size={16} strokeWidth={1.9} />
          {active ? (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                minWidth: 17,
                height: 17,
                padding: "0 4px",
                boxSizing: "border-box",
                borderRadius: 999,
                backgroundColor: SEMANTIC.DANGER.hex,
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 0 0 2px ${M.paper}`,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fCount}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

function ActiveFilters({
  sizes,
  onRemove,
  onClear,
}: {
  sizes: string[];
  onRemove: (z: string) => void;
  onClear: () => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "6px 18px 2px" }}>
      {sizes.map((z) => (
        <button
          key={z}
          type="button"
          onClick={() => onRemove(z)}
          aria-label={`Remove filter: ${z}`}
          style={{
            height: 30,
            maxWidth: "100%",
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "0 10px 0 12px",
            borderRadius: 999,
            border: "none",
            backgroundColor: M_ACCENT.gold.bg,
            color: M.taupe,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            boxShadow: SHADOW_CHIP_ON,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{z}</span>
          <X size={13} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        style={{
          height: 30,
          padding: "0 6px",
          border: "none",
          background: "transparent",
          color: M.taupe,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        Clear all
      </button>
    </div>
  );
}

// ---- SKU Master card ---------------------------------------------------------

function usePressed() {
  const [pressed, setPressed] = useState(false);
  const on = () => setPressed(true);
  const off = () => setPressed(false);
  return {
    pressed,
    handlers: { onPointerDown: on, onPointerUp: off, onPointerLeave: off, onPointerCancel: off },
  };
}

function SkuCard({
  p,
  canPrice,
  onOpen,
  onPrices,
}: {
  p: HubProduct;
  canPrice: boolean;
  onOpen: () => void;
  onPrices: () => void;
}) {
  const { pressed, handlers } = usePressed();
  const vol = fmtM3(p.unitM3);
  const time = fmtMinutes(p.productionTimeMinutes);
  const sub = [p.baseModel ? `Model ${p.baseModel}` : "", p.sizeLabel].filter(Boolean).join(" · ");

  return (
    <div
      {...handlers}
      style={{ transform: pressed ? "scale(.985)" : "none", transition: "transform .12s ease" }}
    >
      <MobileCard
        onClick={onOpen}
        padded={false}
        radius={16}
        style={{ border: "none", padding: "14px 16px 13px", boxShadow: SHADOW_CARD }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 700,
              color: M.taupe,
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {p.code || "—"}
          </span>
          <span
            style={{
              flex: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              color: M.muted,
            }}
          >
            <CatIcon category={p.category} size={13} strokeWidth={1.8} />
            {categoryLabel(p.category)}
          </span>
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 15,
            fontWeight: 700,
            color: M.raisin,
            letterSpacing: "-0.2px",
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            overflowWrap: "anywhere",
          }}
        >
          {p.name || "—"}
        </div>
        {sub ? (
          <div
            style={{
              marginTop: 2,
              fontSize: 12.5,
              fontWeight: 500,
              color: M.body,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sub}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 12,
            paddingTop: 11,
            borderTop: `1px solid ${M.divider}`,
            minHeight: 34,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
            {vol ? <Spec icon={Box} text={vol} /> : null}
            {time ? <Spec icon={Timer} text={time} /> : null}
            {!vol && !time ? <span style={{ fontSize: 12, color: LABEL }}>No specs recorded</span> : null}
          </div>
          {canPrice ? <PriceSlot p={p} onPrices={onPrices} /> : null}
        </div>
      </MobileCard>
    </div>
  );
}

function Spec({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 13,
        fontWeight: 600,
        color: M.ink,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={13} strokeWidth={1.8} color={LABEL} />
      {text}
    </span>
  );
}

const slotLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: LABEL,
  whiteSpace: "nowrap",
};
const slotValue: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: M.raisin,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

function PriceSlot({ p, onPrices }: { p: HubProduct; onPrices: () => void }) {
  const d = priceDisplay(p);
  if (d.kind === "none") {
    return <div style={{ flex: "none", fontSize: 12, color: LABEL, whiteSpace: "nowrap" }}>No price</div>;
  }
  if (d.kind === "sofa") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPrices();
        }}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label={`View seat prices for ${p.code}`}
        aria-haspopup="dialog"
        style={{
          flex: "none",
          margin: "-6px -8px -6px 0",
          minHeight: 44,
          padding: "4px 8px",
          border: "none",
          background: "none",
          borderRadius: 10,
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span style={slotLabel}>SEAT PRICES</span>
        <span style={{ ...slotValue, marginTop: 2, color: M.taupe, display: "inline-flex", alignItems: "center", gap: 2 }}>
          View prices
          <ChevronRight size={14} strokeWidth={2.2} />
        </span>
      </button>
    );
  }
  if (d.kind === "bedframe") {
    const row = (label: string, v: number | undefined) => (
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
        <span style={slotLabel}>{label}</span>
        <span style={{ ...slotValue, color: v == null ? CHEVRON : M.raisin }}>{v == null ? "—" : money(v)}</span>
      </div>
    );
    return (
      <div style={{ flex: "none", display: "grid", rowGap: 2 }}>
        {row("PRICE 1", d.p1)}
        {row("PRICE 2", d.p2)}
      </div>
    );
  }
  return (
    <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span style={slotLabel}>PRICE</span>
      <span style={{ ...slotValue, marginTop: 2 }}>{money(d.base)}</span>
    </div>
  );
}

// ---- Catalog tile ------------------------------------------------------------

function FamilyPhoto({
  coverId,
  photosReady,
  name,
  category,
  iconSize,
}: {
  coverId: string | null;
  photosReady: boolean;
  name: string;
  category: string;
  iconSize: number;
}) {
  // Keyed by cover id so a new cover resets the failed state.
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImg = coverId != null && failedId !== coverId;
  return (
    <>
      {showImg ? (
        <img
          src={`/api/files/${encodeURIComponent(coverId)}/download`}
          alt={name}
          loading="lazy"
          decoding="async"
          className="m-no-invert"
          onError={() => setFailedId(coverId)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : photosReady ? (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: iconSize * 2 + 2,
              height: iconSize * 2 + 2,
              borderRadius: "50%",
              backgroundColor: M.card,
              opacity: 0.8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CatIcon category={category} size={iconSize} strokeWidth={1.5} color={LABEL} />
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: M.muted }}>No photo</span>
        </span>
      ) : null}
    </>
  );
}

function FamilyTile({
  f,
  coverId,
  photosReady,
  onOpen,
}: {
  f: HubFamily;
  coverId: string | null;
  photosReady: boolean;
  onOpen: () => void;
}) {
  const { pressed, handlers } = usePressed();
  return (
    <button
      type="button"
      {...handlers}
      onClick={onOpen}
      aria-label={`${f.familyKey} ${f.name}, ${familyCounts(f)}`}
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        border: "none",
        padding: 0,
        backgroundColor: M.card,
        borderRadius: 18,
        overflow: "hidden",
        cursor: "pointer",
        boxShadow: SHADOW_CARD,
        transform: pressed ? "scale(.98)" : "none",
        transition: "transform .12s ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          aspectRatio: "1 / 1",
          overflow: "hidden",
          background: `linear-gradient(160deg, ${M.divider} 0%, ${M.border} 100%)`,
        }}
      >
        <FamilyPhoto
          coverId={coverId}
          photosReady={photosReady}
          name={f.name || f.familyKey}
          category={f.category}
          iconSize={22}
        />
      </span>
      <span style={{ display: "block", padding: "11px 12px 13px", minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.6,
            color: LABEL,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {categoryLabel(f.category).toUpperCase()} <span style={{ color: M.taupe }}>· {f.familyKey}</span>
        </span>
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            overflowWrap: "anywhere",
            fontSize: 14,
            fontWeight: 700,
            color: M.raisin,
            letterSpacing: "-0.2px",
            lineHeight: 1.3,
            marginTop: 4,
            minHeight: 36,
          }}
        >
          {f.name || f.familyKey}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 12,
            color: M.body,
            marginTop: 5,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {familyCounts(f)}
        </span>
      </span>
    </button>
  );
}

// ---- Search results ----------------------------------------------------------

function SectionLabel({ text, first }: { text: string; first?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: `${first ? 4 : 18}px 2px 8px` }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.muted, whiteSpace: "nowrap" }}>
        {text}
      </span>
      <span style={{ flex: 1, height: 1, backgroundColor: M.hairline }} />
    </div>
  );
}

const listCard: CSSProperties = {
  backgroundColor: M.card,
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: SHADOW_LIST,
};

function rowBtn(i: number, minHeight: number): CSSProperties {
  return {
    width: "100%",
    minHeight,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 14px",
    border: "none",
    borderTop: i ? `1px solid ${M.divider}` : "none",
    backgroundColor: M.card,
    cursor: "pointer",
    textAlign: "left",
    WebkitTapHighlightColor: "transparent",
  };
}

const rowTitle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  color: M.raisin,
  fontVariantNumeric: "tabular-nums",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const rowSub: CSSProperties = {
  display: "block",
  fontSize: 12,
  color: M.muted,
  marginTop: 2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function SearchResults({
  q,
  skus,
  exactId,
  families,
  onSku,
  onFamily,
  onReset,
}: {
  q: string;
  skus: HubProduct[];
  exactId: string | null;
  families: HubFamily[];
  onSku: (p: HubProduct) => void;
  onFamily: (f: HubFamily) => void;
  onReset: () => void;
}) {
  if (skus.length === 0 && families.length === 0) {
    return <Msg icon text={`No SKUs or families match “${q}”.`} onReset={onReset} />;
  }
  return (
    <div style={{ padding: "10px 18px 120px" }}>
      {skus.length > 0 ? (
        <>
          <SectionLabel first text={`SKUS · ${skus.length}`} />
          <div style={listCard}>
            {skus.map((p, i) => (
              <button key={p.id} type="button" onClick={() => onSku(p)} style={rowBtn(i, 58)}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ ...rowTitle, minWidth: 0 }}>{p.code}</span>
                    {p.id === exactId ? (
                      <span
                        style={{
                          flex: "none",
                          fontSize: 10,
                          fontWeight: 700,
                          color: M.taupe,
                          backgroundColor: M_ACCENT.gold.bg,
                          padding: "1px 6px",
                          borderRadius: 999,
                        }}
                      >
                        Exact
                      </span>
                    ) : null}
                  </span>
                  <span style={rowSub}>{[p.name, p.sizeLabel].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <ChevronRight size={16} strokeWidth={1.9} color={CHEVRON} style={{ flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </>
      ) : null}
      {families.length > 0 ? (
        <>
          <SectionLabel first={skus.length === 0} text={`PRODUCT FAMILIES · ${families.length}`} />
          <div style={listCard}>
            {families.map((f, i) => {
              return (
                <button
                  key={`${f.category}:${f.familyKey}`}
                  type="button"
                  onClick={() => onFamily(f)}
                  style={{ ...rowBtn(i, 62), gap: 12 }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      backgroundColor: M.divider,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    <CatIcon category={f.category} size={18} strokeWidth={1.6} color={LABEL} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={rowTitle}>
                      {f.familyKey}
                      {f.name ? ` · ${f.name}` : ""}
                    </span>
                    <span style={rowSub}>
                      {categoryLabel(f.category)} · {familyCounts(f)}
                    </span>
                  </span>
                  <ChevronRight size={16} strokeWidth={1.9} color={CHEVRON} style={{ flexShrink: 0 }} />
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---- Sheets ------------------------------------------------------------------

function FamilySheet({
  family,
  coverId,
  onClose,
  onSku,
}: {
  family: HubFamily | null;
  coverId: string | null;
  onClose: () => void;
  onSku: (p: HubProduct) => void;
}) {
  return (
    <Sheet open={family != null} onClose={onClose} title={family ? family.name || family.familyKey : ""}>
      {family ? (
        <div style={{ display: "grid", gap: 14 }}>
          {coverId ? (
            <div
              style={{
                position: "relative",
                borderRadius: 16,
                overflow: "hidden",
                aspectRatio: "16 / 9",
                background: `linear-gradient(160deg, ${M.divider} 0%, ${M.border} 100%)`,
              }}
            >
              <FamilyPhoto
                coverId={coverId}
                photosReady
                name={family.name || family.familyKey}
                category={family.category}
                iconSize={20}
              />
            </div>
          ) : null}
          <div style={{ margin: "0 2px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: M.taupe }}>
              {family.familyKey} · {categoryLabel(family.category)}
            </div>
            <div style={{ fontSize: 12, color: M.muted, marginTop: 2 }}>{familyCounts(family)}</div>
          </div>
          {family.variants.map((v) => (
            <section key={v.baseModel} aria-label={`Model ${v.baseModel}`}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "0 2px 8px" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1,
                    color: M.muted,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  MODEL {v.baseModel}
                </span>
                <span style={{ fontSize: 11, color: M.muted, flex: "none" }}>
                  {v.products.length} SKU{v.products.length === 1 ? "" : "s"}
                </span>
              </div>
              <div style={listCard}>
                {v.products.map((p, i) => (
                  <button key={p.id} type="button" onClick={() => onSku(p)} style={rowBtn(i, 54)}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={rowTitle}>{p.code}</span>
                      {p.sizeLabel ? <span style={rowSub}>{p.sizeLabel}</span> : null}
                    </span>
                    <ChevronRight size={16} strokeWidth={1.9} color={CHEVRON} style={{ flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </Sheet>
  );
}

function TierSwitch({ tier, setTier }: { tier: SofaTier; setTier: (t: SofaTier) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Sofa price tier"
      style={{
        display: "inline-grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 2,
        height: 32,
        boxSizing: "border-box",
        padding: 3,
        borderRadius: 10,
        backgroundColor: M.divider,
      }}
    >
      {SOFA_TIERS.map((t) => {
        const on = tier === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTier(t.value)}
            style={{
              minWidth: 34,
              padding: "0 6px",
              border: "none",
              borderRadius: 8,
              backgroundColor: on ? M.card : "transparent",
              boxShadow: on ? SHADOW_SEG : "none",
              color: on ? M.raisin : M.ink,
              fontSize: 12,
              fontWeight: on ? 700 : 600,
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function PriceSheet({
  product,
  heights,
  tier,
  setTier,
  onClose,
}: {
  product: HubProduct | null;
  heights: string[];
  tier: SofaTier;
  setTier: (t: SofaTier) => void;
  onClose: () => void;
}) {
  const tierLabel = SOFA_TIERS.find((t) => t.value === tier)?.label ?? "P2";
  return (
    <Sheet open={product != null} onClose={onClose} title="Seat prices">
      {product ? (
        <>
          <div style={{ margin: "0 2px 10px", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums" }}>
              {product.code}
            </div>
            <div
              style={{
                fontSize: 12,
                color: M.muted,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {[product.name, product.sizeLabel].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={listCard}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                backgroundColor: M.paper,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: M.muted }}>SEAT SIZE</span>
              <TierSwitch tier={tier} setTier={setTier} />
            </div>
            {seatRows(product, heights).map((h) => {
              const v = seatPrice(product, h, tier);
              return (
                <div
                  key={h}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    minHeight: 46,
                    padding: "0 14px",
                    borderTop: `1px solid ${M.divider}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: M.raisin }}>{sofaSeatLabel(h)}</span>
                  <span style={{ fontSize: 13, fontWeight: v == null ? 500 : 700, color: v == null ? CHEVRON : M.raisin }}>
                    {v == null ? "—" : money(v)}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: M.muted, lineHeight: 1.5, margin: "10px 2px 0" }}>
            Showing {tierLabel}. “—” means no price is set for that size and tier. Sizes follow
            Maintenance → Sofa → Sizes.
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

function FilterSheetProducts({
  open,
  onClose,
  products,
  families,
  chip,
  view,
  filters,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  products: HubProduct[];
  families: HubFamily[];
  chip: string;
  view: View;
  filters: HubFilters;
  onApply: (f: HubFilters) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Filter & sort">
      {open ? (
        <FilterBody
          products={products}
          families={families}
          chip={chip}
          view={view}
          initial={filters}
          onApply={onApply}
        />
      ) : null}
    </Sheet>
  );
}

/** Mounted per opening, so the draft starts from the applied filters. */
function FilterBody({
  products,
  families,
  chip,
  view,
  initial,
  onApply,
}: {
  products: HubProduct[];
  families: HubFamily[];
  chip: string;
  view: View;
  initial: HubFilters;
  onApply: (f: HubFilters) => void;
}) {
  const [draft, setDraft] = useState<HubFilters>(initial);
  const sizes = useMemo(() => {
    const opts = sizeOptions(products, chip);
    // Keep an applied size visible even when the category no longer has it.
    for (const z of draft.sizes) if (!opts.includes(z)) opts.push(z);
    return opts;
  }, [products, chip, draft.sizes]);
  const n =
    view === "sku"
      ? products.filter((p) => inCategory(p.category, chip) && passesFilters(p, draft)).length
      : families.filter((f) => inCategory(f.category, chip) && familyPasses(f, draft)).length;
  const showLabel =
    view === "sku" ? (n === 1 ? "Show 1 SKU" : `Show ${n} SKUs`) : n === 1 ? "Show 1 family" : `Show ${n} families`;

  return (
    <>
      <div style={{ display: "grid", gap: 22, paddingTop: 4 }}>
        <section aria-label="Sort by">
          <div style={{ margin: "0 2px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.muted }}>
            SORT BY
          </div>
          <div
            role="radiogroup"
            aria-label="Sort by"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 4,
              height: 44,
              boxSizing: "border-box",
              padding: 4,
              borderRadius: 14,
              backgroundColor: M.divider,
            }}
          >
            {(
              [
                ["name", "Name A – Z"],
                ["code", "Code A – Z"],
              ] as const
            ).map(([k, label]) => {
              const on = draft.sort === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setDraft((d) => ({ ...d, sort: k }))}
                  style={{
                    minWidth: 0,
                    border: "none",
                    borderRadius: 10,
                    backgroundColor: on ? M.card : "transparent",
                    boxShadow: on ? SHADOW_SEG : "none",
                    color: on ? M.raisin : M.ink,
                    fontSize: 13,
                    fontWeight: on ? 700 : 600,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>
        {sizes.length > 0 ? (
          <section aria-label="Size">
            <div style={{ margin: "0 2px 10px", fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.muted }}>
              SIZE / CONFIGURATION
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {sizes.map((z) => {
                const on = draft.sizes.includes(z);
                return (
                  <button
                    key={z}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        sizes: on ? d.sizes.filter((x) => x !== z) : [...d.sizes, z],
                      }))
                    }
                    style={{
                      height: 36,
                      maxWidth: "100%",
                      boxSizing: "border-box",
                      padding: "0 14px",
                      borderRadius: 999,
                      border: "none",
                      backgroundColor: on ? M.taupe : M.card,
                      color: on ? M.paper : M.ink,
                      fontSize: 12,
                      fontWeight: on ? 700 : 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      boxShadow: on ? SHADOW_ON : SHADOW_CHIP,
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {z}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      {/* Sticky actions; negative margins cancel the Sheet's padding so the bar is flush. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          display: "flex",
          gap: 10,
          margin: "22px -16px calc(-16px - max(16px, env(safe-area-inset-bottom)))",
          padding: "12px 16px max(16px, env(safe-area-inset-bottom))",
          backgroundColor: M.paper,
          boxShadow: `0 -1px 0 ${M.hairline}`,
        }}
      >
        <button
          type="button"
          onClick={() => setDraft(EMPTY_FILTERS)}
          style={{ ...footerBtn, flex: 1, backgroundColor: M.card, color: M.body, boxShadow: SHADOW_CONTROL }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => onApply(draft)}
          style={{
            ...footerBtn,
            flex: 1.4,
            background: `linear-gradient(135deg, ${M.logoFrom}, ${M.logoTo})`,
            color: M.paper,
            fontVariantNumeric: "tabular-nums",
            boxShadow: SHADOW_PRIMARY,
          }}
        >
          {showLabel}
        </button>
      </div>
    </>
  );
}

const footerBtn: CSSProperties = {
  height: 46,
  border: "none",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

// ---- Empty / loading ---------------------------------------------------------

function Msg({ text, icon, onReset }: { text: string; icon?: boolean; onReset?: () => void }) {
  return (
    <div
      style={{
        padding: icon ? "44px 18px" : "40px 18px",
        textAlign: "center",
        color: M.muted,
        fontSize: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: icon ? 14 : 12,
        overflowWrap: "anywhere",
      }}
    >
      {icon ? (
        <span
          aria-hidden="true"
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            backgroundColor: M.divider,
            color: M.taupe,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SearchX size={22} strokeWidth={1.75} />
        </span>
      ) : null}
      {text}
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            height: 44,
            padding: "0 18px",
            borderRadius: 999,
            border: "none",
            backgroundColor: M.card,
            color: M.ink,
            fontSize: 14,
            fontWeight: 700,
            boxShadow: SHADOW_CONTROL,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Reset search &amp; filters
        </button>
      ) : null}
    </div>
  );
}
