// ---------------------------------------------------------------------------
// howto/glossary.ts — plain-English definitions of the terms staff meet in
// the ERP. `labels` are strings the UI really shows (tests/mcp-howto.test.mjs
// checks them against src/), `page` is where the term is seen (router path).
// ---------------------------------------------------------------------------

export type GlossaryEntry = {
  term: string;
  aliases: string[];
  definition: string;
  /** Strings the UI really shows for this term. */
  labels: string[];
  page?: string;
  keywords: string[];
  guides?: string[];
};

export const GLOSSARY: GlossaryEntry[] = [
  { term: "SO", aliases: ["Sales Order"], definition: "The customer's order: what they bought, at what price, and when it should be delivered. Confirming it starts production.", labels: ["Sales Orders"], page: "/sales", keywords: ["销售单", "订单", "开单", "pesanan jualan"], guides: ["create-sales-order"] },
  { term: "PO", aliases: ["Purchase Order"], definition: "Our order to a supplier for materials or goods, with quantities, prices and an expected date.", labels: ["Purchase Order"], page: "/procurement", keywords: ["采购单", "订货", "pesanan belian"], guides: ["create-purchase-order"] },
  { term: "Stock PO", aliases: ["Create Stock PO"], definition: "A production order made for stock (not for a customer's sales order), from the Production page.", labels: ["Create Stock PO"], page: "/production", keywords: ["备货", "库存生产"], guides: ["create-production-order"] },
  { term: "GRN", aliases: ["Goods Receipt", "Goods Received Note"], definition: "The record that goods from a supplier arrived. Posting it adds the quantities to stock.", labels: ["Goods Receipt"], page: "/procurement/grn", keywords: ["收货", "进货单", "terima barang"], guides: ["receive-goods-grn"] },
  { term: "PI", aliases: ["Purchase Invoice"], definition: "The supplier's invoice recorded in the ERP. Confirming it posts what we owe the supplier (AP).", labels: ["Purchase Invoice"], page: "/procurement/pi", keywords: ["供应商发票", "进货发票", "invois pembekal"], guides: ["record-purchase-invoice"] },
  { term: "DO", aliases: ["Delivery Order"], definition: "The document that goes with the goods to the customer. Marking it delivered creates the invoice.", labels: ["Delivery Order"], page: "/delivery", keywords: ["送货单", "出货", "pesanan penghantaran"], guides: ["create-delivery-order"] },
  { term: "Invoice", aliases: ["Tax invoice"], definition: "The bill to the customer for delivered goods. It is what the customer owes us (AR).", labels: ["Invoices"], page: "/invoices", keywords: ["发票", "invois"], guides: ["create-invoice"] },
  { term: "Job card", aliases: ["Job Card"], definition: "One department's piece of work on one production order (e.g. Fab Cut for one bed). Workers scan its sticker to complete it.", labels: ["Job Card"], page: "/production", keywords: ["工单", "工卡", "kad kerja"], guides: ["create-production-order", "worker-scan-job-card"] },
  { term: "Production order", aliases: ["PO (production)"], definition: "The factory's order to make one item, usually created when a sales order is confirmed. It holds the job cards for each department.", labels: ["Production"], page: "/production", keywords: ["生产单", "pesanan pengeluaran"], guides: ["create-production-order"] },
  { term: "WIP", aliases: ["Work in progress"], definition: "Half-made goods between departments (e.g. a sewn cover or a frame). WIP Times set how many minutes each WIP step should take.", labels: ["WIP Times"], page: "/bom/wip-times", keywords: ["半成品", "在制品", "kerja dalam proses"] },
  { term: "FG", aliases: ["Finished goods"], definition: "Completed products ready to pack and deliver. Finished goods stock is what delivery orders draw from.", labels: ["FG"], page: "/production/fg-scan", keywords: ["成品", "barang siap"], guides: ["fg-scan"] },
  { term: "BOM", aliases: ["Bill of materials"], definition: "The recipe of a product: every material and quantity, plus the departments and minutes. It drives job cards, MRP and costing.", labels: ["BOM"], page: "/bom", keywords: ["物料清单", "配方", "senarai bahan"], guides: ["edit-bom"] },
  { term: "Variant", aliases: ["Manage Variants"], definition: "A version of a product that differs in size, fabric, height or other options, without being a separate product.", labels: ["Manage Variants"], page: "/products", keywords: ["变体", "型号", "规格", "varian"], guides: ["create-variant"] },
  { term: "Fabric tier", aliases: ["Price Tier", "PRICE_1", "PRICE_2", "PRICE_3"], definition: "The price level of a fabric (PRICE_1, PRICE_2, PRICE_3 in the data). A dearer fabric tier makes the product cost and price more.", labels: ["Fabric Tier", "PRICE_1"], page: "/inventory/fabrics", keywords: ["布料等级", "布价", "tahap fabrik"], guides: ["product-costing"] },
  { term: "MRP", aliases: ["Material requirements planning"], definition: "Compares what open production orders need with stock and open POs, and shows what is short so purchasing can order it.", labels: ["MRP"], page: "/planning/mrp", keywords: ["缺料", "物料需求", "kekurangan bahan"], guides: ["mrp-shortages-to-po"] },
  { term: "QC", aliases: ["Quality check", "QC / Quality"], definition: "Checking the work is right before it moves on. Done on the worker app for in-process checks, or on the QC page.", labels: ["QC / Quality"], page: "/quality", keywords: ["质检", "检验", "kawalan kualiti"], guides: ["complete-qc"] },
  { term: "Service case", aliases: ["Service Cases", "after-sales case"], definition: "A customer complaint or after-sales job (repair, exchange, re-delivery) followed through stages until it is closed.", labels: ["Service Cases"], page: "/service-cases", keywords: ["售后", "维修单", "投诉", "kes servis", "aduan"], guides: ["open-service-case", "move-service-case-stage"] },
  { term: "Service order", aliases: ["Service Order"], definition: "An order for service work (e.g. a repair or replacement part) made from the sales-order form, linked to after-sales.", labels: ["Service Order"], page: "/service-order", keywords: ["服务单", "pesanan servis"], guides: ["create-service-order"] },
  { term: "Delivery return", aliases: ["Delivery Return"], definition: "Goods the customer sent back after delivery, recorded against the delivery order.", labels: ["Delivery Return"], page: "/delivery-returns", keywords: ["退货", "客户退货", "pulangan"], guides: ["delivery-return"] },
  { term: "Purchase return", aliases: ["Purchase Return"], definition: "Goods we send back to a supplier.", labels: ["Purchase Return"], page: "/purchase-returns", keywords: ["退供应商", "pulangan pembekal"] },
  { term: "Credit note", aliases: ["CN", "Credit Notes"], definition: "Reduces what a customer owes on an invoice (e.g. for a return or a price correction) without deleting the invoice.", labels: ["Credit Notes", "CN"], page: "/invoices/credit-notes", keywords: ["红字发票", "退款单", "nota kredit"] },
  { term: "Debit note", aliases: ["DN", "Debit Notes"], definition: "Adds to what a customer owes on an invoice (e.g. an extra charge).", labels: ["Debit Notes", "DN"], page: "/invoices/debit-notes", keywords: ["加收", "nota debit"] },
  { term: "AR aging", aliases: ["Debtor Aging", "receivables"], definition: "Who owes us money and for how long (e.g. 0-30, 31-60, over 90 days).", labels: ["Debtor Aging"], page: "/accounting", keywords: ["应收", "欠款", "账龄", "penghutang"] },
  { term: "AP aging", aliases: ["Creditor Aging", "payables"], definition: "Who we owe money to and for how long.", labels: ["Creditor Aging"], page: "/accounting", keywords: ["应付", "欠供应商", "pemiutang"] },
  { term: "Receipt", aliases: ["OR", "Receipts"], definition: "Money received from a customer, matched against their invoices.", labels: ["Receipts"], page: "/accounting", keywords: ["收款", "resit"], guides: ["record-customer-payment"] },
  { term: "Payment voucher", aliases: ["PV", "Payment Vouchers"], definition: "A record of money we pay out, e.g. to a supplier, matched against their purchase invoices.", labels: ["Payment Vouchers", "PV"], page: "/accounting", keywords: ["付款单", "baucar bayaran"], guides: ["record-supplier-payment"] },
  { term: "e-Invoice", aliases: ["LHDN MyInvois"], definition: "The electronic copy of an invoice sent to LHDN (Malaysia's tax authority) through MyInvois.", labels: ["e-Invoice", "LHDN MyInvois"], page: "/invoices/e-invoice", keywords: ["电子发票", "e-invois"] },
  { term: "Sen vs RM", aliases: ["sen", "RM"], definition: "The ERP stores money in sen (1 RM = 100 sen) so there are no rounding errors; screens and the AI Connector show RM.", labels: [], keywords: ["仙", "令吉", "ringgit"] },
  { term: "Floor Live", aliases: ["floor"], definition: "A dashboard view of who is working where right now, from the department QR scans on the factory floor.", labels: ["Floor Live"], page: "/dashboard-experimental", keywords: ["车间实时", "lantai kilang"] },
  { term: "Efficiency %", aliases: ["efficiency"], definition: "Earned minutes (the standard minutes of the work done) divided by clocked minutes. 100% means the work took exactly the standard time.", labels: ["Efficiency %"], page: "/employees", keywords: ["效率", "kecekapan"] },
  { term: "PIC", aliases: ["Person in charge"], definition: "The person in charge, e.g. the worker(s) credited on a job card or a customer's contact person.", labels: ["PIC"], keywords: ["负责人", "orang bertanggungjawab"] },
  { term: "ETA", aliases: ["Expected arrival"], definition: "The date goods are expected to arrive (from a supplier) or reach the customer.", labels: ["ETA"], keywords: ["预计到货", "jangka tiba"] },
  { term: "MOQ", aliases: ["Minimum order quantity"], definition: "The smallest quantity a supplier will sell in one order.", labels: ["MOQ"], keywords: ["起订量", "kuantiti minimum"] },
  { term: "Consignment", aliases: ["Consignment Order", "Consignment Note"], definition: "Goods placed at a customer's outlet that stay ours until sold; recorded with consignment orders, notes and returns instead of a normal sales order flow.", labels: ["Consignment Order", "Consignment Note", "Consignment Return"], page: "/consignment", keywords: ["寄卖", "寄售", "konsainan"] },
  { term: "Customer hub", aliases: ["hub", "branch"], definition: "One delivery address / branch of a customer that has several outlets; a sales order can be tied to a hub.", labels: [], page: "/customers", keywords: ["分店", "cawangan"] },
  { term: "Purchase company", aliases: ["organisation", "sister company"], definition: "Which company in the group (e.g. HOOKKA or OHANA) a PO, GRN or purchase invoice is issued under; it changes the letterhead, while the accounting stays HOOKKA.", labels: ["Organisations"], page: "/settings/organisations", keywords: ["公司", "抬头", "syarikat"] },
  { term: "Stock adjustment", aliases: ["Stock Adjustments"], definition: "A correction to stock quantities (found, damaged, lost); it posts to stock and the cost ledger at once.", labels: ["Stock Adjustments"], page: "/inventory/adjustments", keywords: ["调库存", "库存调整", "pelarasan stok"], guides: ["stock-adjustment"] },
  { term: "Stock take", aliases: ["Stock Take", "stock count"], definition: "Counting what is physically in the warehouse to compare with the system.", labels: ["Stock Take"], page: "/inventory/stock-take", keywords: ["盘点", "kiraan stok"], guides: ["stock-take"] },
  { term: "Outsource", aliases: ["Outsource Work"], definition: "Sending a department's work to an outside workshop and receiving it back.", labels: ["Outsource Work"], page: "/production/outsource-issue", keywords: ["外包", "外发", "luar"], guides: ["outsource-work"] },
];
