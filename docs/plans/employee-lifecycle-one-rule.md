# Employee onboarding / offboarding — one rule across the system

Owner 2026-11-21: 「create 了 new joiner 该有的东西全部都要有 … 进出进出都会有变动
包括我的 dashboard … 只要有员工的地方就会变动」. The owner approved the 7 points below.

## The rule (`src/lib/employment.ts`)

A worker is **employed on day D** when:
- they are not a test account (empNo `TEST*`);
- `joinDate` is empty or on/before D; and
- they have not left before D. RESIGNED or INACTIVE counts up to and including `resignedAt` (the last working day). A leaver with no last day counts as gone.

`employedOn(w, day)` / `employedDuring(w, from, to)` cover the FE and plain TS. `employedOnSql` / `employedDuringSql` (with their `*Params`) cover server queries. Outsource is decided by the `isOutsource` flag only (`isOutsourceWorkerFlag`).

## The 7 approved points

1. One rule everywhere (above). A past month counts the people employed then, not today's status.
2. INACTIVE needs a last working day, the same as RESIGNED. EMP-039 gets one (data fix, shown to the owner first).
3. Present X / Y: Y = people employed in the period, X = those of them with attendance. X can never exceed Y, on desktop or phone.
4. New joiners reach payroll on their own. Months already generated and not approved get their payslip; nobody else is touched.
5. The join date typed on the create form is recorded (it used to be overwritten with today).
6. Outsource uses the flag. Every picker (PIC, penalty, leave, advances, hours, scheduling, PIN) lists people employed today; test accounts never appear.
7. Existing data: SOE SHWE added to Nov / Dec payroll; test accounts out of every count. Production writes are shown to the owner first.

## Batches

| Batch | Scope | Status |
|---|---|---|
| 1 | Shared rule; payroll onboarding/offboarding sync (`src/api/lib/worker-payroll-sync.ts`, `generatePayslipsForPeriod(..., { onlyWorkerIds })`); INACTIVE = leaver with a last day (API + drawer); join date honoured; INACTIVE paid its last month; test accounts out of hour docks | DONE (#1528, live 2026-11-21) |
| 2a | Counts: Employees page TOTAL / PRESENT (department-performance workerCount), dashboard Employees tab + phone (per-day `countsOn`, feed carries joinDate / resignedAt / isOutsource), problem tile, attendance log, Command Center past-month headcount, Finance history headcount, accounting per-head, Board Report (active workers, bands, joined/left incl. INACTIVE), daily efficiency email, employee digest | DONE (#1529, live 2026-11-21) |
| 2b | Daily Capacity headcount (outsource = flag, TEST out), Floor Live (TEST out), Command Center live headcount, Attendance tab month cards, phone Employees overview; dashboard feed snapshot v13 so the new fields show at once | DONE (#1530, live 2026-11-21) |
| 3 | Pickers via `isPickableWorker` (src/lib/worker.ts): PIC dropdowns (production page, scan, FG scan, folder batch PIC), penalty, new leave, advances, working-hours reassign; server rosters on today's rule: leave balances, push audience, leader team, announcement acks, PIN bulk generation, scheduling | this PR |
| 4 | Data: SOE SHWE Nov / Dec payslips (DONE 2026-11-21, owner OK: PS-2611-041 RM 814.74 = 10 days after joining 11-20 + 2h OT, PS-2612 RM 2,050.00; both DRAFT; no EPF/SOCSO confirmed correct by owner). EMP-039 last day: NOT written: EMP-039 is a duplicate record of EMP-038 WANNA HLAING (same join date, EMP-038 already RESIGNED 2026-10-07 and holds the Jul–Oct payslips); dating EMP-039 would have made the sync add a second Oct payslip, so EMP-039 stays INACTIVE with no date (counted nowhere). Worker-app lockout after the last day: open, not yet assigned. | data done; lockout open |

## The 45 places (research, 2026-11-21)

The full table (file:line, current rule, joiner / leaver / TEST handling) is in the session record. The groups are:
- status-only (today's status used for past periods);
- ACTIVE-only (counts TEST accounts);
- "anyone with data" (PRESENT, efficiency, Floor Live, capacity);
- date-aware (payroll family, Finance history, Command Center past month, Board Report joined/left);
- no filter at all (PIC dropdowns, Reports page, accounting per-head).

Batches 2–3 move each of them onto the rule above.

## Payroll sync — how it behaves

`syncWorkerPayroll(c, workerId, { fromPeriod, recomputePeriod })` runs after:
- create (from the join month);
- a join-date change (from the earlier of the old and new month);
- a new last day, or a return to ACTIVE (from that month, recomputing it);
- soft delete (INACTIVE; last day = the one on record or today).

In each month that already has payslips, from `fromPeriod` on:
- employed and no payslip → add one;
- employed and the recompute month → replace the DRAFT;
- not employed → delete the DRAFT.

Approved payslips are never touched. Months not generated yet pick the worker up on their own run.

## Live check 2026-11-21 (read-only, after #1531 / #1532)

Employed today 40 of 55 records (excluded: 11 RESIGNED, 2 INACTIVE, 4 TEST). Dashboard countsToHeadcount 40; leave balances 40 rows (endpoint was 500ing on a non-existent workers.org_id, fixed in #1532, BUG-2026-11-21-002); Nov payroll 41 = employed-during-Nov 41, Dec 40 = 40, no missing / extra; Floor Live 34 = today's 34 punches, all employed, new joiner included. UNTESTED live: the automatic payslip on a brand-new hire (SOE SHWE predates #1528, his were added by hand); check on the next real hire.
