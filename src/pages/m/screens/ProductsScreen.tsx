// ===========================================================================
// ProductsScreen — L1 Products: SKU Master | Catalog, phone AND tablet.
//
// Owner 2026-10-15 (phone), 2026-10-21 (Products Hub v2 visual refresh, and
// tablet moved off the generic ModuleListScreen onto this hub: responsive
// grid, one column in the split pane). The L2 detail
// (/m/products/:id, with BOM, dept working times and files) is the unchanged
// DocumentDetailScreen.
//
// Visual reference: Claude Design `Products Hub v2.dc.html` (category tones,
// chip dots, SKU card, featured family + photo grid). Typography follows the
// approved phone Sales Orders screen. Everything shown is real data; the
// prototype's sample products, photos and prices are not used.
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
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { M, SEMANTIC } from "../theme";
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
  chipDot,
} from "../lib/control-styles";
import { useResponsiveLayout } from "../lib/responsive-layout";
import { PHOTOS_URL, PRODUCTS_URL, toneOf, usePressed, useSofaTier } from "../lib/products-ui";
import {
  EMPTY_FILTERS,
  SOFA_TIERS,
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
const SHADOW_LIST = "0 1px 2px rgba(31,29,27,.05),0 10px 28px -12px rgba(31,29,27,.20)";
const SHADOW_SEG = "0 1px 2px rgba(31,29,27,.08),0 6px 14px -6px rgba(31,29,27,.20)";
const SHADOW_PRIMARY = "0 8px 18px -8px rgba(107,92,50,.65)";
const SHADOW_FILTER_ON = "0 8px 18px -8px rgba(107,92,50,.6)";
// Products Hub v2 card + featured shadows (handoff item 5).
const SHADOW_V2 = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.28)";
const SHADOW_FEATURED = "0 2px 4px rgba(31,29,27,.06),0 18px 36px -18px rgba(31,29,27,.45)";
// Frosted pill over a photo (same in both themes: it sits on the photo).
const FROSTED: CSSProperties = {
  backgroundColor: "rgba(255,255,255,.9)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
};
// Repo label colour (v20 SoCard / DocCard; Sales Metric labels).
const LABEL = "#A89F8D";
const CHEVRON = "#C4BDB2";

type View = "sku" | "catalog";

/** Category glyph (static component, so React never sees a new type per render). */
export function CatIcon({
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

/** One Products Hub for phone and tablet (owner 2026-10-21). */
export function ProductsScreen() {
  const navigate = useNavigate();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  // In the tablet split view this list renders beside /m/products/:id.
  const { id: openId } = useParams();
  const inPane = layout.canSplitDetail && !!openId;
  const wide = tablet && !inPane;
  const bottomPad = layout.hasBottomNavigation ? 120 : 32;
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
  const [tier, setTier] = useSofaTier();

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
            word={view === "sku" ? (count === 1 ? "SKU" : "SKUs") : count === 1 ? "product family" : "product families"}
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
            <div
              style={{
                display: "grid",
                gridTemplateColumns: wide ? "repeat(auto-fill, minmax(320px, 1fr))" : "minmax(0, 1fr)",
                gap: 12,
                alignItems: "start",
                padding: `8px 18px ${bottomPad}px`,
              }}
            >
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
            <CatalogGrid
              families={famList}
              covers={covers}
              photosReady={photosReady}
              wide={wide}
              bottomPad={bottomPad}
              onOpen={(f) => setFamKey(f.familyKey)}
            />
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
        canPrice={canPrice}
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
            {/* Category-tone dot (Products Hub v2); none on "All". */}
            {c.key !== "all" ? (
              <span
                aria-hidden="true"
                style={{
                  ...chipDot(toneOf(c.key).fg),
                  boxShadow: on ? "0 0 0 1.5px rgba(255,255,255,.85)" : undefined,
                }}
              />
            ) : null}
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
    // Claude Design count bar (owner-approved A4): the number, then the noun.
    // The 44px filter hit area keeps a 3px inset, so the right gutter is 15.
    <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "10px 15px 0 18px" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: M.raisin, letterSpacing: "-0.2px", fontVariantNumeric: "tabular-nums" }}>
          {count}
        </span>
        <span style={{ fontSize: 13, color: M.muted, overflow: "hidden", textOverflow: "ellipsis" }}>{word}</span>
      </div>
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
            backgroundColor: "var(--m-gold-tint)",
            color: M.taupe,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
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
        Clear
      </button>
    </div>
  );
}

// ---- SKU Master card ---------------------------------------------------------

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
  const tone = toneOf(p.category);
  const vol = fmtM3(p.unitM3);
  const time = fmtMinutes(p.productionTimeMinutes);
  // Claude Design list card: "{model} · {size}" (no "Model" prefix — that is the detail's wording).
  const subParts = [p.baseModel, p.sizeLabel].filter(Boolean);
  const aria = [p.code, p.name, p.sizeLabel].filter(Boolean).join(", ");

  return (
    <div
      {...handlers}
      style={{ minWidth: 0, transform: pressed ? "scale(.985)" : "none", transition: "transform .12s ease" }}
    >
      <MobileCard
        onClick={onOpen}
        ariaLabel={aria}
        padded={false}
        radius={18}
        style={{
          position: "relative",
          display: "flex",
          gap: 12,
          overflow: "hidden",
          border: "none",
          padding: "14px 12px 14px 14px",
          boxShadow: SHADOW_V2,
        }}
      >
        {/* 3px category rail */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 14,
            bottom: 14,
            width: 3,
            borderRadius: "0 3px 3px 0",
            backgroundColor: tone.fg,
          }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 42,
            height: 42,
            flex: "none",
            borderRadius: 13,
            backgroundColor: tone.bg,
            color: tone.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CatIcon category={p.category} size={22} strokeWidth={1.7} />
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                fontWeight: 700,
                color: M.taupe,
                letterSpacing: 0.2,
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
                height: 22,
                display: "inline-flex",
                alignItems: "center",
                padding: "0 9px",
                borderRadius: 999,
                backgroundColor: tone.bg,
                color: tone.fg,
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {categoryLabel(p.category)}
            </span>
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 15,
              fontWeight: 700,
              color: M.raisin,
              letterSpacing: "-0.25px",
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
          {subParts.length ? (
            <div
              style={{
                marginTop: 2,
                fontSize: 12.5,
                fontWeight: 500,
                color: M.ink,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subParts.map((t, i) => (
                <span key={i}>
                  {i ? <span style={{ color: CHEVRON }}> · </span> : null}
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 11 }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 5 }}>
              {vol ? <Spec icon={Box} text={vol} /> : null}
              {time ? <Spec icon={Timer} text={time} /> : null}
              {!vol && !time ? (
                <span style={{ fontSize: 12, color: LABEL, lineHeight: "26px" }}>No specs recorded</span>
              ) : null}
            </div>
            {canPrice ? <PriceSlot p={p} onPrices={onPrices} /> : null}
          </div>
        </div>
      </MobileCard>
    </div>
  );
}

function Spec({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span
      style={{
        height: 26,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "0 7px",
        borderRadius: 8,
        backgroundColor: "var(--m-spec-chip-bg)",
        color: "var(--m-spec-chip-text)",
        fontSize: 12,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <Icon size={12} strokeWidth={1.9} color="var(--m-spec-chip-icon)" />
      {text}
    </span>
  );
}

const slotLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--m-price-box-label)",
  whiteSpace: "nowrap",
};
const slotValue: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: M.raisin,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
// Handoff price box (#F4EFE3, radius 11). Content = the owner-approved
// price rules (2026-10-15), unchanged: no "from" prices.
const priceBox: CSSProperties = {
  flex: "none",
  boxSizing: "border-box",
  padding: "6px 11px",
  borderRadius: 11,
  backgroundColor: "var(--m-price-box-bg)",
};

function PriceSlot({ p, onPrices }: { p: HubProduct; onPrices: () => void }) {
  const d = priceDisplay(p);
  if (d.kind === "none") {
    return (
      <div
        style={{
          ...priceBox,
          backgroundColor: "var(--m-spec-chip-bg)",
          fontSize: 12,
          fontWeight: 600,
          color: M.body,
          whiteSpace: "nowrap",
        }}
      >
        No price
      </div>
    );
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
          ...priceBox,
          minHeight: 44,
          padding: "6px 8px 6px 11px",
          border: "none",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          justifyContent: "center",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span style={slotLabel}>SEAT PRICES</span>
        <span style={{ ...slotValue, marginTop: 2, color: M.taupe, display: "inline-flex", alignItems: "center", gap: 1 }}>
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
      <div style={{ ...priceBox, display: "grid", rowGap: 2 }}>
        {row("PRICE 1", d.p1)}
        {row("PRICE 2", d.p2)}
      </div>
    );
  }
  return (
    <div style={{ ...priceBox, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span style={slotLabel}>PRICE</span>
      <span style={{ ...slotValue, marginTop: 2 }}>{money(d.base)}</span>
    </div>
  );
}

// ---- Catalog -----------------------------------------------------------------

type PhotoVariant = "featured" | "tile" | "sheet";

function FamilyPhoto({
  coverId,
  photosReady,
  name,
  category,
  iconSize,
  variant = "sheet",
}: {
  coverId: string | null;
  photosReady: boolean;
  name: string;
  category: string;
  iconSize: number;
  /** featured / tile = the v2 tinted placeholder; sheet = the family sheet's existing one. */
  variant?: PhotoVariant;
}) {
  // Keyed by cover id so a new cover resets the failed state.
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImg = coverId != null && failedId !== coverId;
  const tone = toneOf(category);
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
      ) : !photosReady ? null : variant === "sheet" ? (
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
      ) : (
        // v2: category-tinted gradient (on the container) + large category icon.
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            color: tone.fg,
          }}
        >
          <span style={{ display: "flex", opacity: variant === "featured" ? 0.55 : 1 }}>
            <CatIcon category={category} size={iconSize} strokeWidth={variant === "featured" ? 1.2 : 1.3} />
          </span>
          {variant === "tile" ? (
            <span style={{ fontSize: 11, fontWeight: 600, color: M.ink }}>No photo yet</span>
          ) : null}
        </span>
      )}
    </>
  );
}

export function PhotoPill({
  category,
  small,
  inset,
  alpha,
}: {
  category: string;
  small?: boolean;
  /** Offset from the top-left corner (default 9 small / 12); the family sheet uses 16. */
  inset?: number;
  /** Frosted white opacity (default .9; the featured card uses .88, as in the HTML). */
  alpha?: number;
}) {
  const c = toneOf(category).photo;
  const at = inset ?? (small ? 9 : 12);
  return (
    <span
      style={{
        ...FROSTED,
        ...(alpha != null ? { backgroundColor: `rgba(255,255,255,${alpha})` } : null),
        position: "absolute",
        top: at,
        left: at,
        // Leaves room for a close button on the right when inset (family sheet).
        maxWidth: inset != null ? "calc(100% - 80px)" : "calc(100% - 24px)",
        height: small ? 22 : 26,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        gap: small ? 5 : 6,
        padding: small ? "0 8px" : "0 10px",
        borderRadius: 999,
        color: c,
        fontSize: small ? 10.5 : 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <span aria-hidden="true" style={chipDot(c)} />
      {categoryLabel(category)}
    </span>
  );
}

function CatalogGrid({
  families,
  covers,
  photosReady,
  wide,
  bottomPad,
  onOpen,
}: {
  families: HubFamily[];
  covers: Map<string, string>;
  photosReady: boolean;
  /** Tablet without the split pane: auto-fill grid + wider featured crop. */
  wide: boolean;
  bottomPad: number;
  onOpen: (f: HubFamily) => void;
}) {
  // Handoff: the first family (of the current sort) is featured when there
  // are more than two results. Layout only — the order is unchanged.
  const featured = families.length > 2 ? families[0] : null;
  const rest = featured ? families.slice(1) : families;
  return (
    <div style={{ padding: `8px 18px ${bottomPad}px` }}>
      {featured ? (
        <FeaturedFamily
          f={featured}
          coverId={covers.get(featured.familyKey) ?? null}
          photosReady={photosReady}
          wide={wide}
          onOpen={() => onOpen(featured)}
        />
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: wide ? "repeat(auto-fill, minmax(200px, 1fr))" : "repeat(2, minmax(0, 1fr))",
          columnGap: 12,
          rowGap: 14,
          marginTop: featured ? 12 : 0,
        }}
      >
        {rest.map((f) => (
          <FamilyTile
            key={`${f.category}:${f.familyKey}`}
            f={f}
            coverId={covers.get(f.familyKey) ?? null}
            photosReady={photosReady}
            onOpen={() => onOpen(f)}
          />
        ))}
      </div>
    </div>
  );
}

function FeaturedFamily({
  f,
  coverId,
  photosReady,
  wide,
  onOpen,
}: {
  f: HubFamily;
  coverId: string | null;
  photosReady: boolean;
  wide: boolean;
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
        position: "relative",
        display: "block",
        width: "100%",
        // Phone 16:11 (handoff); wide tablet ~21:9 capped at 360px. The photo
        // is object-fit: cover, so the cap crops, never stretches.
        aspectRatio: wide ? "21 / 9" : "16 / 11",
        maxHeight: wide ? 360 : undefined,
        border: "none",
        padding: 0,
        borderRadius: 22,
        overflow: "hidden",
        cursor: "pointer",
        textAlign: "left",
        background: toneOf(f.category).ph,
        boxShadow: SHADOW_FEATURED,
        transform: pressed ? "scale(.985)" : "none",
        transition: "transform .12s ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <FamilyPhoto
        coverId={coverId}
        photosReady={photosReady}
        name={f.name || f.familyKey}
        category={f.category}
        iconSize={64}
        variant="featured"
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(31,29,27,0) 38%, rgba(31,29,27,.78) 100%)",
        }}
      />
      <PhotoPill category={f.category} alpha={0.88} />
      <span style={{ position: "absolute", left: 16, right: 16, bottom: 14, display: "block", minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: "#E8D9B0",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {f.familyKey}
        </span>
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            overflowWrap: "anywhere",
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.3px",
            lineHeight: 1.25,
            color: "#FFFFFF",
            marginTop: 3,
          }}
        >
          {f.name || f.familyKey}
        </span>
        <span style={{ display: "block", fontSize: 12.5, color: "rgba(255,255,255,.86)", marginTop: 3 }}>
          {familyCounts(f)}
        </span>
      </span>
    </button>
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
        boxShadow: SHADOW_V2,
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
          aspectRatio: "4 / 3.4",
          overflow: "hidden",
          background: toneOf(f.category).ph,
        }}
      >
        <FamilyPhoto
          coverId={coverId}
          photosReady={photosReady}
          name={f.name || f.familyKey}
          category={f.category}
          iconSize={34}
          variant="tile"
        />
        <PhotoPill category={f.category} small />
      </span>
      <span style={{ display: "block", padding: "11px 12px 12px", minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            color: M.taupe,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {f.familyKey}
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
            marginTop: 3,
            minHeight: 36,
          }}
        >
          {f.name || f.familyKey}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 12,
            color: M.ink,
            marginTop: 8,
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
                          backgroundColor: "var(--m-gold-tint)",
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
                      backgroundColor: "var(--m-segment-track)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    <CatIcon category={f.category} size={18} strokeWidth={1.6} color="var(--m-search-icon)" />
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

export function FamilySheet({
  family,
  coverId,
  canPrice,
  onClose,
  onSku,
}: {
  family: HubFamily | null;
  coverId: string | null;
  /** product-pricing:read — every SKU-row price is hidden without it. */
  canPrice: boolean;
  onClose: () => void;
  onSku: (p: HubProduct) => void;
}) {
  // Claude Design `Products Hub v2` family sheet (owner 2026-10-21): photo
  // hero, two stats (Variants / SKUs — no "From"), model tags, SKU rows.
  return (
    <Sheet open={family != null} onClose={onClose} title={family ? family.name || family.familyKey : ""} bare phoneRadius={24}>
      {family ? <FamilySheetBody family={family} coverId={coverId} canPrice={canPrice} onClose={onClose} onSku={onSku} /> : null}
    </Sheet>
  );
}

function FamilySheetBody({
  family,
  coverId,
  canPrice,
  onClose,
  onSku,
}: {
  family: HubFamily;
  coverId: string | null;
  canPrice: boolean;
  onClose: () => void;
  onSku: (p: HubProduct) => void;
}) {
  const tone = toneOf(family.category);
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImg = coverId != null && failedId !== coverId;
  const name = family.name || family.familyKey;
  const stats: [string, number][] = [
    ["VARIANTS", family.variants.length],
    ["SKUS", family.products.length],
  ];
  return (
    <>
      <div style={{ position: "relative", aspectRatio: "16 / 10", background: tone.ph, overflow: "hidden" }}>
        {showImg ? (
          <img
            src={`/api/files/${encodeURIComponent(coverId as string)}/download`}
            alt={name}
            decoding="async"
            className="m-no-invert"
            onError={() => setFailedId(coverId)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: tone.fg, opacity: 0.5 }}
          >
            <CatIcon category={family.category} size={72} strokeWidth={1.1} />
          </span>
        )}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(31,29,27,.25) 0%, rgba(31,29,27,0) 30%, rgba(31,29,27,0) 45%, rgba(31,29,27,.8) 100%)",
          }}
        />
        {/* Grabber over the photo */}
        <div aria-hidden="true" style={{ position: "absolute", top: 8, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,.75)" }} />
        </div>
        {/* 36px frosted circle inside a 44px hit area */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 44,
            height: 44,
            padding: 0,
            border: "none",
            background: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span
            style={{
              ...FROSTED,
              width: 36,
              height: 36,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#1F1D1B",
            }}
          >
            <X size={18} strokeWidth={2} />
          </span>
        </button>
        <PhotoPill category={family.category} inset={16} />
        <div style={{ position: "absolute", left: 18, right: 18, bottom: 14, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1, color: "#E8D9B0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            FAMILY {family.familyKey}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.4px",
              lineHeight: 1.2,
              color: "#FFFFFF",
              marginTop: 3,
              overflowWrap: "anywhere",
            }}
          >
            {name}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`,
          backgroundColor: M.card,
          boxShadow: "0 10px 24px -18px rgba(31,29,27,.35)",
        }}
      >
        {stats.map(([k, v], i) => (
          <div key={k} style={{ padding: "12px 8px 12px 18px", minWidth: 0, borderLeft: i ? `1px solid ${M.divider}` : "none" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "var(--m-spec-chip-icon)" }}>{k}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 18, padding: "18px 16px 0" }}>
        {family.variants.map((v) => (
          <section key={v.baseModel} aria-label={`Model ${v.baseModel}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 9px", minWidth: 0 }}>
              <span
                style={{
                  height: 24,
                  maxWidth: "70%",
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 10px",
                  borderRadius: 8,
                  backgroundColor: tone.bg,
                  color: tone.fg,
                  fontSize: 12,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {v.baseModel}
              </span>
              <span style={{ fontSize: 12, color: M.ink, whiteSpace: "nowrap" }}>
                {v.products.length} SKU{v.products.length === 1 ? "" : "s"}
              </span>
            </div>
            <div style={{ backgroundColor: M.card, borderRadius: 18, boxShadow: SHADOW_V2, overflow: "hidden" }}>
              {v.products.map((p, i) => {
                const sub = [p.sizeLabel, fmtM3(p.unitM3)].filter(Boolean).join(" · ");
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onSku(p)}
                    style={{
                      width: "100%",
                      minHeight: 62,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px 10px 14px",
                      border: "none",
                      borderTop: i ? `1px solid ${M.divider}` : "none",
                      backgroundColor: M.card,
                      cursor: "pointer",
                      textAlign: "left",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={rowTitle}>{p.code}</span>
                      {sub ? <span style={{ ...rowSub, color: M.ink }}>{sub}</span> : null}
                    </span>
                    {canPrice ? <FamilyRowPrice p={p} /> : null}
                    <ChevronRight size={17} strokeWidth={1.9} color="var(--m-spec-chip-icon)" style={{ flexShrink: 0 }} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div style={{ padding: "16px 18px 14px", fontSize: 11, color: M.body, textAlign: "center" }}>
        Photo is stored per family — variants share it.
      </div>
    </>
  );
}

/** Family-sheet SKU-row price, by the owner-approved rules: Sofa none, Bedframe P1 + P2, Accessory its price. */
function FamilyRowPrice({ p }: { p: HubProduct }) {
  if (p.category === "SOFA") return null;
  const d = priceDisplay(p);
  if (d.kind === "none") return <span style={{ flex: "none", fontSize: 12, color: M.body, whiteSpace: "nowrap" }}>No price</span>;
  if (d.kind === "bedframe") {
    const row = (label: string, v: number | undefined) => (
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
        <span style={slotLabel}>{label}</span>
        <span style={{ ...slotValue, color: v == null ? CHEVRON : M.raisin }}>{v == null ? "—" : money(v)}</span>
      </span>
    );
    return (
      <span style={{ flex: "none", display: "grid", rowGap: 2 }}>
        {row("PRICE 1", d.p1)}
        {row("PRICE 2", d.p2)}
      </span>
    );
  }
  if (d.kind === "single") {
    return (
      <span style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <span style={slotLabel}>PRICE</span>
        <span style={{ ...slotValue, marginTop: 1 }}>{money(d.base)}</span>
      </span>
    );
  }
  return null;
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
        backgroundColor: "var(--m-segment-track)",
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

export function PriceSheet({
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
  // Claude Design header: code above the "Seat prices" title and the product
  // name, close beside them (owner 2026-10-21). Rows / tiers / rules unchanged.
  return (
    <Sheet open={product != null} onClose={onClose} title="Seat prices" bare>
      {product ? (
        <>
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: M.hairline }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px 2px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums" }}>{product.code}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: M.raisin, marginTop: 1 }}>Seat prices</div>
              <div style={{ fontSize: 12, color: M.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {product.name}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 44,
                height: 44,
                marginRight: -10,
                padding: 0,
                border: "none",
                background: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: M.muted,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
          <div style={{ padding: "10px 16px 0" }}>
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
              backgroundColor: "var(--m-segment-track)",
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
                    // Claude Design filter chip = the shared standard chip
                    // (lib/control-styles.ts), at the HTML 36px height.
                    style={{
                      ...chipStyle(on),
                      height: 36,
                      padding: "0 14px",
                      maxWidth: "100%",
                      boxSizing: "border-box",
                      display: "inline-block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
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
            backgroundColor: "var(--m-segment-track)",
            color: "var(--m-spec-chip-icon)",
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
