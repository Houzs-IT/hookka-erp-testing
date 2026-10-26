// Server-render helpers for the Sales Order screens. FIXTURE DATA ONLY: these prove
// markup / wiring for a given shape of order, never that real ERP data renders well.
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

globalThis.React = React;
globalThis.__BUILD_ID__ = "test"; // injected by Vite in the app
register("./tests/_alias-loader.mjs", pathToFileURL("./"));
register("./tests/_stub-loader.mjs", pathToFileURL("./"));

const { MemoryRouter, Routes, Route } = await import("react-router-dom");
const { ResponsiveLayoutProvider, resolveResponsiveLayout, PaneProvider, resolveContainerLayout } = await import(
  pathToFileURL(resolvePath(process.cwd(), "src/pages/m/lib/responsive-layout.tsx")).href
);

export function soFixture(over = {}) {
  const status = over.status ?? "CONFIRMED";
  const items = over.items ?? [
    { id: "i1", lineNo: 1, productName: "Aria Sofa 3-seater", productCode: "SF-ARIA-3", itemCategory: "SOFA", sizeLabel: "3S", fabricCode: "FAB-101", quantity: 2, unitPriceSen: 250000, lineTotalSen: 500000 },
    { id: "i2", lineNo: 2, productName: "Oslo Bedframe Queen", productCode: "BF-OSLO-Q", itemCategory: "BEDFRAME", sizeLabel: "Q", fabricCode: "FAB-220", quantity: 1, unitPriceSen: 180000, lineTotalSen: 180000 },
    { id: "i3", lineNo: 3, productName: "Nara Side Table", productCode: "ST-NARA", itemCategory: "ACCESSORY", quantity: 4, unitPriceSen: 20000, lineTotalSen: 80000 },
  ];
  const payments = over.payments ?? [
    { id: "p1", amount: 300000, paymentMethod: "Bank Transfer", paymentDate: "2026-10-10", accountName: "Maybank", receivedBy: "Aina" },
    { id: "p2", amount: 100000, paymentMethod: "Cash", paymentDate: "2026-10-14", receivedBy: "Aina" },
  ];
  const order = {
    id: "so-0001",
    companySOId: "SO-2610-0001",
    customerSOId: "CS-889",
    customerPOId: "PO-77",
    customerPODate: "2026-10-01",
    reference: "REF-Alpha",
    customerName: "Sample Customer Sdn Bhd",
    customerState: "Selangor",
    hubName: "Klang Hub",
    status,
    totalSen: items.reduce((a, i) => a + i.lineTotalSen, 0),
    companySODate: "2026-10-02",
    customerDeliveryDate: "2026-11-05",
    hookkaExpectedDD: "2026-11-01",
    notes: over.notes ?? "Deliver after 2pm. Call the guard house first.",
    items,
    ...(over.order ?? {}),
  };
  return {
    success: true,
    data: order,
    linkedPOs: [{ id: "po1", poNo: "PO-2610-0001", itemCategory: "SOFA", status: "IN_PRODUCTION", productName: "Aria Sofa 3-seater", quantity: 2 }],
    linkedDOs: [{ id: "do1", doNo: "DO-2610-0001", status: "DRAFT", deliveryDate: "2026-11-02" }],
    linkedInvoices: [{ id: "inv-1", invoiceNo: "INV-2610-0001" }],
    linkedPayments: payments,
    priceOverrides: [],
    statusHistory: [{ from: "DRAFT", to: status, changedAt: "2026-10-03T08:00:00Z", changedBy: "Aina" }],
  };
}

export function listFixture(over = {}) {
  const mk = (n, status, cust, totalSen, extra = {}) => ({
    id: `so-${n}`, companySOId: `SO-2610-${String(n).padStart(4, "0")}`, customerName: cust, status, totalSen,
    customerPOId: `PO-${n}`, customerSOId: `CS-${n}`, hubName: "Klang Hub",
    companySODate: "2026-10-02", hookkaExpectedDD: "2026-11-0" + (1 + (n % 8)),
    items: [{ quantity: 2 }, { quantity: 1 }], ...extra,
  });
  return {
    success: true,
    data: over.rows ?? [
      mk(1, "DRAFT", "Aurora Living Sdn Bhd", 120000),
      mk(2, "CONFIRMED", "Sample Customer Sdn Bhd", 760000),
      mk(3, "IN_PRODUCTION", "Borneo Interiors", 540000),
      mk(4, "READY_TO_SHIP", "Casa Home Trading", 310000),
      mk(5, "DELIVERED", "Delta Furnishings", 980000),
      mk(6, "CANCELLED", "Echo Residence", 220000),
    ],
  };
}

/** Render a screen at a given SHELL width (390 phone, 768 / 1024 / 1180 tablet), optionally inside a split pane. */
export async function renderScreen(modulePath, exportName, { width = 390, fixture = soFixture(), list = listFixture(), pane, route = "/m/sales/so-0001", routePath = "/m/sales/:id", contentWidth } = {}) {
  globalThis.__CACHED_FIXTURES__ = {
    "/api/sales-orders": list,
    "/api/sales-orders/": fixture,
    "/api/audit-events": { data: [] },
    "/api/files": { data: [] },
  };
  const mod = await import(pathToFileURL(resolvePath(process.cwd(), modulePath)).href);
  const layout = resolveResponsiveLayout(width, contentWidth);
  let tree = h(
    MemoryRouter,
    { initialEntries: [route] },
    h(Routes, null, h(Route, { path: routePath, element: h(mod[exportName]) })),
  );
  if (pane) tree = h(PaneProvider, { value: resolveContainerLayout(pane.width, pane.kind) }, tree);
  return renderToStaticMarkup(h(ResponsiveLayoutProvider, { value: layout }, tree));
}

// The list shows a countdown to Expected DD, so its markup depends on "today". Golden
// fingerprints must not drift with the calendar: render under a frozen local clock.
export async function withFrozenClock(iso, fn) {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = FrozenDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}
export const GOLDEN_NOW = "2026-10-26T12:00:00";
