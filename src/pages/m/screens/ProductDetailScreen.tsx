// ===========================================================================
// ProductDetailScreen — L2 /m/products/:id, phone AND tablet (CUSTOM_L2).
//
// Owner 2026-10-21: Claude Design `Products Hub v2.dc.html` (the SKU detail
// overlay, handoff item 6). Replaces the generic DocumentDetailScreen for
// Products only; that shared screen and the `productDetail` config are left
// untouched for every other module.
//
// Real data only:
//   • SKU         — GET /api/products/:id (the API already strips selling
//                   prices from roles without product-pricing:read).
//   • Family      — familyOf(code) over the cached GET /api/products list,
//                   photo from /api/files?resourceType=modular (cover first;
//                   a family photo, never per-SKU).
//   • Pricing     — the owner-approved rules, unchanged: Sofa "View prices"
//                   (the list's seat sheet), Bedframe Price 1 + Price 2,
//                   Accessory price. No "from" prices; never RM 0.00; the
//                   whole card is hidden without product-pricing:read.
//   • Production  — hero tile = productionTimeMinutes (as the list card);
//                   the section total is the sum of the rows shown, labelled
//                   "Department Time Total" (the two can differ).
//   • BOM / files / history — the same reads and the same upload call as the
//                   generic detail. No BOM "Active" status (not in the data).
// ===========================================================================
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  ChevronRight,
  Factory,
  FileText,
  History,
  Layers,
  Paperclip,
  Ruler,
  Scissors,
  Timer,
  TreePine,
  Upload,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { usePermissions } from "@/lib/use-permission";
import { useSofaSeatHeights } from "@/lib/use-sofa-seat-heights";
import { formatCurrency } from "@/lib/utils";
import { MobileHeader } from "../components";
import { M, M_MAT } from "../theme";
import { productsConfig } from "../config/modules";
import { refreshOne } from "../config/mutate";
import { selectDocData, str } from "../config/helpers";
import { useResponsiveLayout } from "../lib/responsive-layout";
import {
  buildFamilies,
  categoryLabel,
  coverByFamily,
  bomSource,
  deptRows,
  familyCounts,
  familyKeyOf,
  familyOfProduct,
  fmtM3,
  fmtMinutes,
  legacyMaterials,
  priceDisplay,
  templateDeptRows,
  templateMaterials,
  toHubProduct,
  type BomRow,
  type BomSource,
  type HubProduct,
  type MaterialTone,
} from "../lib/products-hub";
import { PHOTOS_URL, PRODUCTS_URL, toneOf, usePressed, useSofaTier } from "../lib/products-ui";
import { CatIcon, FamilySheet, PhotoPill, PriceSheet } from "./ProductsScreen";

// Handoff card shadow (same as the Products list v2 cards).
const SHADOW_V2 = "0 1px 2px rgba(31,29,27,.05),0 12px 28px -16px rgba(31,29,27,.28)";
const SHADOW_BUTTON = "0 1px 2px rgba(31,29,27,.06),0 4px 10px -6px rgba(31,29,27,.16)";
const SHADOW_PRIMARY = "0 8px 18px -10px rgba(107,92,50,.7)";
const LABEL = "var(--m-spec-chip-icon)";

const card: CSSProperties = {
  backgroundColor: M.card,
  borderRadius: 18,
  boxShadow: SHADOW_V2,
  overflow: "hidden",
};

const money = (sen: number) => formatCurrency(sen);

const MAT_ICON: Record<MaterialTone, LucideIcon> = {
  fabric: Scissors,
  foam: Layers,
  wood: TreePine,
  hardware: Wrench,
};

type AuditEvent = { id: string; action: string; actorUserName?: string; ts: string };
type FileRow = { id: string; filename: string; contentType?: string; sizeBytes?: number; uploadedAt?: string };

export function ProductDetailScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const layout = useResponsiveLayout();
  const tablet = layout.mode !== "phone";
  const bottomPad = layout.hasBottomNavigation ? 120 : 32;

  const detailUrl = id ? `/api/products/${encodeURIComponent(id)}` : null;
  const { data, error, failure, refresh } = useCachedJson<unknown>(detailUrl);
  const doc = useMemo(() => (data ? selectDocData(data, id) : null), [data, id]);
  const p = useMemo<HubProduct | null>(() => (doc ? toHubProduct(doc) : null), [doc]);

  // BOM / Production primary source: the ACTIVE BOM template for exactly this
  // code (the one the API derives productionTimeMinutes from). Legacy per-SKU
  // rows are only a labelled fallback (owner 2026-10-21).
  const code = p?.code ?? "";
  const tplUrl = code ? `/api/bom/templates?productCode=${encodeURIComponent(code)}&versionStatus=ACTIVE` : null;
  const tpl = useCachedJson<unknown>(tplUrl);
  const src = useMemo<BomSource>(
    () => (code ? bomSource(tpl.data, code, { error: !!tpl.error, status: tpl.failure?.status ?? null }) : { kind: "loading" }),
    [code, tpl.data, tpl.error, tpl.failure],
  );

  // Family + photo: the same cached reads as the Products list.
  const { data: listData } = useCachedJson<unknown>(PRODUCTS_URL);
  const { data: photoData, loading: photosLoading } = useCachedJson<{ data?: unknown }>(PHOTOS_URL);
  const families = useMemo(
    () => (listData ? buildFamilies(productsConfig.sources[0].select(listData).map(toHubProduct)) : []),
    [listData],
  );
  const covers = useMemo(() => coverByFamily(photoData?.data), [photoData]);
  const photosReady = !(photosLoading && !photoData);

  // Same audit + attachments reads as the generic detail (auditResource
  // "products", attachmentsResource PRODUCT / id).
  const auditUrl = id
    ? `/api/audit-events?resource=products&resourceId=${encodeURIComponent(id)}`
    : null;
  const { data: auditData } = useCachedJson<{ data?: AuditEvent[] }>(auditUrl);
  const filesUrl = id
    ? `/api/files?resourceType=PRODUCT&resourceId=${encodeURIComponent(id)}`
    : null;
  const { data: filesData } = useCachedJson<{ data?: FileRow[] }>(filesUrl);

  const heights = useSofaSeatHeights();
  const [tier, setTier] = useSofaTier();
  const { hasPermission, loading: permLoading } = usePermissions();
  const canPrice = !permLoading && hasPermission("product-pricing", "read");

  const [priceOpen, setPriceOpen] = useState(false);
  const [famOpen, setFamOpen] = useState(false);

  if (!p) {
    // Only a 404 licenses "not found" (class C15): a timeout or 5xx is a load
    // failure, never an absent product.
    const notFound = failure?.kind === "notFound";
    return (
      <>
        <MobileHeader title="Product" onBack={() => navigate(-1)} />
        {notFound ? (
          <Msg text="Product not found." />
        ) : error ? (
          <div role="alert" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: M.raisin }}>Couldn’t load this product</div>
            <div style={{ fontSize: 13, color: M.ink, marginTop: 4 }}>Check your connection and try again.</div>
            <button
              type="button"
              onClick={() => refresh()}
              style={{
                marginTop: 16,
                height: 44,
                padding: "0 22px",
                borderRadius: 999,
                border: "none",
                backgroundColor: M.taupe,
                color: "var(--m-text-on-accent)",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <Msg text="Loading…" />
        )}
      </>
    );
  }

  const family = familyOfProduct(families, p);
  const famKey = family?.familyKey ?? familyKeyOf(p.code);
  const coverId = covers.get(famKey) ?? null;
  const description = doc ? str(doc, "description") : "";
  const legacyDwt = deptRows(doc?.deptWorkingTimes);
  const legacyBom = legacyMaterials(doc?.bomComponents);
  // Size: sizeLabel, else the stored sizeCode (as the generic detail did).
  const size = p.sizeLabel || (doc ? str(doc, "sizeCode") : "");
  const events = (auditData?.data ?? []).slice(0, 30);

  return (
    <>
      <MobileHeader title={p.code || "Product"} onBack={() => navigate(-1)} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 14,
          width: "100%",
          maxWidth: tablet ? 720 : undefined,
          margin: "0 auto",
          boxSizing: "border-box",
          padding: `2px 18px ${bottomPad}px`,
        }}
      >
        <HeroCard p={p} size={size} coverId={coverId} photosReady={photosReady} tablet={tablet} />
        {canPrice ? <PricingCard p={p} onPrices={() => setPriceOpen(true)} /> : null}
        <FamilyCard
          p={p}
          famKey={famKey}
          name={family?.name || p.name}
          counts={family ? familyCounts(family) : ""}
          coverId={coverId}
          onOpen={family ? () => setFamOpen(true) : undefined}
        />
        <ProductionSection src={src} legacy={legacyDwt} onRetry={() => tpl.refresh()} />
        <BomSection src={src} legacy={legacyBom} onRetry={() => tpl.refresh()} />
        <FilesSection filesUrl={filesUrl} productId={id} files={filesData?.data ?? []} />
        {description ? (
          <section aria-label="Description">
            <Heading icon={FileText} title="Description" />
            <div style={{ ...card, padding: "14px 16px", fontSize: 13.5, lineHeight: 1.5, color: M.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {description}
            </div>
          </section>
        ) : null}
        {events.length > 0 ? <HistorySection events={events} total={auditData?.data?.length ?? 0} /> : null}
      </div>

      <PriceSheet
        product={priceOpen ? p : null}
        heights={heights}
        tier={tier}
        setTier={setTier}
        onClose={() => setPriceOpen(false)}
      />
      <FamilySheet
        family={famOpen ? family : null}
        coverId={coverId}
        canPrice={canPrice}
        onClose={() => setFamOpen(false)}
        onSku={(sku) => {
          setFamOpen(false);
          if (sku.id !== p.id) navigate(`/m/products/${encodeURIComponent(sku.id)}`, { replace: true });
        }}
      />
    </>
  );
}

// ---- Hero ----------------------------------------------------------------------

/** Family photo (cover) with the v2 tinted fallback; a load error falls back too. */
function useCoverFailed(coverId: string | null) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return {
    show: coverId != null && failedId !== coverId,
    onError: () => setFailedId(coverId),
  };
}

function HeroCard({
  p,
  size,
  coverId,
  photosReady,
  tablet,
}: {
  p: HubProduct;
  size: string;
  coverId: string | null;
  photosReady: boolean;
  tablet: boolean;
}) {
  const tone = toneOf(p.category);
  const photo = useCoverFailed(coverId);
  const sub = [p.baseModel ? `Model ${p.baseModel}` : "", size].filter(Boolean).join(" · ");
  const tiles: { k: string; icon: LucideIcon; v: string | null }[] = [
    { k: "Volume", icon: Box, v: fmtM3(p.unitM3) },
    { k: "Prod. time", icon: Timer, v: fmtMinutes(p.productionTimeMinutes) },
    { k: "Size", icon: Ruler, v: size || null },
  ];
  return (
    <section aria-label="Product" style={card}>
      <div style={{ position: "relative", height: tablet ? 200 : 148, background: tone.ph, overflow: "hidden" }}>
        {photo.show ? (
          <>
            <img
              src={`/api/files/${encodeURIComponent(coverId as string)}/download`}
              alt={`${p.name || p.code} family photo`}
              decoding="async"
              className="m-no-invert"
              onError={photo.onError}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
            <span
              aria-hidden="true"
              style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(31,29,27,0) 50%, rgba(31,29,27,.35) 100%)" }}
            />
            <span style={{ position: "absolute", right: 10, bottom: 8, fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,.95)" }}>
              Family photo
            </span>
          </>
        ) : photosReady ? (
          <span
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: tone.fg, opacity: 0.5 }}
          >
            <CatIcon category={p.category} size={60} strokeWidth={1.15} />
          </span>
        ) : null}
        <PhotoPill category={p.category} />
      </div>
      <div style={{ padding: "15px 16px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: M.taupe, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
          {p.code || "—"}
        </div>
        <h1
          style={{
            margin: "4px 0 0",
            fontSize: 20,
            lineHeight: 1.3,
            fontWeight: 700,
            letterSpacing: "-0.3px",
            color: M.raisin,
            overflowWrap: "anywhere",
          }}
        >
          {p.name || "—"}
        </h1>
        {sub ? <div style={{ fontSize: 13, color: M.ink, marginTop: 3 }}>{sub}</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 14 }}>
          {tiles.map(({ k, icon: Icon, v }) => (
            <div key={k} style={{ padding: "10px 10px 9px", borderRadius: 12, backgroundColor: "var(--m-spec-chip-bg)", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: LABEL, whiteSpace: "nowrap" }}>
                <Icon size={12} strokeWidth={2} />
                {k}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 14,
                  fontWeight: 700,
                  color: v ? M.raisin : M.muted,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {v || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Pricing (owner-approved rules, unchanged) ------------------------------------

const priceLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1,
  color: M.taupe,
};

function PriceLabel({ text }: { text: string }) {
  return (
    <div style={priceLabel}>
      <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: M.gold }} />
      {text}
    </div>
  );
}

const bigValue: CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  letterSpacing: "-0.4px",
  color: M.raisin,
  marginTop: 5,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};
const note: CSSProperties = { fontSize: 12, color: M.ink, marginTop: 2 };

function PricingCard({ p, onPrices }: { p: HubProduct; onPrices: () => void }) {
  const d = priceDisplay(p);
  let body: ReactNode;
  if (d.kind === "sofa") {
    body = (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <PriceLabel text="SEAT PRICES" />
          <div style={{ ...note, marginTop: 6 }}>Set per seat size and price tier (P1 / P2 / P3).</div>
        </div>
        <button
          type="button"
          onClick={onPrices}
          aria-haspopup="dialog"
          aria-label={`View seat prices for ${p.code}`}
          style={{
            flex: "none",
            height: 44,
            padding: "0 14px",
            borderRadius: 12,
            border: "none",
            backgroundColor: M.taupe,
            color: "var(--m-text-on-accent)",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 5,
            cursor: "pointer",
            boxShadow: SHADOW_PRIMARY,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          View prices
          <ChevronRight size={15} strokeWidth={2.2} />
        </button>
      </div>
    );
  } else if (d.kind === "bedframe") {
    const col = (label: string, v: number | undefined) => (
      <div style={{ minWidth: 0 }}>
        <PriceLabel text={label} />
        <div style={{ ...bigValue, fontSize: 20, color: v == null ? M.muted : M.raisin }}>{v == null ? "—" : money(v)}</div>
      </div>
    );
    body = (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {col("PRICE 1", d.p1)}
        {col("PRICE 2", d.p2)}
      </div>
    );
  } else if (d.kind === "single") {
    body = (
      <>
        <PriceLabel text="PRICE" />
        <div style={bigValue}>{money(d.base)}</div>
      </>
    );
  } else {
    body = (
      <>
        <PriceLabel text={p.category === "SOFA" ? "SEAT PRICES" : "PRICE"} />
        <div style={{ ...bigValue, color: M.muted }}>No price set</div>
      </>
    );
  }
  return (
    <section aria-label="Pricing" style={{ ...card, padding: "15px 16px" }}>
      {body}
    </section>
  );
}

// ---- Product family ----------------------------------------------------------------

function FamilyCard({
  p,
  famKey,
  name,
  counts,
  coverId,
  onOpen,
}: {
  p: HubProduct;
  famKey: string;
  name: string;
  counts: string;
  coverId: string | null;
  /** Undefined until the product list has loaded (no family sheet to open yet). */
  onOpen?: () => void;
}) {
  const tone = toneOf(p.category);
  const photo = useCoverFailed(coverId);
  const { pressed, handlers } = usePressed();
  return (
    <button
      type="button"
      {...handlers}
      onClick={onOpen}
      disabled={!onOpen}
      aria-label={`Product family ${famKey}${name ? `, ${name}` : ""}${counts ? `, ${counts}` : ""}`}
      style={{
        ...card,
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "10px 12px 10px 10px",
        border: "none",
        textAlign: "left",
        cursor: onOpen ? "pointer" : "default",
        transform: pressed && onOpen ? "scale(.985)" : "none",
        transition: "transform .12s ease",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          position: "relative",
          width: 52,
          height: 52,
          flex: "none",
          borderRadius: 12,
          overflow: "hidden",
          background: tone.ph,
          color: tone.fg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photo.show ? (
          <img
            src={`/api/files/${encodeURIComponent(coverId as string)}/download`}
            alt=""
            loading="lazy"
            decoding="async"
            className="m-no-invert"
            onError={photo.onError}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <CatIcon category={p.category} size={22} strokeWidth={1.5} />
        )}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: LABEL, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          PRODUCT FAMILY · {famKey}
        </span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: M.raisin, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {name || "—"}
        </span>
        <span style={{ display: "block", fontSize: 12, color: M.ink, marginTop: 1 }}>
          {counts || categoryLabel(p.category)}
        </span>
      </span>
      {onOpen ? <ChevronRight size={18} strokeWidth={1.9} color={LABEL} style={{ flexShrink: 0 }} /> : null}
    </button>
  );
}

// ---- Sections --------------------------------------------------------------------

function Heading({ icon: Icon, title, trailing }: { icon: LucideIcon; title: string; trailing?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 10px", minHeight: 22 }}>
      <Icon size={16} strokeWidth={1.9} color={M.taupe} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: M.raisin }}>{title}</span>
      {trailing}
    </div>
  );
}

const countText: CSSProperties = { fontSize: 12, color: M.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const empty: CSSProperties = { padding: "16px", fontSize: 13, color: M.muted };

// What a section says when it falls back to the SKU's saved (legacy) rows, or
// has nothing to show — per source state. Never "nothing recorded" while the
// active BOM is unknown (loading / failed / not allowed).
const FALLBACK_NOTE: Record<"none" | "forbidden" | "error", (what: string) => string> = {
  none: (what) => `No active BOM template — showing the SKU’s saved ${what}.`,
  forbidden: (what) => `The active BOM isn’t available for your role — showing the SKU’s saved ${what}.`,
  error: (what) => `Couldn’t load the active BOM — showing the SKU’s saved ${what}.`,
};
const EMPTY_TEXT: Record<"none" | "forbidden" | "error", (what: string) => string> = {
  none: (what) => `No active BOM template and no saved ${what} for this SKU.`,
  forbidden: () => "The active BOM isn’t available for your role.",
  error: () => "Couldn’t load the active BOM.",
};

function SourceNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${M.divider}`, fontSize: 12, color: M.muted }}>
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {onRetry ? <RetryLink onRetry={onRetry} /> : null}
    </div>
  );
}

function RetryLink({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      style={{
        flex: "none",
        minHeight: 32,
        padding: "0 4px",
        border: "none",
        background: "none",
        color: M.taupe,
        fontSize: 12.5,
        fontWeight: 700,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      Try again
    </button>
  );
}

function EmptyLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div style={{ ...empty, display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      {onRetry ? <RetryLink onRetry={onRetry} /> : null}
    </div>
  );
}

function ProductionSection({
  src,
  legacy,
  onRetry,
}: {
  src: BomSource;
  legacy: ReturnType<typeof deptRows>;
  onRetry: () => void;
}) {
  let body: ReactNode;
  if (src.kind === "loading") {
    body = <EmptyLine text="Loading…" />;
  } else if (src.kind === "template") {
    // Summed with the API's own rule, so the total equals the hero Prod. time.
    const t = templateDeptRows(src.template);
    body = t.rows.length ? <DeptBars rows={t.rows} totalMinutes={t.totalMinutes} /> : <EmptyLine text="The active BOM has no department times." />;
  } else if (legacy.rows.length) {
    body = (
      <>
        <SourceNote text={FALLBACK_NOTE[src.kind]("department times")} onRetry={src.kind === "error" ? onRetry : undefined} />
        <DeptBars rows={legacy.rows} totalMinutes={legacy.totalMinutes} />
      </>
    );
  } else {
    body = <EmptyLine text={EMPTY_TEXT[src.kind]("department times")} onRetry={src.kind === "error" ? onRetry : undefined} />;
  }
  return (
    <section aria-label="Production">
      <Heading icon={Factory} title="Production" />
      <div style={card}>{body}</div>
    </section>
  );
}

function DeptBars({ rows, totalMinutes }: { rows: ReturnType<typeof deptRows>["rows"]; totalMinutes: number }) {
  return (
    <div style={{ padding: "6px 14px 0" }}>
      {rows.map((d, i) => (
        <div key={d.id} style={{ padding: "9px 0 8px", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
            <span style={{ minWidth: 0, fontWeight: 600, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.dept}
              {d.category ? <span style={{ fontWeight: 500, color: M.muted }}> · {d.category}</span> : null}
            </span>
            <span style={{ flex: "none", fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{d.minutes} min</span>
          </div>
          <div aria-hidden="true" style={{ height: 6, borderRadius: 999, backgroundColor: "var(--m-segment-track)", marginTop: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${d.pct}%`, borderRadius: 999, backgroundColor: i % 2 ? M.logoFrom : M.taupe }} />
          </div>
        </div>
      ))}
      {/* Owner 2026-10-21: the sum of the rows above, labelled apart from the
          hero "Prod. time" (productionTimeMinutes). */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          margin: "2px -14px 0",
          padding: "11px 14px",
          borderTop: `1px solid ${M.divider}`,
          fontSize: 12.5,
        }}
      >
        <span style={{ fontWeight: 600, color: M.ink }}>Department Time Total</span>
        <span style={{ fontWeight: 700, color: M.raisin, fontVariantNumeric: "tabular-nums" }}>{fmtMinutes(totalMinutes) ?? "—"}</span>
      </div>
    </div>
  );
}

function BomSection({ src, legacy, onRetry }: { src: BomSource; legacy: BomRow[]; onRetry: () => void }) {
  let badge: ReactNode = null;
  let body: ReactNode;
  if (src.kind === "loading") {
    body = <EmptyLine text="Loading…" />;
  } else if (src.kind === "template") {
    // Only an ACTIVE template verified for this exact code earns the badge.
    const v = src.template.version;
    badge = (
      <span
        style={{
          height: 22,
          display: "inline-flex",
          alignItems: "center",
          padding: "0 8px",
          borderRadius: 999,
          backgroundColor: "var(--m-pill-success-bg)",
          color: "var(--m-text-status-success)",
          fontSize: 11,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        Active{v ? ` · v${v}` : ""}
      </span>
    );
    const mats = templateMaterials(src.template);
    body = mats.length ? (
      <BomRows rows={mats} />
    ) : legacy.length ? (
      <>
        <SourceNote text="The active BOM lists no component materials here — showing the SKU’s saved materials." />
        <BomRows rows={legacy} />
      </>
    ) : (
      <EmptyLine text="The active BOM lists no component materials." />
    );
  } else if (legacy.length) {
    body = (
      <>
        <SourceNote text={FALLBACK_NOTE[src.kind]("materials")} onRetry={src.kind === "error" ? onRetry : undefined} />
        <BomRows rows={legacy} />
      </>
    );
  } else {
    body = <EmptyLine text={EMPTY_TEXT[src.kind]("materials")} onRetry={src.kind === "error" ? onRetry : undefined} />;
  }
  return (
    <section aria-label="Bill of materials">
      <Heading icon={Layers} title="Bill of materials" trailing={badge} />
      <div style={card}>{body}</div>
    </section>
  );
}

function BomRows({ rows }: { rows: BomRow[] }) {
  return (
    <>
      {rows.map((b, i) => {
        const Icon = MAT_ICON[b.tone];
        return (
          <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
            <span
              aria-hidden="true"
              style={{
                width: 36,
                height: 36,
                flex: "none",
                borderRadius: 11,
                backgroundColor: M_MAT[b.tone].bg,
                color: M_MAT[b.tone].fg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={17} strokeWidth={1.8} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: M.raisin, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.title}
              </div>
              {b.sub ? <div style={{ fontSize: 12, color: M.ink, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.sub}</div> : null}
            </div>
            {b.qty ? (
              <span
                style={{
                  flex: "none",
                  height: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 9px",
                  borderRadius: 8,
                  backgroundColor: "var(--m-spec-chip-bg)",
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: M.raisin,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {b.qty}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** Same upload as the generic detail: POST /api/files (PRODUCT / id), then refetch. */
function FilesSection({ filesUrl, productId, files }: { filesUrl: string | null; productId: string; files: FileRow[] }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    setStatus(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("resourceType", "PRODUCT");
      fd.append("resourceId", productId);
      const resp = await fetch("/api/files", { method: "POST", body: fd, credentials: "include" });
      const json = (await resp.json()) as { success?: boolean; error?: string };
      if (!resp.ok || !json.success) {
        setStatus({ kind: "err", text: json.error || `Upload failed (${resp.status})` });
      } else {
        setStatus({ kind: "ok", text: "Uploaded." });
        if (filesUrl) refreshOne(filesUrl);
      }
    } catch (err) {
      setStatus({ kind: "err", text: (err as Error).message || "Upload failed" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section aria-label="Files">
      <Heading
        icon={Paperclip}
        title="Files"
        trailing={
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              height: 32,
              padding: "0 10px",
              border: "none",
              borderRadius: 10,
              backgroundColor: M.card,
              color: uploading ? M.muted : M.taupe,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: uploading ? "default" : "pointer",
              boxShadow: SHADOW_BUTTON,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <Upload size={14} strokeWidth={2} />
            {uploading ? "Uploading…" : "Upload"}
          </button>
        }
      />
      <input
        ref={inputRef}
        type="file"
        // Same accept list as the generic detail (the /api/files ALLOWED_MIME set).
        accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <div style={card}>
        {files.length === 0 ? (
          <div style={{ padding: "22px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "var(--m-spec-chip-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FileText size={18} strokeWidth={1.8} color={LABEL} />
            </span>
            <span style={{ fontSize: 13, color: M.ink }}>No files yet</span>
          </div>
        ) : (
          files.map((f, i) => (
            <a
              key={f.id}
              href={`/api/files/${encodeURIComponent(f.id)}/download`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderTop: i ? `1px solid ${M.divider}` : "none",
                color: M.raisin,
                textDecoration: "none",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <FileText size={18} color={M.taupe} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.filename}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: M.muted }}>
                  {f.sizeBytes ? `${Math.round(f.sizeBytes / 1024)} KB · ` : ""}
                  {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : ""}
                </span>
              </span>
              <ChevronRight size={17} color="#C4BDB2" style={{ flexShrink: 0 }} />
            </a>
          ))
        )}
      </div>
      {status ? (
        <div
          role="status"
          style={{
            margin: "8px 2px 0",
            fontSize: 12,
            fontWeight: 600,
            color: status.kind === "err" ? "var(--m-text-status-danger)" : "var(--m-text-status-success)",
          }}
        >
          {status.text}
        </div>
      ) : null}
    </section>
  );
}

function HistorySection({ events, total }: { events: AuditEvent[]; total: number }) {
  return (
    <section aria-label="History">
      <Heading icon={History} title="History" trailing={<span style={countText}>{total}</span>} />
      <div style={card}>
        {events.map((e, i) => (
          <div key={e.id} style={{ padding: "11px 14px", borderTop: i ? `1px solid ${M.divider}` : "none" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: M.raisin, overflowWrap: "anywhere" }}>{e.action}</div>
            <div style={{ fontSize: 12, color: M.muted, marginTop: 2 }}>
              {[e.actorUserName || "—", new Date(e.ts).toLocaleString()].join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Msg({ text }: { text: string }) {
  return <div style={{ padding: "40px 18px", textAlign: "center", color: M.muted, fontSize: 14 }}>{text}</div>;
}
