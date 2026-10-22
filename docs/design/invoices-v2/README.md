# Hookka ERP — Mobile Invoices v2 · Two-tab update handoff (Invoices + AR Aging)

Design reference only. HTML prototype with illustrative sample data, not connected to any API.
Repo: `hookkadev/hookka-erp-testing` @ `staging`. Implementation branch (Claude Code, uncommitted): `design/mobile-invoicesv2`.

---

## 1. Files

| File | Role |
|---|---|
| `Invoices v2.dc.html` | **FINAL visual source of truth.** Two tabs: Invoices + AR Aging, incl. AR Aging customer sheet. |
| `Invoices v2 six-tab reference.dc.html` | **Archived.** Previous six-tab design. Keep ONLY as a visual reference for possible future Finance screens (Payments, Supplier Pay, Credit Notes, Debit Notes, e-Invoice). Not for this update. |
| `support.js`, `lucide-icon.js` | Runtime needed to open the HTML in a browser. |

Open `Invoices v2.dc.html` directly in a browser. In the Tweaks/state, the switch bar flips between the two tabs.

---

## 2. Design differences vs the six-tab version

### 2.1 Switch bar (changed)
- Six underline tabs → **two-option segmented switch**: `Invoices` (lucide `List`) · `AR Aging` (lucide `BarChart3`). Same icons as desktop `src/pages/invoices/index.tsx` tab buttons.
- Hookka standard switch bar (same as Delivery):
  - Wrapper: `padding:2px 18px 10px` inside the sticky header · track `display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:4px; height:46px; padding:4px; border-radius:14px; background:#F0ECE9`
  - Button: `height:100%; border-radius:10px; border:none; font-size:13px; white-space:nowrap; display:flex; align-items:center; justify-content:center; gap:7px`, 15px icon, stroke 1.9
  - Active: bg `#FFFFFF`, text `#1F1D1B`, weight 700, shadow `0 1px 2px rgba(31,29,27,.08), 0 6px 14px -6px rgba(31,29,27,.20)`
  - Inactive: transparent, text `#4D4630`, weight 600, no shadow
- Use the existing shared switch-bar component if the branch already has one. Don't build a second one.

### 2.2 Switching behaviour
- Switching tab resets the search text and the status chip to **All**.
- Status chips + invoice summary card show **only on Invoices**.
- Search placeholder: Invoices → `Search invoice, customer, DO, SO` · AR Aging → `Filter by customer`.
- AR Aging data is fetched **only when the AR Aging tab is active** (same as desktop).

### 2.3 Invoices tab: UNCHANGED
List, search, status chips (All · Draft · Sent · Partial Paid · Paid · Overdue · Cancelled, with counts), summary card (Invoiced total, Outstanding, tappable Overdue tile), invoice cards and everything in the already-built implementation stay as they are.

### 2.4 Invoice Detail: UNCHANGED
Full dedicated detail, PDF View/Download, payment history, Record Payment, related documents, credit/debit adjustments, line items, files, Edit, QR, tablet split view: no visual change in this update.

### 2.5 Removed from the Invoices navigation
Payments · Supplier Pay · Credit Notes · Debit Notes · e-Invoice. See §5.

### 2.6 AR Aging (new)
Order on screen:
1. **Summary card** (white, radius 20, standard card shadow)
   - Eyebrow `AR AGING` with 14×3 gold bar `#C9A961`; right side `N customers`.
   - `RM` + total (28px/700, tabular) · caption `Total outstanding`.
   - Bucket bar, 10px, radius 999, segments only for non-zero buckets, flex = amount (display only).
   - Four full-width rows (min-height 40, divider `#EDE7DD`): 8px dot · label · amount right-aligned (min-width 96px, 13.5px/700). Zero → `–` in `#6B6252`.
2. **Count label** `N CUSTOMERS` (11px/700, letter-spacing 1px, `#6B5C32`).
3. **Customer cards** (compact, white, radius 16, 4px left rail): the whole card is a button.
   - Name 15px/700, max 2 lines (`-webkit-line-clamp:2`, `word-break:break-word`) + chevron.
   - Row: pill for the oldest non-zero bucket (`Current (0-30)` or `Oldest · 31-60 Days` etc.) · total outstanding right-aligned, nowrap.
   - 6px bucket bar.
   - Rail colour = oldest non-zero bucket colour.
4. **Customer sheet** (bottom sheet, opens on tap): drag handle · eyebrow `AR AGING` · customer name (wraps fully) · ✕ (44px). White card: `TOTAL OUTSTANDING`, `RM` + amount 26px · 8px bar · **all four buckets** as 44px rows (dot · label · amount, `–` when zero). Note: "Buckets come from the server aging report. Open invoices for this customer are on the Invoices tab." Closes on ✕, scrim tap, Esc.
5. Footer note (prototype only): "Buckets come from the server aging report · sample data". **Do not ship this line.**

Bucket tokens:

| Key | Label | Colour | Tint (pill/bg) |
|---|---|---|---|
| `current` | Current (0-30) | `#4F7C3A` | `#EEF3E4` |
| `days31_60` | 31-60 Days | `#9C6F1E` (pill text `#85600F`) | `#FAEFCB` |
| `days61_90` | 61-90 Days | `#B8601A` | `#FBE9DA` |
| `days90plus` | 90+ Days | `#9A3A2D` | `#F9E1DA` |

### 2.7 Phone / tablet / dark
- Phone 390px: every amount sits on its own full-width row and is never truncated. Test up to `RM 9,999,999.99`.
- Tablet: keep the existing split-view pattern. Showing the customer breakdown in the right pane instead of a sheet is **optional / to be agreed**, not required by this design.
- Dark mode: map every colour above to the existing dark tokens in the branch. Bucket colours need dark-mode equivalents with ≥4.5:1 text contrast. Verify; the prototype is light only.

---

## 3. AR Aging: implementation specification

### A. Confirmed from desktop frontend (`src/pages/invoices/index.tsx`)
- Tabs: `activeTab: "list" | "aging"`, labels `Invoices` / `AR Aging`.
- Fetch: `GET /api/invoices/aging`, with the page filter query string when set (`status`, `customerId`, `from`, `to`); **only when the aging tab is active**.
- Response used: `{ success?: boolean; data?: AgingRow[] }`. Rows are used only if `success && Array.isArray(data)`, else `[]`.
- `AgingRow = { customerName: string; current: number; days31_60: number; days61_90: number; days90plus: number; total: number }`
- Buckets are **computed server-side** over the whole table (comment: 2026-07-14 bug fix). The frontend does not bucket invoices.
- Column totals = frontend sum of each field across returned rows (`agingTotals`).
- Desktop labels: title `Accounts Receivable Aging Report`; columns `Customer`, `Current (0-30)`, `31-60 Days`, `61-90 Days`, `90+ Days`, `Total Outstanding`; footer `TOTAL`.
- Desktop colours: `#4F7C3A`, `#9C6F1E`, `#B8601A`, `#9A3A2D`; zero values shown as `-`.
- Empty: `No outstanding invoices found.`
- Rows are not clickable on desktop. Order = API order (no client sort).
- Money via `formatCurrency(...)`.
- Route permission: `/invoices` requires `invoices:read` (`src/dashboard-routes.tsx`, `RequirePermission resource="invoices" action="read"`).

### B. Proposed mobile behaviour (design decisions, not desktop features)
- Summary card bucket rows and bucket bar (the bar is proportional display only, not a new metric).
- Customer count (`rows.length`).
- Compact customer card, "Oldest · …" pill and rail colour from the oldest non-zero bucket.
- Tappable card → customer sheet showing that row's own fields.
- **Customer-name search** filters the loaded rows client-side. Desktop uses a customer dropdown (`customerId` param); search is a mobile proposal.
- Status chips do **not** apply to AR Aging on mobile. Desktop passes the list's status/date filters to aging; mobile intentionally does not. Confirm.
- Loading: skeleton for summary + 3 cards. Error: an error card with retry. **Do not show "No outstanding invoices found." on a failed request.** Desktop currently does, which hides errors.
- Permission denied: tab hidden without `invoices:read` (the branch already has permission-aware tabs).

### C. Sample data (prototype only, never hardcode)
Three `AGING` rows (Mewah Home Living, Kian Furniture Gallery, Desa Interior) and their amounts. They were set to equal the sample invoices' outstanding balances. Kian's 31-60 placement is illustrative.

### D. Unknown backend behaviour: verify before implementing
1. **Units**: are bucket fields **sen or RM**? Desktop passes them straight to `formatCurrency`. Check the endpoint and `formatCurrency` before formatting.
2. Ageing basis: from invoice date or due date.
3. Which statuses are included (DRAFT? CANCELLED? partially paid → remaining balance?).
4. Whether credit notes / payments reduce bucket amounts.
5. Whether `customerName` is unique (desktop keys rows by it) or a `customerId` exists in the response.
6. Response size / pagination.
7. **Not the same as `/api/accounting/aging`** (mobile Receivables module, `accounting:read` gate). Do not reuse or merge them.

---

## 4. Preserve (functionality, not old UI)
Keep all existing behaviour: invoice list and invoice-specific logic, dedicated Invoice Detail, PDF View/Download, Record Payment with its status and `invoices:update` checks, payment history, credit/debit adjustments in detail, related documents, Edit, QR, attachments, line-item navigation, tablet split view, existing API calls, permissions, responsive fixes and the 29 passing tests.

**Preserving functionality does NOT mean preserving outdated UI.** Where the approved two-tab HTML changes the UI (the switch bar, the removed tabs, AR Aging), the HTML wins.

---

## 5. Removing five tabs from the Invoices navigation
Payments, Supplier Pay, Credit Notes, Debit Notes and e-Invoice are **real ERP features**. Remove them from the **Invoices v2 tab bar only**. Do not delete backend endpoints, source definitions or business logic.

| Area | Implication |
|---|---|
| Mobile routes | `/m/invoices` lists come from `invoicesConfig.sources` in `src/pages/m/config/modules.ts` (invoices, payments, supplierPay, creditNotes, debitNotes, eInvoice). Hide the five in the v2 UI. Do **not** delete the source definitions in this update. |
| Global search | The module configs also feed mobile routing/search (stated in the procurement section comment in `modules.ts`). **Verify** whether search uses these sources. If removing them from config would drop results, keep them in config. |
| Deep links | Any link or state that opens one of the five sub-tabs must fall back to the Invoices tab, never a blank screen. Check how the sub-tab is encoded in the URL in the branch. |
| Permissions | Desktop gates all six `/invoices/*` routes with `invoices:read`. Nothing changes. AR Aging tab also requires `invoices:read`. Remove the per-tab permission logic only for the tabs that no longer exist. |
| Access elsewhere | Desktop: Credit Notes / Debit Notes under Finance → Debtors, e-Invoice under Finance (`src/components/layout/sidebar.tsx`). Payments and Supplier Payments are retired from the desktop menu but their routes still work. On mobile, these five will have **no entry point** after this update. Accepted; their future placement is a separate decision. Invoice Detail still shows that invoice's payments and adjustments. |
| Tests & config | Update tests that assert six tabs to assert two. Keep tests for anything still in config. Add AR Aging tests (§6). Do not remove unrelated tests. |

---

## 6. Implementation delta

React paths below are confirmed on `staging`. Paths created by Claude Code on `design/mobile-invoicesv2` are not known here; locate them in the working tree.

| Area | Current | Required change | Preserve | Risks / dependencies |
|---|---|---|---|---|
| Invoices v2 screen tab bar (branch component) | Six permission-aware tabs | Two-option segmented switch: Invoices / AR Aging, standard styling, icons List / BarChart3 | Permission-aware behaviour | Deep-link fallback for old sub-tabs |
| Tab content switch (branch) | Renders six lists | Render Invoices list or AR Aging only | Invoices list unchanged | Hidden status chips/summary on AR Aging |
| `src/pages/m/config/modules.ts` → `invoicesConfig` | `sources: [invoices, payments, supplierPay, creditNotes, debitNotes, eInvoice]` | **No change required** unless the v2 tab bar is driven directly by `sources`. Then filter in the UI, don't delete. | Source definitions | Global search, other consumers |
| AR Aging view (new, branch) | Not present on mobile | Fetch `GET /api/invoices/aging` when active; type `AgingRow`; summary card, list, empty/loading/error states | — | Units (sen vs RM), field names, filters |
| AR Aging customer sheet (new, branch) | — | Bottom sheet from row tap. Reuse the branch's existing bottom-sheet component. | — | Keyed by `customerName` unless an id exists |
| Search (branch) | Invoice search | Per-tab placeholder; AR Aging = client-side customer-name filter (proposed) | Invoice search behaviour | Debounce; reset on tab switch |
| Invoice Detail, PDF, Record Payment, split view (branch) | Done | **No change** | Everything | Don't regress `invoices:update` checks |
| Dark mode tokens (branch) | Done | Add tokens for 4 bucket colours + tints | Existing tokens | Contrast |
| Receivables (`receivablesConfig` in `modules.ts`, `/api/accounting/aging`) | Separate module | **No change** | — | Don't merge with AR Aging |
| Tests (branch) | 29/29 passing | Update six-tab assertions → two; add AR Aging tests | All other tests | — |

AR Aging tests to add: tab visible only with `invoices:read` · fetch only when tab active · renders bucket labels exactly · zero → `–` · totals equal the sum of rows · long name wraps to 2 lines with no overflow at 390px · large amount (`RM 9,999,999.99`) not truncated · empty vs error states distinct · sheet opens/closes (✕, scrim, Esc) · switching tabs resets search · old sub-tab deep link falls back to Invoices.

---

## 7. Do not
- Hardcode the prototype's sample rows or amounts.
- Calculate aging buckets on the client.
- Use `/api/accounting/aging` for this tab.
- Delete backend endpoints or the five source definitions.
- Commit, push, merge or deploy without approval.
