// dept-qr-poster.ts — the printable Department QR poster, shared by desktop (Employees → Department Labor → "Dept QR Codes") and the
// phone (Employees → Department Labor → "..." → Department QR poster, HK-0125). One format for both: moved verbatim from
// src/pages/employees.tsx so the two can never drift.
//
// `win`: a window the caller already opened INSIDE the tap. A phone browser blocks a window opened after the awaits below, so the
// phone opens it first and passes it in; desktop passes nothing and the window is opened at the end, exactly as before.
import { appOrigin } from "@/lib/app-origin";
import { getQRCodeDataURL } from "@/lib/qr-utils";

// Printable department QR poster (owner 2026-06-11 v2): production
// departments get ONE CARD PER LINE (Sofa / Bedframe / Accessory) so the
// scan captures the line, not just the department — per-person labor and
// efficiency attribution. Non-production departments (Warehousing / Repair
// / Maintenance / R&D) get a single card. Workers scan when they start
// work and whenever they switch line or department; punch-out ends it.
// PRODUCTION_SHORTFALL is a virtual bucket, not a place, so it's skipped.
export async function printDeptQrPoster(win?: Window | null): Promise<void> {
  try {
    const res = await fetch("/api/departments");
    const j = (await res.json().catch(() => ({}))) as {
      data?: Array<{ code?: string; name?: string; shortName?: string; isProduction?: boolean | number }>;
    };
    const depts = (j?.data ?? []).filter(
      (d) => d.code && d.code !== "PRODUCTION_SHORTFALL",
    );
    if (depts.length === 0) {
      win?.close();
      return;
    }
    // Canonical origin so printed dept-QR cards show erp.hookka.com on prod.
    const origin = appOrigin();
    const CATS = ["SOFA", "BEDFRAME", "ACCESSORY"] as const;
    const wanted: Array<{ code: string; label: string; cat: string | null }> = [];
    for (const d of depts) {
      const base = { code: d.code as string, label: d.shortName || d.name || (d.code as string) };
      if (d.isProduction) {
        for (const cat of CATS) wanted.push({ ...base, cat });
      } else {
        wanted.push({ ...base, cat: null });
      }
    }
    const cards = await Promise.all(
      wanted.map(async (cdef) => ({
        ...cdef,
        // 1000px → crisp at the full-page 130mm print size.
        qr: await getQRCodeDataURL(
          `${origin}/worker/scan?deptscan=${encodeURIComponent(cdef.code)}${cdef.cat ? `&deptcat=${encodeURIComponent(cdef.cat)}` : ""}`,
          1000,
        ),
      })),
    );
    const catLabel = (cat: string | null) =>
      cat ? cat.charAt(0) + cat.slice(1).toLowerCase() : "";
    const cardsHtml = cards
      .map(
        (cd) => `
      <div class="card">
        <div class="dept">${cd.label}</div>
        ${cd.cat ? `<div class="cat cat-${cd.cat.toLowerCase()}">${catLabel(cd.cat)}</div>` : ""}
        <div class="code">${cd.code}${cd.cat ? ` · ${cd.cat}` : ""}</div>
        <img src="${cd.qr}" alt="${cd.code}${cd.cat ? "-" + cd.cat : ""}" />
        <div class="hint">Scan with the Worker Portal when you START working ${cd.cat ? `on the <b>${catLabel(cd.cat)}</b> line here` : "in this department"}.<br/>Scan again when you switch line or department · punching out ends it.</div>
      </div>`,
      )
      .join("");
    const w = win ?? window.open("", "_blank");
    if (!w) return;
    // One card per FULL A4 page (owner 2026-06-12: "每一个都是 A4 size") —
    // poster-sized name + ~13cm QR, scannable from arm's length on the wall.
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Department QR Codes - Hookka</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #1F1D1B; }
        .card { border: 2px solid #1F1D1B; border-radius: 6mm; padding: 12mm; text-align: center;
                min-height: 270mm; display: flex; flex-direction: column; align-items: center;
                justify-content: center; gap: 6mm; page-break-after: always; }
        .card:last-child { page-break-after: auto; }
        .dept { font-size: 48pt; font-weight: 800; line-height: 1.1; }
        .cat { display: inline-block; padding: 2mm 10mm; border: 2px solid #1F1D1B; border-radius: 10mm; font-size: 26pt; font-weight: 800; letter-spacing: 2px; }
        .cat-sofa { background: #E8EEF0; }
        .cat-bedframe { background: #F0EAE0; }
        .cat-accessory { background: #ECECEC; }
        .code { font-size: 14pt; color: #6B7280; letter-spacing: 2px; }
        img { width: 130mm; height: 130mm; }
        .hint { font-size: 13pt; color: #4B5563; line-height: 1.5; max-width: 150mm; }
      </style></head><body>
      ${cardsHtml}
      <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
      </body></html>`);
    w.document.close();
  } catch {
    /* poster is a convenience — never crash the tab */
    win?.close();
  }
}
