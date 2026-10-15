# HK-0037 decisions (15 Oct 2026)

> **Last verified: 2026-10-15** against `src/api/routes/inventory.ts`, `raw-materials.ts`, `purchase-orders.ts` and PR #720 (branch `fix/hk0037-rm-uom-propagation`).
1. Selection of RM UOM is already delivered by DEV-20 (#720). Scope = propagation gaps only. [phase1-map.md]
2. Do NOT restore per-category lists (owner removed them 2026-10-07) and do NOT build ROLL/MTR conversion (owner ruling 2026-09-29, out of scope). Both go to the owner as one question.
3. Build the four safe fixes: (1) allowed-UOM check on inventory.ts RM create, (2) stock adjust shows RM baseUOM not "ea", (3) PO create/update takes unit from the RM server-side, (4) GRN shows RM baseUOM next to received qty. No schema change.
4. ask-matt skipped: user-invocable only (subagent refused).
5. Target branch: main (fix to existing behaviour, small, no schema).
