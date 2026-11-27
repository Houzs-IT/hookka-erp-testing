// ---------------------------------------------------------------------------
// howto/flows.ts — end-to-end business chains and first-week reading paths.
// A flow links task guides in order; the how_to tool expands every step into
// the full click-by-click guide, so a flow reads as one operating manual from
// the first click to the last. tests/mcp-howto.test.mjs checks every guide id.
// ---------------------------------------------------------------------------
import type { HowToFlow } from "./types";

export const FLOWS: HowToFlow[] = [
  {
    id: "flow-order-to-cash",
    title: "Order to cash: sales order to customer payment",
    keywords: ["order to cash", "whole process", "end to end", "SO to payment", "从订单到收款", "整个流程", "流程", "proses penuh"],
    summary: "A customer order goes from the sales order, through production (job cards, worker scans, QC) and finished goods, to the delivery order, the invoice and the customer's payment.",
    steps: [
      { guide: "create-sales-order", role: "Sales / sales admin", handoff: "Start here when the customer confirms what they want. The customer must exist in Customers." },
      { guide: "create-production-order", role: "Sales admin (confirms the SO) / production planner", handoff: "The SO is saved. Confirming it uses free stock first and creates production orders and job cards for the rest." },
      { guide: "worker-scan-job-card", role: "Floor workers (worker app PIN login)", handoff: "Job-card stickers are printed for each department; each department scans its card when its part is done." },
      { guide: "complete-qc", role: "QC inspector / department leader", handoff: "Department work is scanned complete; QC checks it before it moves on." },
      { guide: "fg-scan", role: "Packing / warehouse", handoff: "The last department (Upholstery) completes and the goods are finished; packing, loading and delivery are scanned." },
      { guide: "create-delivery-order", role: "Logistics / delivery admin", handoff: "Finished production orders appear under Pending Delivery and are turned into a delivery order." },
      { guide: "create-invoice", role: "Logistics marks delivered; finance checks / sends invoices", handoff: "The DO is delivered. Marking it delivered normally creates and posts the invoice automatically." },
      { guide: "record-customer-payment", role: "Finance", handoff: "The invoice is in Debtors. Record the customer's money against it when it arrives." },
    ],
  },
  {
    id: "flow-procure-to-pay",
    title: "Procure to pay: material shortage to supplier payment",
    keywords: ["procure to pay", "purchasing process", "buying process", "采购流程", "从缺料到付款", "proses belian"],
    summary: "Purchasing sees what is short in MRP, raises POs, the warehouse receives the goods (GRN), finance records the supplier's invoice and pays it.",
    steps: [
      { guide: "mrp-shortages-to-po", role: "Purchasing", handoff: "Open production orders need materials; MRP shows what stock and open POs do not cover." },
      { guide: "create-purchase-order", role: "Purchasing", handoff: "For items MRP did not raise, or to order directly. The supplier must exist in Suppliers." },
      { guide: "receive-goods-grn", role: "Warehouse / store keeper", handoff: "The PO is confirmed and sent to the supplier; the goods arrive." },
      { guide: "record-purchase-invoice", role: "Finance / purchasing admin", handoff: "The supplier's invoice arrives, usually after the goods." },
      { guide: "record-supplier-payment", role: "Finance", handoff: "The purchase invoice is confirmed and sits in Creditors until paid." },
    ],
  },
  {
    id: "flow-product-setup",
    title: "Product setup: new product to selling price",
    keywords: ["product setup", "new product process", "launch product", "新产品流程", "上新", "produk baru"],
    summary: "A new product is created, its variants added, its BOM written, its cost checked and its selling price set, so it can be sold and made.",
    steps: [
      { guide: "create-product", role: "R&D / admin", handoff: "The design is final (often from an R&D project)." },
      { guide: "create-variant", role: "R&D / admin", handoff: "The product exists; add its sizes, compartments and default options." },
      { guide: "edit-bom", role: "R&D / production planner", handoff: "Each product / variant needs its materials and department minutes." },
      { guide: "product-costing", role: "Admin / Finance / R&D only", handoff: "The BOM is complete; check the cost per fabric tier." },
      { guide: "set-selling-price", role: "Admin / sales manager", handoff: "The cost is known; set the master price and any customer prices." },
    ],
  },
  {
    id: "flow-after-sales",
    title: "After-sales: delivery return and service case to close",
    keywords: ["after-sales process", "service process", "complaint process", "售后流程", "退货流程", "proses selepas jualan"],
    summary: "A customer problem is recorded as a delivery return and / or a service case, worked through its stages with notes, and closed — with a service order when parts or a re-make are needed.",
    steps: [
      { guide: "delivery-return", role: "Logistics / after-sales", handoff: "Goods came back at or after delivery." },
      { guide: "open-service-case", role: "After-sales / customer service", handoff: "The customer reports a problem (with or without a return)." },
      { guide: "add-case-note", role: "After-sales / service agent", handoff: "Log every call, visit and action on the case as it happens." },
      { guide: "move-service-case-stage", role: "After-sales", handoff: "Move the case on as each stage is done, until it is closed." },
      { guide: "create-service-order", role: "After-sales / sales admin", handoff: "When the fix needs parts, a replacement or a re-make." },
    ],
  },
  {
    id: "flow-payroll-inputs",
    title: "Payroll inputs: attendance and working hours to payroll",
    keywords: ["payroll process", "salary process", "working hours to payroll", "工资流程", "算工资", "proses gaji"],
    summary: "Worker scans and attendance build the working hours that payroll uses. Payroll figures are only visible to roles with payroll permission.",
    steps: [
      { guide: "worker-scan-job-card", role: "Floor workers", handoff: "Workers clock in and scan their work every day." },
      { guide: "attendance-working-hours", role: "HR / supervisors", handoff: "Check and correct attendance and working hours before the month closes." },
      { guide: "apply-leave", role: "Workers / HR", handoff: "Leave is recorded so payroll does not count it as absence." },
    ],
  },
];

/** First-week reading path per role: an ordered list of guide / flow ids. */
export const ONBOARDING: Record<string, { title: string; path: string[] }> = {
  sales: { title: "Sales / sales admin", path: ["flow-order-to-cash", "create-sales-order", "set-selling-price", "create-production-order", "create-delivery-order", "print-documents", "mail-center-reply"] },
  purchasing: { title: "Purchasing", path: ["flow-procure-to-pay", "mrp-shortages-to-po", "create-purchase-order", "add-po-note", "receive-goods-grn", "record-purchase-invoice", "mail-center-reply"] },
  production: { title: "Production / factory", path: ["flow-order-to-cash", "create-production-order", "worker-scan-job-card", "complete-qc", "production-planning", "outsource-work", "fg-scan", "maintenance-log", "attendance-working-hours"] },
  warehouse: { title: "Warehouse / store", path: ["receive-goods-grn", "stock-adjustment", "stock-take", "fg-scan", "create-delivery-order", "delivery-return", "print-documents"] },
  finance: { title: "Finance / accounts", path: ["flow-order-to-cash", "flow-procure-to-pay", "create-invoice", "record-customer-payment", "record-purchase-invoice", "record-supplier-payment", "product-costing", "flow-payroll-inputs"] },
  "after-sales": { title: "After-sales / customer service", path: ["flow-after-sales", "open-service-case", "add-case-note", "move-service-case-stage", "create-service-order", "delivery-return", "mail-center-reply"] },
};
