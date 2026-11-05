// payslip-generate-all-or-nothing.test.mjs
//
// BUG-2026-11-05: October 2026 payroll saved 27 of 39 payslips and stopped when
// the request was cut off, then was approved with 12 workers missing. Generate
// must save a whole period or nothing, and approve must refuse a period that is
// missing an eligible worker's payslip.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Hono } from "hono";

try {
  register("tsx/esm", pathToFileURL("./"));
} catch {
  // Native type stripping handles the .ts import.
}

const PERIOD = "2026-10";

function makeWorker(id, empNo, overrides = {}) {
  return {
    id,
    empNo,
    name: `Worker ${empNo}`,
    departmentCode: "FOAM",
    status: "ACTIVE",
    basicSalarySen: 205000,
    workingDaysPerMonth: 26,
    workingHoursPerDay: 9,
    otMultiplier: 1.5,
    epfEnabled: false,
    socsoEnabled: false,
    eisEnabled: false,
    pcbEnabled: false,
    resignedAt: null,
    joinDate: "2026-06-24",
    payMode: "MONTHLY",
    dailyRateSen: 0,
    ...overrides,
  };
}

function makeDatabase({ workers, payslips = [], failOnInsertNumber = 0 }) {
  const state = { payslips: payslips.map((row) => ({ ...row })), insertAttempts: 0 };

  function applyStatement(target, sqlText, boundValues) {
    if (/^INSERT OR IGNORE INTO payslips/i.test(sqlText)) {
      state.insertAttempts += 1;
      if (state.insertAttempts === failOnInsertNumber) {
        throw new Error("connection lost while saving a payslip");
      }
      const [id, employeeId, employeeName, employeeNo, departmentCode, period] = boundValues;
      if (!target.some((row) => row.id === id)) {
        target.push({ id, employeeId, employeeName, employeeNo, departmentCode, period, status: "DRAFT" });
      }
      return { changes: 1 };
    }
    if (/^DELETE FROM payslips WHERE period = \? AND status = 'DRAFT'/i.test(sqlText)) {
      const kept = target.filter((row) => !(row.period === boundValues[0] && row.status === "DRAFT"));
      target.splice(0, target.length, ...kept);
      return { changes: 0 };
    }
    if (/^UPDATE payslips\s+SET status = \?/i.test(sqlText)) {
      for (const row of target) if (row.period === boundValues[1]) row.status = boundValues[0];
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  function eligibleWorkers(resignedPattern) {
    const resignedPrefix = String(resignedPattern).replace("%", "");
    return workers.filter(
      (worker) =>
        (worker.status === "ACTIVE" ||
          (worker.status === "RESIGNED" && String(worker.resignedAt ?? "").startsWith(resignedPrefix))) &&
        !worker.empNo.startsWith("TEST"),
    );
  }

  function rowsFor(target, sqlText, boundValues) {
    if (/FROM workers WHERE \(status = 'ACTIVE' OR \(status = 'RESIGNED' AND resignedAt LIKE \?\)\) AND empNo NOT LIKE 'TEST%'/.test(sqlText)) {
      return eligibleWorkers(boundValues[0]);
    }
    if (/FROM workers WHERE .*id NOT IN \(SELECT employeeId FROM payslips WHERE period = \?\)/.test(sqlText)) {
      const [resignedPattern, periodLastDay, period] = boundValues;
      return eligibleWorkers(resignedPattern).filter(
        (worker) =>
          (worker.joinDate === null || worker.joinDate <= periodLastDay) &&
          !target.some((row) => row.employeeId === worker.id && row.period === period),
      );
    }
    if (/^SELECT \* FROM payslips WHERE period = \?/i.test(sqlText)) {
      return target.filter((row) => row.period === boundValues[0]);
    }
    return [];
  }

  function firstRowFor(target, sqlText, boundValues) {
    if (/SELECT COUNT\(\*\) AS c FROM payslips WHERE period = \? AND status != 'DRAFT'/i.test(sqlText)) {
      return { c: target.filter((row) => row.period === boundValues[0] && row.status !== "DRAFT").length };
    }
    if (/SELECT COUNT\(\*\) AS c FROM payslips WHERE period = \?/i.test(sqlText)) {
      return { c: target.filter((row) => row.period === boundValues[0]).length };
    }
    if (/^SELECT id FROM payslips WHERE id LIKE \? ORDER BY id DESC LIMIT 1/i.test(sqlText)) {
      const idPrefix = String(boundValues[0]).replace("%", "");
      const matchingIds = target.map((row) => row.id).filter((id) => id.startsWith(idPrefix)).sort();
      return matchingIds.length > 0 ? { id: matchingIds[matchingIds.length - 1] } : null;
    }
    if (/^SELECT \* FROM payslips WHERE id = \?/i.test(sqlText)) {
      return target.find((row) => row.id === boundValues[0]) ?? null;
    }
    return null;
  }

  function prepare(sqlText) {
    const trimmedSql = sqlText.trim();
    let boundValues = [];
    const statement = {
      sqlText: trimmedSql,
      get boundValues() {
        return boundValues;
      },
      bind(...values) {
        boundValues = values;
        return statement;
      },
      async first() {
        return firstRowFor(state.payslips, trimmedSql, boundValues);
      },
      async all() {
        return { results: rowsFor(state.payslips, trimmedSql, boundValues) };
      },
      async run() {
        return { success: true, meta: applyStatement(state.payslips, trimmedSql, boundValues) };
      },
    };
    return statement;
  }

  async function batch(statements) {
    const workingCopy = state.payslips.map((row) => ({ ...row }));
    const results = statements.map((statement) => {
      const meta = applyStatement(workingCopy, statement.sqlText, statement.boundValues);
      return { success: true, meta, results: rowsFor(workingCopy, statement.sqlText, statement.boundValues) };
    });
    state.payslips = workingCopy;
    return results;
  }

  return { state, database: { prepare, batch, exec: async () => ({}) } };
}

async function mountPayslipsApp(database) {
  const { default: payslipsApp } = await import(
    pathToFileURL(resolve(process.cwd(), "src/api/routes/payslips.ts")).href
  );
  const parent = new Hono();
  parent.use("*", async (context, next) => {
    context.set("DB", database);
    context.set("userRole", "SUPER_ADMIN");
    context.set("userId", "user-test");
    await next();
  });
  parent.route("/", payslipsApp);
  return parent;
}

function sendJson(app, method, body) {
  return app.request("/", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("generateSavesNoPayslipsWhenOneSaveFailsPartWay", async () => {
  const workers = [makeWorker("w1", "EMP-001"), makeWorker("w2", "EMP-002"), makeWorker("w3", "EMP-003")];
  const { state, database } = makeDatabase({ workers, failOnInsertNumber: 3 });
  const app = await mountPayslipsApp(database);

  const response = await sendJson(app, "POST", { period: PERIOD });

  assert.equal(response.status, 500);
  assert.deepEqual(
    state.payslips.filter((row) => row.period === PERIOD).map((row) => row.employeeNo),
    [],
    "a failed generate must not leave part of the month saved",
  );
});

test("generateSavesEveryEligibleWorkerWithSequentialIds", async () => {
  const workers = [makeWorker("w1", "EMP-001"), makeWorker("w2", "EMP-002"), makeWorker("w3", "EMP-003")];
  const { state, database } = makeDatabase({ workers });
  const app = await mountPayslipsApp(database);

  const response = await sendJson(app, "POST", { period: PERIOD });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.total, 3);
  assert.deepEqual(
    state.payslips.map((row) => row.id),
    ["PS-2610-001", "PS-2610-002", "PS-2610-003"],
  );
});

test("regenerateKeepsTheOldDraftsWhenOneSaveFailsPartWay", async () => {
  const workers = [makeWorker("w1", "EMP-001"), makeWorker("w2", "EMP-002")];
  const payslips = [
    { id: "PS-2610-001", employeeId: "w1", employeeNo: "EMP-001", period: PERIOD, status: "DRAFT" },
    { id: "PS-2610-002", employeeId: "w2", employeeNo: "EMP-002", period: PERIOD, status: "DRAFT" },
  ];
  const { state, database } = makeDatabase({ workers, payslips, failOnInsertNumber: 2 });
  const app = await mountPayslipsApp(database);

  const response = await sendJson(app, "POST", { period: PERIOD, regenerate: true });

  assert.equal(response.status, 500);
  assert.deepEqual(state.payslips.map((row) => row.id), ["PS-2610-001", "PS-2610-002"]);
});

test("approveRefusesPeriodMissingAnEligibleWorkersPayslip", async () => {
  const workers = [
    makeWorker("w1", "EMP-001"),
    makeWorker("w2", "EMP-038", { status: "RESIGNED", resignedAt: "2026-10-07" }),
    makeWorker("w3", "EMP-050", { joinDate: "2026-11-02" }),
  ];
  const payslips = [{ id: "PS-2610-001", employeeId: "w1", employeeNo: "EMP-001", period: PERIOD, status: "DRAFT" }];
  const { state, database } = makeDatabase({ workers, payslips });
  const app = await mountPayslipsApp(database);

  const response = await sendJson(app, "PUT", { period: PERIOD, status: "APPROVED" });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(body.missingPayslips.map((worker) => worker.empNo), ["EMP-038"]);
  assert.equal(state.payslips[0].status, "DRAFT", "nothing is approved while a payslip is missing");
});

test("approveProceedsWhenEveryEligibleWorkerHasAPayslip", async () => {
  const workers = [makeWorker("w1", "EMP-001")];
  const payslips = [{ id: "PS-2610-001", employeeId: "w1", employeeNo: "EMP-001", period: PERIOD, status: "DRAFT" }];
  const { state, database } = makeDatabase({ workers, payslips });
  const app = await mountPayslipsApp(database);

  const response = await sendJson(app, "PUT", { period: PERIOD, status: "APPROVED" });

  assert.equal(response.status, 200);
  assert.equal(state.payslips[0].status, "APPROVED");
});
