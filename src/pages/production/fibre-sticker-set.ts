export interface PackingStickerHeader {
  poNo: string;
  customerName: string;
  customerHub?: string;
  customerPOId?: string;
  customerRef?: string;
  customerSO?: string;
  salesOrderNo: string;
  productCode: string;
  boxLabel?: string;
  sizeLabel: string;
  seatSize?: string;
  fabricCode: string;
  itemCategory?: string;
  gapInches?: number | null;
  divanHeightInches?: number | null;
  legHeightInches?: number | null;
  specialOrder?: string;
  isSyntheticLegs?: boolean;
  isSyntheticPillow?: boolean;
}

export interface FibreJobCardStickerSource {
  poNo: string;
  customerName?: string;
  customerPOId?: string;
  customerRef?: string;
  salesOrderNo?: string;
  model?: string;
  wipName: string;
  sizeLabel: string;
  colour?: string;
  category?: string;
  specialOrder?: string;
}

export interface FibreStickerSetPosition {
  position: number;
  setSize: number;
}

export function pickPackingHeaderForPo(
  headers: PackingStickerHeader[],
  poNo: string,
): PackingStickerHeader | undefined {
  return headers.find(
    (header) => header.poNo === poNo && !header.isSyntheticLegs && !header.isSyntheticPillow,
  );
}

export function buildFallbackPackingHeader(source: FibreJobCardStickerSource): PackingStickerHeader {
  return {
    poNo: source.poNo,
    customerName: source.customerName ?? "",
    customerPOId: source.customerPOId,
    customerRef: source.customerRef,
    salesOrderNo: source.salesOrderNo ?? "",
    productCode: source.model ?? "",
    boxLabel: source.wipName,
    sizeLabel: source.sizeLabel,
    fabricCode: source.colour ?? "",
    itemCategory: source.category,
    specialOrder: source.specialOrder,
  };
}

export function numberWithinSalesOrder(
  stickers: Array<{ poNo: string; salesOrderNo?: string }>,
): FibreStickerSetPosition[] {
  const setKeyOf = (sticker: { poNo: string; salesOrderNo?: string }): string =>
    sticker.salesOrderNo || sticker.poNo;
  const setSizes = new Map<string, number>();
  for (const sticker of stickers) {
    const setKey = setKeyOf(sticker);
    setSizes.set(setKey, (setSizes.get(setKey) ?? 0) + 1);
  }
  const positionsSoFar = new Map<string, number>();
  return stickers.map((sticker) => {
    const setKey = setKeyOf(sticker);
    const position = (positionsSoFar.get(setKey) ?? 0) + 1;
    positionsSoFar.set(setKey, position);
    return { position, setSize: setSizes.get(setKey) ?? position };
  });
}

export function isOrderInFibreStickerScope(
  order: { poNo: string; itemCategory?: string; companySOId?: string; companyCOId?: string },
  fibrePoNos: ReadonlySet<string>,
  fibreSalesOrderNos: ReadonlySet<string>,
): boolean {
  if (fibrePoNos.has(order.poNo)) return true;
  const parentSalesOrderNo = order.companySOId || order.companyCOId || "";
  return order.itemCategory === "SOFA" && fibreSalesOrderNos.has(parentSalesOrderNo);
}
