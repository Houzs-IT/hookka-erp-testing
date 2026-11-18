import type { PackingStickerHeader, FibreStickerSetPosition } from "../fibre-sticker-set";

export interface FibreStickerPageProps {
  header: PackingStickerHeader;
  qrDataUrl?: string;
  componentLabel: string | null;
  setPosition: FibreStickerSetPosition;
}

function modelFontSizePt(productCode: string): number {
  return Math.max(11, Math.min(20, Math.round(250 / (productCode.length + 2))));
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="inline-block w-[30mm] font-semibold">{label}</span>: {value}
    </div>
  );
}

export function FibreStickerPage({ header, qrDataUrl, componentLabel, setPosition }: FibreStickerPageProps) {
  const productCode = header.productCode || "—";
  return (
    <div className="sticker-jc-page bg-white text-black" style={{ width: "100mm", height: "150mm" }}>
      <div className="w-full h-full flex flex-col" style={{ fontSize: "10pt" }}>
        <div className="text-center font-bold" style={{ fontSize: "22pt", lineHeight: 1.1 }}>
          {header.customerHub || header.customerName || "—"}
        </div>
        <div className="border-t-2 border-black my-[2mm]" />
        <div className="space-y-[1.5mm]" style={{ fontSize: "14pt", lineHeight: 1.25 }}>
          <FieldRow label="PO No" value={header.customerPOId || "—"} />
          <FieldRow label="Cust Ref" value={header.customerRef || "—"} />
          <FieldRow label="Cust SO" value={header.customerSO || "—"} />
          <FieldRow label="Our SO No" value={header.salesOrderNo || "—"} />
          <div className="flex items-baseline gap-[1mm]">
            <span className="inline-block w-[30mm] font-semibold shrink-0">Model</span>
            <span
              className="font-bold whitespace-nowrap"
              style={{ fontSize: `${modelFontSizePt(productCode)}pt`, lineHeight: 1.1 }}
            >: {productCode}</span>
          </div>
          {header.boxLabel && (
            <div className="flex items-baseline gap-[1mm]">
              <span className="font-semibold shrink-0" style={{ width: "30mm" }}>WIP</span>
              <span className="flex-1 min-w-0 truncate" style={{ fontSize: "11pt", lineHeight: 1.2 }}>
                : {header.boxLabel}
              </span>
            </div>
          )}
        </div>
        <div className="border-t border-black my-[2mm]" />
        <div className="space-y-[1.5mm]" style={{ fontSize: "14pt", lineHeight: 1.25 }}>
          <FieldRow label="Size" value={header.sizeLabel || "—"} />
          {header.itemCategory === "SOFA" && header.seatSize && (
            <FieldRow label="Seat" value={`${header.seatSize}"`} />
          )}
          <FieldRow label="Colour" value={header.fabricCode || "—"} />
          {header.itemCategory === "BEDFRAME" && (
            <>
              <FieldRow label="Gap" value={header.gapInches != null ? `${header.gapInches}"` : "—"} />
              <FieldRow label="Divan" value={header.divanHeightInches != null ? `${header.divanHeightInches}"` : "—"} />
            </>
          )}
          {header.legHeightInches != null && header.legHeightInches > 0 && (
            <FieldRow label="Leg" value={`${header.legHeightInches}"`} />
          )}
        </div>
        {header.specialOrder && (
          <div className="flex items-baseline gap-[1mm] mt-[1.5mm]" style={{ fontSize: "14pt", lineHeight: 1.25 }}>
            <span className="font-semibold shrink-0" style={{ width: "30mm", color: "#9A3A2D" }}>Notes</span>
            <span className="flex-1 min-w-0 break-words font-bold" style={{ fontSize: "11pt", color: "#9A3A2D" }}>
              : ★ {header.specialOrder}
            </span>
          </div>
        )}
        <div className="mt-auto pt-[2mm] border-t border-dashed border-black">
          <div className="flex items-end gap-[2mm] pt-[2mm]">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="Fibre job card QR"
                style={{ width: "28mm", height: "28mm" }}
                className="block ml-[2mm] mb-[1.5mm] shrink-0"
              />
            )}
            <div className="flex-1 text-center min-w-0 flex flex-col items-center gap-[1mm]">
              <div className="uppercase font-semibold" style={{ fontSize: "11pt" }}>Fibre</div>
              {componentLabel && (
                <div
                  className="font-bold uppercase border-2 border-black"
                  style={{ fontSize: "16pt", lineHeight: 1.05, padding: "0.5mm 2mm", borderRadius: "1mm" }}
                >
                  {componentLabel}
                </div>
              )}
              <div className="font-bold" style={{ fontSize: "28pt", lineHeight: 1 }}>
                {setPosition.position}/{setPosition.setSize}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
