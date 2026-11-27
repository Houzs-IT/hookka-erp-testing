// ---------------------------------------------------------------------------
// howto/guides-products.ts — Products & BOM + Warehouse stock guides for the
// AI Connector's "how do I…" help. Written from the real frontend code:
//   - create-product / create-variant: src/pages/inventory/index.tsx (Add FG),
//     src/pages/products/index.tsx (Variant Defaults), POST/PUT /api/products
//   - edit-bom: src/pages/bom.tsx (BOM Builder), src/pages/products/bom.tsx,
//     PUT /api/bom/templates/:id
//   - product-costing: src/pages/products/costing.tsx + costing-editor.tsx,
//     src/api/routes/product-costing.ts (requireCostingRead)
//   - set-selling-price: products/index.tsx (Edit + Schedule price change),
//     MasterPriceHistoryDialog.tsx, customer-assignments.tsx
//   - stock-adjustment: src/pages/inventory/adjustments.tsx,
//     src/api/routes/stock-adjustments.ts
//   - stock-take: src/pages/inventory/stock-take.tsx, src/api/routes/stock-count.ts
// ---------------------------------------------------------------------------
import type { HowToGuide } from "./types";

export const GUIDES: HowToGuide[] = [
  // -------------------------------------------------------------------------
  {
    id: "create-product",
    title: "Create a new product (finished good SKU)",
    keywords: [
      "create product", "new product", "add product", "new SKU", "add FG", "finished good", "new model",
      "新产品", "新增产品", "开产品", "产品", "加产品", "新型号",
      "produk baru", "tambah produk", "cipta produk", "barang siap",
    ],
    module: "Products & BOM",
    purpose: `Register a new finished-good SKU (bedframe, sofa or accessory) so it can be put on sales orders, given a BOM and priced. New products are added from the Inventory page's "Finished Products" tab, not from the Products page (the Products page only lists, edits and imports).`,
    prerequisites: [
      // src/api/routes/products.ts:746-755 — duplicate code check returns "Product code … already exists"
      "The product code is agreed and not already used (the system refuses a duplicate code).",
      // src/api/routes/products.ts:729-741 — POST rejects a BEDFRAME with a blank sizeCode
      "For a bedframe you know its size code (K / Q / S / SS) — it is required.",
      // src/api/routes/products.ts:718-723 — code, name and category are required
      "Code, name and category are mandatory; everything else can be filled later.",
      "Optional: an existing similar SKU to copy from, which saves typing.",
    ],
    who: "Admin, R&D or the product / master-data person. Needs the products create permission; Sales normally only reads products.",
    permission: ["products:create", "inventory:read"],
    page: "/inventory",
    sidebar: "WAREHOUSE → Inventory",
    steps: [
      {
        do: `Open WAREHOUSE → Inventory and stay on the "Finished Products" tab (it is the first tab).`,
        highlight: "Finished Products",
      },
      {
        do: `Click "Add FG" at the top right of the finished-products list.`,
        highlight: "Add FG",
        then: `An "Add Finished Product" card opens above the list, on the "Single" mode.`,
      },
      {
        do: `Optional shortcut: in "Copy from existing (optional)" search and pick a similar SKU. Every field below is filled from it; you then change only what differs (usually Code, Name and size).`,
        fields: [
          { label: "Copy from existing (optional)", required: false, value: "Search by code or name and pick one SKU. Leave blank to start from scratch. Seat-height prices, sub-assemblies and pieces are carried over but cannot be edited here.", example: "'1003(A)-(Q) - ROMA BEDFRAME (5FT)'" },
        ],
      },
      {
        do: "Fill in the product fields in the card.",
        fields: [
          { label: "Code *", required: true, value: "The unique product code. Must not already exist.", example: "'2050(A)-(K)'" },
          { label: "Name *", required: true, value: "The product name staff and customers see.", example: "'ROMA BEDFRAME (6FT)'" },
          { label: "Category", required: true, value: "Pick Bedframe, Sofa or Accessory (defaults to Bedframe).", example: "'Bedframe'" },
          { label: "Base Model", required: false, value: "The model family code; if left blank the Code is used.", example: "'2050(A)'" },
          { label: "Size Code", required: false, value: "Required by the server for a Bedframe (K / Q / S / SS) — it drives the Headboard + Divan piece count on packing stickers. Optional for sofa / accessory.", example: "'K'" },
          { label: "Size Label", required: false, value: "The size as printed.", example: "'6FT'" },
          { label: "Description", required: false, value: "Free text notes.", example: "'Roma bedframe with tufted headboard'" },
          { label: "Base Price (RM)", required: false, value: "Selling price (Price 2) in RM with 2 decimals; can be left blank and set later.", example: "'1280.00'" },
          { label: "Price 1 (RM)", required: false, value: "Optional bedframe tier-1 price in RM.", example: "'1180.00'" },
          { label: "Unit M3", required: false, value: "Volume per unit in cubic metres (for loading).", example: "'0.69'" },
          { label: "Fabric Usage (m)", required: false, value: "Metres of fabric per unit.", example: "'6'" },
          { label: "SKU Code", required: false, value: "Optional external / customer SKU code.", example: "'2050-K-BASE'" },
          { label: "Fabric Colour", required: false, value: "Optional default colour text.", example: "'Grey'" },
        ],
        check: "Code and Name are filled (the save button stays disabled until both are), the code is spelled exactly as agreed, and a bedframe has its Size Code.",
      },
      {
        do: `Click "Save Product".`,
        highlight: "Save Product",
        then: `The product is created with status ACTIVE and a "Product created:" message appears. The card closes and the new SKU shows in the Finished Products list, on the Products page and in the Sales Order product picker. It has no BOM yet — it appears as "pending BOM" on the BOM page.`,
      },
    ],
    checkBefore: [
      "The code is not a typo — it becomes the key used on sales orders, BOMs and stickers.",
      "A bedframe has a Size Code (K / Q / S / SS); otherwise the server rejects the save.",
      "Category is correct (Bedframe / Sofa / Accessory) — it controls which variant fields and BOM types apply.",
    ],
    result: "A new ACTIVE product row exists. It shows in WAREHOUSE → Inventory (Finished Products), PRODUCTS & BOM → Products and the sales order product list. No stock, no BOM and no customer price are created.",
    warnings: [
      "A product without a BOM cannot be costed and its production job cards will have no steps — create the BOM next.",
      "Prices typed here go straight onto the master price; customer-specific prices are set separately.",
    ],
    // src/api/routes/products.ts:1069-1070 — PUT needs products:update; 1155-1165 — PUT also refuses a bedframe with blank sizeCode
    // src/api/routes/products.ts:1277-1300 — DELETE needs products:delete and only sets status INACTIVE
    // src/api/lib/lock-helpers.ts:284-313 — delete blocked by open SO / CO lines, open production orders or an ACTIVE BOM
    undo: `Wrong details: right-click the row in the Finished Products list and choose "Edit", or edit it on the Products page (needs products update; a bedframe still cannot lose its size code). Created by mistake: right-click → "Delete" (needs products delete). Delete only sets the product INACTIVE, and it is refused while the product is on an open sales order or consignment order line, an unfinished production order, or has an ACTIVE BOM — resolve those first.`,
    commonMistakes: [
      { mistake: "Creating a bedframe without a Size Code.", fix: "Type K, Q, S or SS in Size Code — the save is refused without it." },
      { mistake: `Looking for a "new product" button on the Products page.`, fix: `New products are added from WAREHOUSE → Inventory → "Add FG". The Products page only has "Batch Import" for spreadsheets.` },
      { mistake: "Typing every size of a model one by one.", fix: `Use "Bulk generate" in the same card (see the create-variant guide) to create all sizes at once.` },
    ],
    workedExample: "R&D adds model 2050(A) in King size: Inventory → Add FG → Code '2050(A)-(K)', Name 'ROMA BEDFRAME (6FT)', Category Bedframe, Base Model '2050(A)', Size Code 'K', Size Label '6FT', Unit M3 '0.69' → Save Product. Then they build its BOM.",
    related: ["create-variant", "edit-bom", "set-selling-price", "product-costing"],
    nextStep: "Create the product's BOM (edit-bom), then set its selling price (set-selling-price).",
    contact: "R&D / product master-data owner, or Admin",
    // Products are one catalogue for the tenant; no company field on POST /api/products (products.ts:771-800).
    companies: ["ALL"],
    variants: [
      {
        case: "Bedframe",
        differences: [
          // src/api/routes/products.ts:729-741
          `"Size Code" is mandatory (K / Q / S / SS); the save is rejected without it.`,
          `"Price 1 (RM)" is the bedframe tier-1 price; Price 3 is worked out automatically from Price 2.`,
        ],
      },
      {
        case: "Sofa",
        differences: [
          `"Size Code" is optional. Seat-height prices are not set here — after saving, set them with "Schedule price change" on the Products page.`,
        ],
      },
      {
        case: "Accessory",
        differences: [
          // src/pages/inventory/index.tsx — Bulk generate only offers Bedframe / Sofa
          `Use "Single" only — "Bulk generate" does not offer Accessory. Only a default fabric applies later in "Variant Defaults".`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "create-variant",
    title: "Add variants: new sizes / compartments of a model, and default fabric / height settings",
    keywords: [
      "variant", "add variant", "new size", "sizes", "compartment", "bulk generate", "variant defaults", "default fabric", "manage variants",
      "变体", "型号", "尺寸", "加尺寸", "默认布料", "规格", "多尺寸",
      "varian", "saiz", "tambah saiz", "kain lalai",
    ],
    module: "Products & BOM",
    purpose: `The ERP has two kinds of variant: (1) each size (bedframe) or compartment (sofa) of a model is its own SKU — create them all at once with "Bulk generate"; (2) per-SKU "Variant Defaults" (default fabric, divan height, leg height, gap, seat height, specials) that pre-fill a sales order line. Use this guide for either.`,
    prerequisites: [
      // src/pages/inventory/index.tsx:1103-1114 — tick pool comes from variants-config bedframeSizes / sofaCompartments
      "For new sizes: the sizes / compartments exist in PRODUCTS & BOM → Products → Maintenance (Bedframe Sizes / Compartments lists).",
      "For defaults: the SKU already exists, and the fabric / height options exist in Products → Maintenance.",
      // src/pages/inventory/index.tsx:1187-1232 + src/api/routes/products.ts:746-755 — each variant is its own POST; existing codes are skipped
      "Each generated variant goes through the same duplicate-code and bedframe size-code checks as a single product; codes that already exist are skipped.",
    ],
    who: "R&D or the product master-data person. New sizes need products create; Variant Defaults need products update.",
    permission: ["products:create", "products:update"],
    page: "/inventory",
    sidebar: "WAREHOUSE → Inventory",
    steps: [
      {
        do: `Part A — new sizes / compartments. Open WAREHOUSE → Inventory, "Finished Products" tab, and click "Add FG".`,
        highlight: "Add FG",
      },
      {
        do: `In the "Add Finished Product" card click "Bulk generate".`,
        highlight: "Bulk generate",
        fields: [
          { label: "Base Model *", required: true, value: "The model code; each variant code is built from it.", example: "'1003'" },
          { label: "Name", required: false, value: "Required for Bedframe (used in every size's name); optional for Sofa (blank gives SOFA <model> <compartment>).", example: "'ROMA BEDFRAME'" },
          { label: "Category", required: true, value: "Bedframe or Sofa only — bulk generate does not support Accessory.", example: "'Bedframe'" },
        ],
      },
      {
        do: `Tick each size (bedframe) or compartment (sofa) the model comes in, or click "Select all".`,
        highlight: "Select all",
        check: "The preview box lists every code that will be created. Fabric usage and prices are left blank.",
      },
      {
        do: `Click the "Generate" button (it shows how many products will be made).`,
        highlight: "Generate",
        then: "One product is created per tick. Codes that already exist are skipped and reported, never overwritten. If a size has a default BOM set in Products → Maintenance, that BOM is copied to the new SKU as a DRAFT — activate it on the BOM page.",
      },
      {
        page: "/products",
        do: `Part B — Variant Defaults. Open PRODUCTS & BOM → Products ("SKU Master" view) and click the product row to expand it, then click "Manage Variants". (Or click the "Configure" pill in the "Variants" column.)`,
        highlight: "Manage Variants",
        then: `The "Variant Defaults" dialog opens for that SKU.`,
      },
      {
        page: "/products",
        do: "Pick the defaults. Which fields show depends on the category.",
        fields: [
          { label: "Default Fabric", required: false, value: "Any category. Pick a fabric code from the list.", example: "'PC151-02'" },
          { label: "Default Divan Height", required: false, value: "Bedframe only. From the Maintenance divan heights list.", example: "'8\"'" },
          { label: "Default Leg Height", required: false, value: "Bedframe or Sofa. From the Maintenance leg heights list.", example: "'2\"'" },
          { label: "Default Gap", required: false, value: "Bedframe only.", example: "'1'" },
          { label: "Default Seat Height", required: false, value: "Sofa only. From the Maintenance sofa sizes list.", example: "'24'" },
          { label: "Default Special Orders", required: false, value: "Bedframe or Sofa; tick any number of specials.", example: "'Extra firm'" },
        ],
        check: "Leave a field on its blank option to have no default. Accessories only take a default fabric.",
      },
      {
        page: "/products",
        do: `Click "Save Defaults".`,
        highlight: "Save Defaults",
        then: `The defaults are saved on the product and checked by reading them back. The pill in the "Variants" column shows how many fields are set. New sales order lines for this SKU pre-fill these values; staff can still change them per line.`,
      },
    ],
    checkBefore: [
      "Bulk generate: the Base Model is exactly the model code, and only the sizes the model really comes in are ticked.",
      "Variant Defaults: the fabric chosen is the one most customers order — it pre-fills every new sales order line.",
    ],
    result: "Part A: one ACTIVE product per ticked size / compartment, visible on the Products and Inventory pages. Part B: the SKU's default variants are stored and used to pre-fill sales order lines.",
    warnings: [
      "Bulk-generated SKUs have no prices or fabric usage — fill them in before selling.",
      // src/pages/inventory/index.tsx:1217-1227 POSTs the copy without versionStatus; src/api/routes/bom.ts:404 defaults it to DRAFT
      "BOMs copied by Bulk generate are saved as DRAFT; many pages (WIP times, costing, sales) only use ACTIVE BOMs.",
      // src/api/routes/products.ts:1069-1070 — Variant Defaults save is PUT /api/products/:id (products:update)
      "Saving Variant Defaults needs products update; without it the save is refused.",
    ],
    undo: `A wrong SKU from Bulk generate: WAREHOUSE → Inventory, right-click it → "Delete" (products delete; sets it INACTIVE, refused if used). Wrong defaults: reopen "Manage Variants", change them or click "Clear all defaults", then "Save Defaults" (products update).`,
    commonMistakes: [
      { mistake: "A size is missing from the tick list.", fix: "Add it first in Products → Maintenance → Bedframe Sizes (or Compartments for sofa), then reopen Add FG." },
      { mistake: "Expecting Variant Defaults to lock the sales order.", fix: "They only pre-fill; the sales person can override each line." },
      { mistake: "Forgetting the copied BOMs are drafts.", fix: `Open PRODUCTS & BOM → BOM and click "Activate" on each new BOM (or tick the drafts and activate them together).` },
    ],
    workedExample: "R&D launches bedframe model 1003 in Q, K and S: Add FG → Bulk generate → Base Model '1003', Name 'ROMA BEDFRAME', Category Bedframe, tick Q, K, S → Generate 3 products. Then on Products they set 1003-(K)'s Default Fabric to 'PC151-02' and Default Divan Height to '8\"' → Save Defaults.",
    related: ["create-product", "edit-bom", "set-selling-price", "create-sales-order"],
    nextStep: "Activate or build each new SKU's BOM (edit-bom) and set its prices (set-selling-price).",
    contact: "R&D / product master-data owner",
    companies: ["ALL"],
    variants: [
      {
        case: "Bedframe model",
        differences: [
          // src/pages/inventory/index.tsx:1103-1114 — pool = bedframeSizes; the Name label carries " *" for bedframe (UI marker, not a save check)
          `Bulk generate lists the sizes from "Bedframe Sizes"; "Name" is marked as required (fill it in) and each size's name and code are built from it.`,
          `"Variant Defaults" shows "Default Fabric", "Default Divan Height", "Default Leg Height", "Default Gap" and "Default Special Orders".`,
        ],
      },
      {
        case: "Sofa model",
        differences: [
          // src/pages/inventory/index.tsx:1103-1114 — pool = sofaCompartments
          `Bulk generate lists the compartments from "Compartments"; "Name" may be left blank.`,
          `"Variant Defaults" shows "Default Fabric", "Default Seat Height", "Default Leg Height" and "Default Special Orders".`,
        ],
      },
      {
        case: "Accessory",
        differences: [
          // src/pages/products/index.tsx:599-614 — handleSave keeps only fabricCode for accessories
          `No bulk generate. "Variant Defaults" only keeps "Default Fabric".`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "edit-bom",
    title: "Create or edit a product's BOM (bill of materials)",
    keywords: [
      "BOM", "bill of materials", "edit BOM", "create BOM", "BOM builder", "WIP components", "routing", "raw materials", "process minutes",
      "物料清单", "改BOM", "做BOM", "新BOM", "工序", "用料", "配方",
      "senarai bahan", "bil bahan", "BOM baru", "proses",
    ],
    module: "Products & BOM",
    purpose: "Define how a product is made: the department processes with minutes (labour), the WIP components (headboard, divan, sofa base…) and the raw materials each step consumes. The BOM drives job cards, WIP minutes, material requirements (MRP) and product costing.",
    prerequisites: [
      "The product exists (create-product).",
      "The raw materials used exist in WAREHOUSE → Inventory → Raw Materials.",
      // src/api/routes/bom.ts:578-579 (PUT) and 373-374 (POST) — bom:update / bom:create
      "You hold the bom create / update permission; without it the save is refused.",
    ],
    who: "R&D or the production planner. Needs the bom create / update permission.",
    permission: ["bom:update"],
    page: "/bom",
    sidebar: "PRODUCTS & BOM → BOM",
    steps: [
      {
        do: `Open PRODUCTS & BOM → BOM (the "Bill of Materials" page). In the left panel type the product code in "Search products..." or pick a category, then click the product. (From a product page you can also click "Edit in BOM Builder".)`,
        highlight: "Search products...",
        check: `Products with no BOM show a PENDING tag; the "pending BOM" button at the top filters to just those.`,
      },
      {
        do: `If the product has no BOM yet: click "Create from Default Template" (pre-fills a category-standard routing) or "Start Blank".`,
        highlight: "Create from Default Template",
        then: `The "Edit BOM" dialog opens with the starting content.`,
      },
      {
        do: `If the product already has a BOM: click "Edit BOM" at the top of its BOM view.`,
        highlight: "Edit BOM",
      },
      {
        do: `Optional: fill the BOM from elsewhere with "Load Default" (a master template for the category) or "Copy From…" (another product's BOM). Both replace the current content after a confirm.`,
        highlight: "Copy From…",
      },
      {
        do: `On the "L1 Processes (FG)" tab, add finished-good assembly steps with "+ Add Process" and FG-level materials (packaging, bolts) with "+ Add Material".`,
        highlight: "L1 Processes (FG)",
        fields: [
          { label: "+ Add Process", required: false, value: "For each row pick the department and type the minutes per piece.", example: "'Packing, 15'" },
          { label: "+ Add Material", required: false, value: "Pick the raw material (or Fabric / Leg from order), type the quantity per unit and the wastage in the % waste box (use 0 for screws, legs, mechanisms).", example: "'Carton box, 1, 0'" },
        ],
      },
      {
        do: `Open the "WIP Components" tab. Click "+ Add" to add a component, select it on the left, and on the right set its type, code, department processes (minutes) and raw materials. Sub-components can be nested under it.`,
        highlight: "WIP Components",
        check: "Every WIP has its departments and minutes, and every raw material has a quantity. A missing material makes the cost short and MRP will not order it.",
      },
      {
        do: `Click "Save Changes".`,
        highlight: "Save Changes",
        check: "If open job cards would change minutes, a confirm lists the impact first — read it before confirming.",
        then: "The BOM is saved (a new BOM is saved ACTIVE). Minute changes are copied to live job cards of this month that use this BOM. Costing, WIP times and MRP use the new BOM from now on.",
      },
      {
        do: `If the BOM view shows a DRAFT tag (for example a BOM copied by Bulk generate), click "Activate" so the other pages start using it.`,
        highlight: "Activate",
      },
    ],
    checkBefore: [
      "You are editing the right product code (shown in the dialog title).",
      "Minutes are per piece and in the right department.",
      "Raw material quantities are per unit of the product, with wastage only on cut materials (fabric, foam, wood).",
    ],
    result: "The product's BOM template is created or updated. The read-only view at the product's BOM tab, costing, job card minutes and MRP shortages all reflect it.",
    warnings: [
      // src/api/routes/bom.ts:703-706 — syncJobCardMinutesToBomChanges on save of an ACTIVE BOM; preview at 621-626
      "Saving an ACTIVE BOM changes minutes on this month's live and completed job cards for this BOM (they feed payroll / KPIs). A preview of the impact is shown before the save.",
      // src/api/routes/bom.ts:690-695 — one ACTIVE BOM per product; others demoted to OBSOLETE
      "Only one ACTIVE BOM per product: activating or saving a BOM as ACTIVE retires the product's other active BOM to OBSOLETE.",
      // src/api/routes/bom.ts:657-660 — PUT inserting a new row defaults to ACTIVE
      "A BOM created from the BOM page is saved ACTIVE straight away.",
      "Load Default and Copy From replace the whole BOM content in the dialog.",
    ],
    // src/api/routes/bom.ts:578-700 — PUT updates the row in place (no version kept); audited at 697-702
    undo: `Reopen "Edit BOM", correct the processes / materials and "Save Changes" again (bom update). There is no one-click revert, so note the old values before a big change; "Export PDF" on the BOM view keeps a printable copy first.`,
    commonMistakes: [
      { mistake: "Editing on the product's BOM tab and finding no edit fields.", fix: `That tab is read-only. Click "Edit in BOM Builder" to edit on the BOM page.` },
      { mistake: "Leaving a copied BOM as DRAFT.", fix: `Click "Activate"; costing, WIP times and sales use ACTIVE BOMs only.` },
      { mistake: "Putting wastage on screws or legs.", fix: "Use 0 % waste for discrete parts; wastage is for fabric, foam and wood." },
    ],
    workedExample: "R&D sets up the BOM for 2050(A)-(K): BOM → search '2050(A)-(K)' → Create from Default Template → on WIP Components, Headboard gets Fab Cut 20 min, Sewing 35 min, Upholstery 40 min and 1.2 m of fabric from order; Divan gets Wood 25 min and 2 pcs plywood → Save Changes.",
    related: ["create-product", "product-costing", "mrp-shortages-to-po", "create-variant"],
    nextStep: "Check the product's cost (product-costing).",
    contact: "R&D lead or production planner",
    companies: ["ALL"],
    variants: [
      {
        case: "Bedframe vs Sofa vs Accessory product",
        differences: [
          // src/pages/bom.tsx — Load Default lists master templates of the product's category
          `"Load Default" only lists master templates of the product's own category ("Master Templates" on the BOM page holds them).`,
          // src/lib/wip-types.ts wipTypeAllowed + products/index.tsx MAINTENANCE_TABS — WIP types ticked per product type
          `The WIP type list only shows types ticked for that product type in Products → "Maintenance" → "WIP Types"; the code-builder fields follow "Variant Fields".`,
        ],
      },
      {
        case: "Product created by Bulk generate (copied BOM)",
        differences: [
          // src/api/routes/bom.ts:404 — POST /templates defaults versionStatus to DRAFT
          `The BOM arrives as DRAFT. Click "Activate" on the BOM, or tick the drafts in the product list and use the "Activate" bar.`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "product-costing",
    title: "View or edit a product's costing (labour + materials, margin)",
    keywords: [
      "costing", "product cost", "cost price", "margin", "standard cost", "labour cost", "material cost", "how much to make",
      "成本", "产品成本", "成本价", "毛利", "利润", "标准成本", "工钱", "材料成本",
      "kos", "kos produk", "margin", "kos standard", "kos bahan",
    ],
    module: "Products & BOM",
    purpose: "See what a product costs to make today (labour minutes × rate + raw materials at the current supplier price), the margin at each selling price, run what-if prices, record a standard cost, and correct the BOM minutes / materials that drive the cost.",
    prerequisites: [
      // src/api/routes/product-costing.ts:391 — standard cost refused without a BOM; costing.tsx shows the no-BOM notice
      "The product has a BOM (edit-bom). With no BOM the page says there is nothing to cost and no standard can be set.",
      // src/api/routes/product-costing.ts:381-385 — /standard needs products:update plus cost read; costing-editor saves via PUT /api/bom/templates/:id (bom.ts:578-579, bom:update)
      "To set a standard you also need products update; to save a costing edit you also need bom update.",
      "Raw materials have supplier prices; a line with no price is shown as No price and is not counted.",
    ],
    who: "Only Super Admin, Admin, Finance and R&D. The page and API need product-costing read (R&D) or cost-ledger read (Finance); Sales, QA, Office, Production, Warehouse and Procurement do not see the Costing tab. Editing or setting a standard also needs products update (and bom update to save BOM changes).",
    // src/api/lib/nav-permissions.ts:72 — /products/* pages share the products gate
    permission: ["products:read"],
    // src/api/routes/product-costing.ts:25-28 — requireCostingRead: product-costing:read OR cost-ledger:read
    permissionAny: ["product-costing:read", "cost-ledger:read"],
    page: "/products/:id/costing",
    sidebar: "PRODUCTS & BOM → Products",
    steps: [
      {
        page: "/products",
        do: `Open PRODUCTS & BOM → Products, click the product row to expand it and click "Costing" (or double-click the row, or click "Open product").`,
        highlight: "Costing",
        then: "The product page opens on its Costing tab. If you do not have cost permission the Costing tab is not shown.",
      },
      {
        do: `Read the four boxes at the top (Labour, Raw materials, Total cost, margin at Price 2), then the "Cost by WIP" cards and the "Price check" panel.`,
        highlight: "Cost by WIP",
        check: `A red "without a price" count means some materials have no supplier price, so the total is short.`,
      },
      {
        do: `Optional what-if: in the "Price check" panel type a price in "If I sell at (RM)" to see the margin, or a percentage in "If I want a margin of (%)" to see the price needed. Nothing is saved.`,
        highlight: "If I sell at (RM)",
        fields: [
          { label: "If I sell at (RM)", required: false, value: "A selling price in RM.", example: "'650'" },
          { label: "If I want a margin of (%)", required: false, value: "Target margin percent of the price.", example: "'60'" },
        ],
      },
      {
        do: `To record today's cost as the reference, click "Set as standard" (or "Update standard to today" when one exists) and confirm.`,
        highlight: "Set as standard",
        then: `A "Standard cost saved." message appears. The strip then shows the standard cost, today's cost and the difference. Earlier standards stay in history.`,
      },
      {
        do: `To correct minutes or materials, click "Edit costing". Change minutes per piece, quantities and wastage; add rows with "+ Add process", "+ Add raw material" or "+ Add WIP"; or fill it with "Copy from another model…".`,
        highlight: "Edit costing",
        check: "The bar at the top shows the live Labour / Materials / Total while you edit.",
      },
      {
        do: `Click "Save".`,
        highlight: "Save",
        then: `The BOM itself is saved (the same save as the BOM page) and "Saved — the BOM page shows the same change." appears. Costing, the BOM page and job card minutes all use the change.`,
      },
    ],
    checkBefore: [
      "The BOM shown is the active one (a yellow note appears if it is costed from a draft).",
      "Materials without a price are fixed before a standard cost is set.",
      "Before saving an edit: the change is a real BOM change, not a what-if.",
    ],
    result: "Viewing changes nothing. Set as standard adds a standard-cost record (audited). Edit costing → Save updates the product's BOM, which changes costing, the BOM page and job card minutes.",
    warnings: [
      "Edit costing saves the real BOM — it affects production job cards, not just this page.",
      "Cost figures are confidential: do not forward them to roles that cannot see this page.",
    ],
    // src/api/routes/product-costing.ts:381-422 — standard is an INSERT only (history kept, no delete route)
    undo: `Wrong BOM edit: "Edit costing" again, put the old values back and "Save" (products update + bom update). A wrong standard cost cannot be deleted; click "Update standard to today" after fixing the BOM to record a new one.`,
    commonMistakes: [
      { mistake: "Thinking the calculator changes the selling price.", fix: "It is a what-if only; set prices through set-selling-price." },
      { mistake: "Setting a standard while materials show No price.", fix: "Add the supplier prices first, otherwise the standard is understated." },
      { mistake: "A Sales user asks why there is no Costing tab.", fix: "Costs are limited to Admin, Finance and R&D by design; ask Finance for the figure." },
    ],
    workedExample: "Finance opens 1003-(K) → Costing: Labour RM 96.40, Raw materials RM 312.10, Total RM 408.50, margin at Price 2 RM 1,080 is 62%. They type 900 in If I sell at (RM) to check a promotion (55%), then click Set as standard.",
    related: ["edit-bom", "set-selling-price", "create-product"],
    nextStep: "If the margin is too low, review the selling price (set-selling-price).",
    contact: "Finance (costing) or R&D lead (BOM minutes / materials)",
    companies: ["ALL"],
    variants: [
      {
        case: "Product whose BOM takes the fabric from the order (fabric tiers)",
        differences: [
          // src/pages/products/costing.tsx — FabricTierCard shown when c.tiers.length > 0
          `A fabric tier card appears; click a level to cost the product at that fabric price. "Set tier prices" changes the tier price bands for EVERY product.`,
          // src/api/routes/product-costing.ts:109-110 — PUT /fabric-tiers needs products:update
          `Saving "Set tier prices" needs products update; each change is kept in the history.`,
        ],
      },
      {
        case: "Product with only a DRAFT BOM",
        differences: [
          // src/pages/products/costing.tsx:276 — draft notice
          `A yellow note says it is costed from a draft BOM; activate the BOM on the BOM page with "Activate".`,
        ],
      },
      {
        case: "Customer-specific prices",
        differences: [
          // src/pages/products/costing.tsx — Price check lists /api/customer-products/by-product rows
          `"Price check" also lists each assigned customer's Price 2 with its margin.`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "set-selling-price",
    title: "Set or change a product's selling price (master price and customer price)",
    keywords: [
      "selling price", "price", "change price", "price 2", "price 1", "customer price", "schedule price change", "price list",
      "售价", "定价", "改价", "价格", "客户价", "调价", "价钱",
      "harga", "harga jualan", "tukar harga", "harga pelanggan",
    ],
    module: "Products & BOM",
    purpose: "Change the master selling price of a SKU (bedframe Price 2 / Price 1, sofa seat-height × tier prices) from a chosen date, or set the price a specific customer pays. Every change is added to the price history; nothing is overwritten.",
    prerequisites: [
      "The product exists.",
      // src/api/routes/customer-products.ts:318-319 (assign) and 436-437 (price) — customer-products:create
      "For a customer price: the customer exists in SALES & CUSTOMERS → Customers, and you hold customer-products create.",
      // src/api/routes/products.ts:457-458 — selling-price fields are stripped for users without product-pricing:read
      "You can see selling prices (product-pricing read); without it the price columns are empty.",
    ],
    who: "Admin or the pricing owner. Needs products update to change master prices and product-pricing read to see them (R&D cannot see selling prices). Customer prices need customer-products create.",
    permission: ["products:update", "product-pricing:read"],
    page: "/products",
    sidebar: "PRODUCTS & BOM → Products",
    steps: [
      {
        do: `Open PRODUCTS & BOM → Products ("SKU Master" view) and filter to the category (Bedframe / Sofa / Accessory) or search the code.`,
        highlight: "SKU Master",
      },
      {
        do: `Master price for one SKU: click the small calendar icon next to the product code (tooltip "Schedule price change").`,
        highlight: "Schedule price change",
        then: `The "Schedule Price Change" dialog opens with the price history below.`,
      },
      {
        do: `Fill the new scheduled change and click "Schedule".`,
        highlight: "Schedule",
        fields: [
          { label: "Effective from *", required: true, value: "Date the price starts, YYYY-MM-DD. Past dates are allowed for back-dating a correction; future dates show Pending until then.", example: "'2026-12-01'" },
          { label: "Notes", required: false, value: "Why the price changed.", example: "'Q1 price hike'" },
          { label: "Price 2 (RM)", required: false, value: "Bedframe / accessory main selling price in RM, 2 decimals. Price 3 is worked out automatically as Price 2 × 1.1.", example: "'1280.00'" },
          { label: "Price 1 (RM)", required: false, value: "Bedframe tier-1 price in RM.", example: "'1180.00'" },
          { label: "Seat-height × fabric tier (RM)", required: false, value: "Sofa only: one cell per seat height × P1 / P2 / P3. Leave a cell blank to keep its previous price.", example: "'24\" P2 = 2100'" },
        ],
        check: "The date is right — sales orders take the price in effect on their date.",
        then: `The change is added to the product's price history. If the date is in the future the row shows "Pending" until that day; otherwise it is the live price.`,
      },
      {
        do: `Several SKUs at once: click "Edit", click each price cell ("Price 2", "Price 1", or a sofa seat column; an empty one shows "Set price") and type the new RM amount, then click "Save".`,
        highlight: "Edit",
        fields: [
          { label: "Effective from *", required: true, value: "One date for all the edited SKUs.", example: "'2026-12-01'" },
          { label: "Notes (optional)", required: false, value: "Shared note for the batch.", example: "'Q3 sofa P2 hike'" },
        ],
        then: `In the save dialog click the "Save" button that shows the number of changes; one price-history row is added per edited SKU.`,
      },
      {
        do: `Customer price: expand the product row (or open the product's "Customers" tab). Under "Customer prices" click "Assign to customer" and pick the customer if they are not listed, then click "Change price" on their row.`,
        highlight: "Change price",
        fields: [
          { label: "New Price 2 (RM)", required: true, value: "Must be above 0.", example: "'1150.00'" },
          { label: "Price 1 (RM, optional)", required: false, value: "Above 0 or left empty.", example: "'1080.00'" },
          { label: "Effective from", required: true, value: "Date picker, defaults to today.", example: "'2026-12-01'" },
          { label: "Reason", required: false, value: "Why this customer's price changed.", example: "'Annual contract'" },
        ],
      },
      {
        do: `Click "Save price".`,
        highlight: "Save price",
        then: "The customer's price history gets the new price from that date (the old price stays until then). The same history shows on the customer page. Sofa seat-height customer prices are changed on the customer page instead.",
      },
    ],
    checkBefore: [
      "The effective date — a back-dated price changes what new orders dated from then would take.",
      "RM amounts, not sen; 2 decimals.",
      "For a customer price, the right customer row.",
    ],
    result: "A new row in the product's (or customer's) price history. From the effective date the Products list, sales order pricing and costing margins use the new price.",
    warnings: [
      "Prices are confidential to roles with product-pricing; R&D cannot see them.",
      "Existing sales orders keep the price they were made with.",
      // src/api/routes/products.ts:1463-1490 and customer-products.ts:473-500 — first future-dated row auto-records today's price as a baseline
      "The first future-dated change for a product (or customer) also records today's price as a history row, so the old price stays traceable.",
    ],
    // src/api/routes/products.ts:1440-1448 and customer-products.ts:455-461 — effectiveFrom must be YYYY-MM-DD; past dates are accepted
    deadlines: "Every price change needs an effective date (YYYY-MM-DD). Past dates are accepted (back-dating); a future date stays Pending until that day. There is no cut-off.",
    // src/api/routes/products.ts:1562-1580 — DELETE /price-row/:id (products:update), any row; customer-products.ts:592-593 (customer-products:delete)
    undo: `Master price: open "Schedule price change" again and either schedule the correct price with the same date, or click "Delete this entry" on the wrong history row (products update). Customer price: click "Change price" again with the correct amount (customer-products create).`,
    approvals: "None in the system — the change takes effect on its date. Follow your company's pricing sign-off before saving.",
    commonMistakes: [
      { mistake: "Changing the price in the costing calculator.", fix: "The calculator saves nothing; use Schedule price change or Edit." },
      { mistake: "Typing a sofa price in Price 2.", fix: "Sofas are priced per seat height × tier in the grid." },
      { mistake: "Expecting today's change to update open sales orders.", fix: "Only new orders pick up the new price." },
    ],
    workedExample: "From 1 Dec the bedframe 1003-(K) goes to RM 1,280: Products → calendar icon on 1003-(K) → Effective from '2026-12-01', Price 2 '1280.00', Notes 'Dec price review' → Schedule. The row shows Pending until 1 Dec. For customer Sunrise Furniture they open Customer prices → Change price → New Price 2 '1150.00' → Save price.",
    related: ["product-costing", "create-product", "create-sales-order"],
    nextStep: "Check the margin at the new price on the Costing tab (product-costing).",
    contact: "Admin / pricing owner (Finance for customer contract prices)",
    companies: ["ALL"],
    variants: [
      {
        case: "Bedframe",
        differences: [
          `Set "Price 2 (RM)" and "Price 1 (RM)"; "Price 3" is worked out automatically as Price 2 × 1.1.`,
        ],
      },
      {
        case: "Sofa (seat height × fabric tier)",
        differences: [
          // src/pages/products/MasterPriceHistoryDialog.tsx — isSofa shows the seat grid instead of Price 2 / Price 1
          `"Schedule Price Change" shows a "Seat-height × fabric tier (RM)" grid (P1 / P2 / P3 per seat height) instead of Price 2 / Price 1; blank cells keep the earlier price.`,
          // src/pages/products/customer-assignments.tsx:247, 360 — Change price hidden when the assignment has seat-height prices
          `Customer seat-height prices cannot be changed under "Customer prices" ("Change price" is hidden); change them on the customer page.`,
        ],
      },
      {
        case: "Accessory",
        differences: [
          `The Products list shows a single "Base Price" column; schedule it as "Price 2 (RM)".`,
        ],
      },
      {
        case: "Per-customer price",
        differences: [
          // src/pages/products/customer-assignments.tsx:151-153 — New Price 2 > 0, Price 1 > 0 or empty, date required
          `Under "Customer prices": "New Price 2 (RM)" must be above 0, "Price 1 (RM, optional)" above 0 or empty, and "Effective from" is required.`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "stock-adjustment",
    title: "Make a stock adjustment (correct on-hand quantity)",
    keywords: [
      "stock adjustment", "adjust stock", "write off", "damaged stock", "found stock", "count correction", "correct quantity",
      "库存调整", "调库存", "调整库存", "报废", "损坏", "盘盈", "盘亏", "改数量",
      "pelarasan stok", "laras stok", "hapus kira", "rosak",
    ],
    module: "Warehouse",
    purpose: "Correct the on-hand quantity of a raw material, WIP item or finished-good batch when the system figure is wrong (found stock, damage, count difference, write-off, service replacement). Each row posts a stock movement and a cost-ledger entry.",
    prerequisites: [
      // src/api/routes/stock-adjustments.ts:260-295 — item looked up by type; 404 if not found
      "The item exists (raw material, WIP item or FG batch).",
      // src/api/routes/stock-adjustments.ts:222-246 — type RM/WIP/FG, item, non-zero qty and a valid reason are required
      "Each row needs a type, an item, a quantity above 0 and a reason; the system refuses anything else.",
      "You know the real quantity difference and the reason; for a count difference, the stock take has been done.",
    ],
    who: "Warehouse supervisor / storekeeper. The page needs stock-movements read; posting needs inventory create.",
    permission: ["inventory:create", "stock-movements:read"],
    page: "/inventory/adjustments",
    sidebar: "WAREHOUSE → Stock Adjustments",
    steps: [
      {
        do: `Open WAREHOUSE → Stock Adjustments. The "New Adjustments" table starts with one blank row; click "Add Row" for more (one row per item).`,
        highlight: "Add Row",
      },
      {
        do: "Fill each row.",
        fields: [
          { label: "Type", required: true, value: "RM (raw material), WIP or FG. Changing it clears the item.", example: "'RM'" },
          { label: "Category", required: false, value: "Narrows the item list by group; All by default.", example: "'PLYWOOD'" },
          { label: "Item", required: true, value: "Pick the item from the list (starts at Select…). On Hand then shows the current system quantity and Unit Cost is pre-filled.", example: "'PLY-18MM'" },
          { label: "Dir", required: true, value: "+ In to add stock, − Out to remove it. Out cannot exceed On Hand.", example: "'− Out'" },
          { label: "Qty", required: true, value: "The difference (not the new total), above 0, up to 3 decimals.", example: "'4'" },
          { label: "Unit Cost", required: false, value: "In sen, pre-filled from the current cost. For raw material Out the system uses its FIFO batch cost instead.", example: "'4550'" },
          { label: "Reason", required: true, value: "Found, Damaged, Count Corr. (default), Write-Off, Service top-up or Other.", example: "'Damaged'" },
          { label: "Notes", required: false, value: "What happened; strongly recommended for audit.", example: "'Water damage at rack B3'" },
        ],
        check: "Impact shows the signed RM value of each ready row; the footer shows how many rows are ready and the net cost impact.",
      },
      {
        do: `Click "Submit All".`,
        highlight: "Submit All",
        check: "Only complete rows (item, qty above 0, reason) are submitted; the button shows how many.",
        then: `Each row posts immediately — there is no approval. The item's quantity changes, a STOCK_IN / STOCK_OUT movement and a cost-ledger entry are written, and a "Posted " message confirms the count. Saved rows leave the table; failed rows stay in red with the reason. The posting appears in "Adjustment History" below.`,
      },
    ],
    checkBefore: [
      "Direction is right (+ In vs − Out) — the most common mistake.",
      "Qty is the difference, not the counted total.",
      "The reason matches what happened (Write-Off and Damaged reduce stock value).",
    ],
    result: "Stock quantity is corrected at once (raw_materials / wip_items / fg_batches), with a stock movement and a cost-ledger entry. Visible in Adjustment History, WAREHOUSE → Inventory and Stock Value.",
    warnings: [
      // src/api/routes/stock-adjustments.ts:22-23 (no approver) and 153/210 (only GET and POST routes exist)
      "Posts immediately and changes stock value in the cost ledger — there is no approval step and no delete.",
      // src/api/routes/stock-adjustments.ts:304-312 — Out larger than on-hand returns 409 "Cannot subtract …"
      "Stock cannot go negative: an Out larger than the quantity on hand is refused.",
      // src/api/routes/stock-adjustments.ts:12-19 — RM Out walks rm_batches FIFO; operator unit cost ignored
      "A raw material Out takes cost from the oldest FIFO batches first; the Unit Cost you type is ignored for RM Out.",
    ],
    // src/api/routes/stock-adjustments.ts:153, 210 — no PUT/DELETE route; a correction is a new POST (inventory:create, line 211)
    undo: "There is no delete or reverse button. Post a new adjustment for the same item and quantity in the opposite direction, with Reason Other and a note naming the wrong posting (needs inventory create). Ask the warehouse supervisor or Finance if the cost needs checking.",
    approvals: "None — the system posts adjustments immediately (owner decision); the adjustment history and audit trail are the control. Get your supervisor's OK before a write-off if your company requires it.",
    commonMistakes: [
      { mistake: "Typing the counted total in Qty.", fix: "Type only the difference between counted and On Hand." },
      { mistake: "Choosing + In when stock was lost.", fix: "Use − Out for anything that left the shelf." },
      { mistake: "Out quantity larger than On Hand.", fix: "The row fails; check the item and On Hand figure first." },
    ],
    workedExample: "Storekeeper finds 4 sheets of plywood PLY-18MM damaged: Stock Adjustments → Type RM, Item PLY-18MM (On Hand 120), Dir − Out, Qty '4', Reason Damaged, Notes 'Water damage at rack B3' → Submit All. On hand becomes 116.",
    related: ["stock-take", "mrp-shortages-to-po", "create-purchase-order"],
    nextStep: "If stock is now short, check MRP for purchase needs (mrp-shortages-to-po).",
    contact: "Warehouse supervisor (Finance for cost questions)",
    companies: ["ALL"],
    variants: [
      {
        case: "Raw material (RM)",
        differences: [
          // src/api/routes/stock-adjustments.ts:12-19, 181-225 — RM In adds a FIFO batch at the typed cost; RM Out consumes oldest batches
          `"+ In" creates a new cost batch at the "Unit Cost" typed (in sen); "− Out" uses the oldest batches' real cost.`,
        ],
      },
      {
        case: "WIP or FG",
        differences: [
          // src/api/routes/stock-adjustments.ts:28-34, 226-235 — WIP/FG honour the operator unit cost; FG adjusts a batch's remaining qty
          `The "Unit Cost" typed is used for the cost entry. For FG the "Item" is a finished-goods batch, and its remaining quantity changes.`,
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "stock-take",
    title: "Do a month-end stock take (stock count)",
    keywords: [
      "stock take", "stock count", "stocktake", "count sheet", "month end count", "physical count", "usage",
      "盘点", "盘点表", "点货", "月底盘点", "库存盘点", "数货",
      "kiraan stok", "ambil stok", "kira stok", "stok akhir bulan",
    ],
    module: "Warehouse",
    purpose: "Count what is physically on the shelf at month end, in quantities only. Download a blank count sheet by type, staff fill it in, import it back for the month, then read usage (last count + purchased − this count). It does not change system stock or post money — Finance values the count in Accounting.",
    prerequisites: [
      "Items exist in the item master (raw materials).",
      "Count staff are assigned to each type / area.",
      // src/api/routes/stock-count.ts:236-237 — PUT /count needs inventory:create; src/pages/inventory/stock-take.tsx:92, 367 hide the import button without it
      "Importing and saving a count needs the inventory create permission; without it the \"Import filled sheet\" button is not shown.",
    ],
    who: "Warehouse supervisor and count staff. Viewing needs inventory read; importing / saving the count needs inventory create.",
    permission: ["inventory:create"],
    page: "/inventory/stock-take",
    sidebar: "WAREHOUSE → Stock Take",
    steps: [
      {
        do: `Open WAREHOUSE → Stock Take and pick the "Month" being counted (top right).`,
        highlight: "Month",
        fields: [
          { label: "Month", required: true, value: "Month picker, YYYY-MM.", example: "'2026-11'" },
        ],
      },
      {
        do: `In "Types" tick the item types to count. "Counted types" re-selects the types Finance counts at month end; "All" ticks everything.`,
        highlight: "Counted types",
      },
      {
        do: `In box 1 click "Download count sheet (Excel)".`,
        highlight: "Download count sheet (Excel)",
        then: "An Excel file downloads with one sheet per type, items grouped by series, and a blank Counted Qty column — no system quantity is printed.",
      },
      {
        do: "Print it and count. Staff write the quantity in the unit shown in the Counted Qty column: 0 when there is none, blank only when not counted. Type the counts back into the Excel file.",
        fields: [
          // src/lib/stock-count.ts:286-287 — item code required (≤100 chars); qty must be a number of 0 or more
          // src/api/routes/stock-count.ts:244 — refused when every quantity is blank
          { label: "Counted Qty", required: true, value: "Quantity on the shelf in the UOM shown, a number of 0 or more (negative or text is refused); 0 = counted none; blank = not counted. At least one item must be counted. Keep the Item Code and Counted Qty headers unchanged.", example: "'37'" },
        ],
      },
      {
        do: `In box 2 click "Import filled sheet" and choose the filled file (.xlsx, .xls or .csv).`,
        highlight: "Import filled sheet",
        check: "Read the preview: items counted, blanks, unit changes, codes not in the item master, duplicates (added up) and rows left out. Fix the file and import again if anything is wrong.",
      },
      {
        do: `Click "Save count for" (the button names the month). If a count is already saved for that month, confirm with "Replace".`,
        highlight: "Save count for",
        then: "The count is saved for the month with your name and time. No stock quantity or ledger changes. Box 3 shows Usage per item, with negative usage and unit questions flagged.",
      },
      {
        do: `Hand over: click "Download for Finance" (the file Accounting's stock take imports) and, if needed, "Export usage (Excel)". Tick "Only rows to check" to review problem rows.`,
        highlight: "Download for Finance",
      },
    ],
    checkBefore: [
      "The Month is the month being closed.",
      "Every counted item has a number (0 if none); blanks mean not counted.",
      "The import preview shows no unexpected unknown codes or unit changes.",
    ],
    result: "The month's counted quantities are saved and the usage table is filled. System stock is NOT changed — differences are corrected separately with stock adjustments, and Finance values the count in Accounting.",
    warnings: [
      // src/api/routes/stock-count.ts:255 — writeKv overwrites the month's record; stock-take.tsx:180-188 confirms "Replace"
      "Saving again for the same month replaces the earlier count completely.",
      // src/api/routes/stock-count.ts:236-263 — only writes the count record (kv) + audit; no stock or ledger tables touched
      "The stock take does not fix system stock; post stock adjustments for real differences.",
    ],
    // src/api/routes/stock-count.ts:241 — ym must be YYYY-MM; any month accepted, no cut-off
    deadlines: "None enforced — a count can be saved or replaced for any month (YYYY-MM).",
    // src/api/routes/stock-count.ts:236-263 — no delete route; re-PUT replaces
    undo: `Import the corrected sheet again for the same month and confirm "Replace" (inventory create). The earlier count is replaced.`,
    commonMistakes: [
      { mistake: "Leaving a zero item blank.", fix: "Write 0 — blank means not counted and is left out." },
      { mistake: "Renaming the Item Code or Counted Qty header.", fix: "Keep the headers; a sheet without them is skipped." },
      { mistake: "Expecting the count to update stock on hand.", fix: "Use Stock Adjustments (Count Corr.) for real differences." },
    ],
    workedExample: "For November 2026 the supervisor ticks the counted types, downloads the count sheet, staff count PLY-18MM as 37 and FOAM-32D as 0, the clerk types the counts in, imports the file, checks the preview and clicks Save count for November → then Download for Finance.",
    related: ["stock-adjustment", "mrp-shortages-to-po"],
    nextStep: "Post stock adjustments for confirmed differences (stock-adjustment).",
    contact: "Warehouse supervisor (Finance for valuation)",
    // Counts are keyed per tenant org + month (stock-count.ts:246, 255 countKey(orgId, ym)), not per company.
    companies: ["ALL"],
    variants: [
      {
        case: "Item counted in a different unit than the item master",
        differences: [
          // src/pages/inventory/stock-take.tsx:411-417 — unit changes listed; saved as written, master unchanged
          `The import preview lists it under "Counted in another unit than the item master"; it is saved as written and marked in the usage — the item master is not changed.`,
        ],
      },
      {
        case: "No warehouse count saved yet but Finance has a priced count",
        differences: [
          // src/pages/inventory/stock-take.tsx:120, 388-391 — usage falls back to the Finance count
          `Box 2 says "No warehouse count saved for" the month and the usage table uses Finance's count until the warehouse saves one.`,
        ],
      },
    ],
  },
];
