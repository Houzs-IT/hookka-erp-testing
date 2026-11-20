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
| 2a | Counts: Employees page TOTAL / PRESENT (department-performance workerCount), dashboard Employees tab + phone (per-day `countsOn`, feed carries joinDate / resignedAt / isOutsource), problem tile, attendance log, Command Center past-month headcount, Finance history headcount, accounting per-head, Board Report (active workers, bands, joined/left incl. INACTIVE), daily efficiency email, employee digest | this PR |
| 2b | Daily Capacity headcount, Floor Live, Command Center live headcount, Attendance tab cards, phone Employees overview | next |
| 3 | Pickers: PIC dropdowns (FE + server check), penalty, leave, advances, working-hours, scheduling, PIN generation, announcements / push / team | next |
| 4 | Data: SOE SHWE Nov / Dec payslips, EMP-039 last day; worker-app lockout after the last day (not on the status change) | needs owner OK for writes |

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
