import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../worker";
import { requirePermission } from "../lib/rbac";
import { DEFAULT_ORG_ID, getOrgId, tryGetOrgId } from "../lib/tenant";
import { emitAudit } from "../lib/audit";
import { resolveWorkerToken } from "./worker-auth";
import { capList } from "../lib/list-cap";
import { resolveIssueTarget } from "../lib/outsource-targets";
import {
  ISSUE_LIST_CAP,
  issueItem,
  listIssues,
  listOutsourceWorkers,
  listWorkerIssues,
  loadDepartmentNames,
  loadOutsourceWorker,
  undoIssue,
} from "../lib/outsource-issue";
import type { IssueStatus } from "../lib/outsource-issue";

const RESOURCE = "outsource-issues";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const admin = new Hono<Env>();

function contextValue(c: Context<Env>, key: string): string {
  return (c as unknown as { get: (key: string) => string | undefined }).get(key) ?? "";
}

async function issuerName(c: Context<Env>): Promise<string> {
  const userId = contextValue(c, "userId");
  if (!userId) return "";
  const user = await c.var.DB
    .prepare("SELECT displayName FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ displayName: string | null }>();
  return user?.displayName || userId;
}

async function departmentLabels(c: Context<Env>, codes: readonly string[], joiner: string): Promise<string> {
  const names = await loadDepartmentNames(c.var.DB);
  return codes.map((code) => names.get(code) || code).join(joiner);
}

admin.get("/workers", async (c) => {
  const denied = await requirePermission(c, RESOURCE, "read");
  if (denied) return denied;
  const workers = await listOutsourceWorkers(c.var.DB, getOrgId(c));
  return c.json({ success: true, data: workers });
});

admin.get("/", async (c) => {
  const denied = await requirePermission(c, RESOURCE, "read");
  if (denied) return denied;
  const statusParam = (c.req.query("status") ?? "").toUpperCase();
  const status: IssueStatus | undefined =
    statusParam === "INCOMPLETE" || statusParam === "COMPLETED" ? statusParam : undefined;
  const fromDate = c.req.query("from") ?? "";
  const toDate = c.req.query("to") ?? "";
  if ((fromDate && !DATE_PATTERN.test(fromDate)) || (toDate && !DATE_PATTERN.test(toDate))) {
    return c.json({ success: false, error: "from and to must be YYYY-MM-DD" }, 400);
  }
  const rows = await listIssues(c.var.DB, {
    orgId: getOrgId(c),
    filter: {
      workerId: c.req.query("workerId") || undefined,
      status,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: c.req.query("q") || undefined,
    },
  });
  return c.json({ success: true, data: capList(c, rows, ISSUE_LIST_CAP) });
});

admin.post("/", async (c) => {
  const denied = await requirePermission(c, RESOURCE, "create");
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { workerId?: unknown; qr?: unknown };
  const workerId = typeof body.workerId === "string" ? body.workerId.trim() : "";
  const qr = typeof body.qr === "string" ? body.qr.trim() : "";
  if (!workerId || !qr) {
    return c.json({ success: false, error: "workerId and qr are required" }, 400);
  }
  const worker = await loadOutsourceWorker(c.var.DB, workerId);
  if (!worker) {
    return c.json(
      {
        success: false,
        code: "NOT_OUTSOURCE_WORKER",
        error: "Pick an active outsourced worker.",
      },
      400,
    );
  }

  const lookup = await resolveIssueTarget(c.var.DB, { qr, departmentCodes: worker.departmentCodes });
  if (lookup.kind === "no-worker-department") {
    return c.json(
      {
        success: false,
        code: "NO_WORKER_DEPARTMENT",
        error: "This worker has no department. Set it in HR first.",
      },
      400,
    );
  }
  if (lookup.kind === "not-a-sticker") {
    return c.json(
      { success: false, code: "NOT_A_STICKER", error: "This is not a production item sticker." },
      400,
    );
  }
  if (lookup.kind === "order-not-found") {
    return c.json(
      { success: false, code: "ORDER_NOT_FOUND", error: "No production order matches this sticker." },
      404,
    );
  }
  if (lookup.kind === "no-card-for-department") {
    return c.json(
      {
        success: false,
        code: "NO_CARD_FOR_DEPARTMENT",
        error: `This order has no ${await departmentLabels(c, lookup.departmentCodes, " or ")} job card for this sticker.`,
      },
      404,
    );
  }
  if (lookup.kind === "ambiguous-department") {
    return c.json(
      {
        success: false,
        code: "AMBIGUOUS_DEPARTMENT",
        error: `This worker is in ${await departmentLabels(c, lookup.departments, " and ")} and more than one can take this item. Fix the worker's departments in HR.`,
      },
      409,
    );
  }

  const outcome = await issueItem(c.var.DB, {
    orgId: getOrgId(c),
    worker,
    lookup,
    qrRaw: qr,
    issuedBy: await issuerName(c),
  });
  if (outcome.kind === "already-done") {
    return c.json(
      {
        success: false,
        code: "ALREADY_DONE",
        error: "This department's work is already done for this item.",
      },
      409,
    );
  }
  if (outcome.kind === "already-issued") {
    return c.json(
      {
        success: false,
        code: "ALREADY_ISSUED",
        error: `Already issued to ${outcome.issue.workerName || outcome.issue.workerId}.`,
        data: outcome.issue,
      },
      409,
    );
  }
  await emitAudit(c, {
    resource: RESOURCE,
    resourceId: outcome.issue.id,
    action: "create",
    after: outcome.issue,
  });
  return c.json({ success: true, data: outcome.issue }, 201);
});

admin.delete("/:id", async (c) => {
  const denied = await requirePermission(c, RESOURCE, "delete");
  if (denied) return denied;
  const outcome = await undoIssue(c.var.DB, { orgId: getOrgId(c), id: c.req.param("id") });
  if (outcome.kind === "not-found") {
    return c.json({ success: false, error: "Issue not found" }, 404);
  }
  if (outcome.kind === "already-completed") {
    return c.json(
      {
        success: false,
        code: "ALREADY_COMPLETED",
        error: "This item is already completed and cannot be undone.",
        data: outcome.issue,
      },
      409,
    );
  }
  await emitAudit(c, {
    resource: RESOURCE,
    resourceId: outcome.issue.id,
    action: "delete",
    before: outcome.issue,
  });
  return c.json({ success: true, data: outcome.issue });
});

const worker = new Hono<Env>();

worker.use("*", async (c, next) => {
  const workerId = await resolveWorkerToken(c.var.DB, c.req.header("x-worker-token"));
  if (!workerId) return c.json({ success: false, error: "Not authenticated" }, 401);
  (c as unknown as { set: (key: string, value: unknown) => void }).set("workerId", workerId);
  await next();
});

worker.get("/", async (c) => {
  const workerId = contextValue(c, "workerId");
  const outsourceWorker = await loadOutsourceWorker(c.var.DB, workerId);
  if (!outsourceWorker) {
    return c.json(
      {
        success: false,
        code: "NOT_OUTSOURCE_WORKER",
        error: "This list is only for active outsourced workers.",
      },
      403,
    );
  }
  const orgId = tryGetOrgId(c) ?? DEFAULT_ORG_ID;
  const lists = await listWorkerIssues(c.var.DB, { orgId, workerId });
  return c.json({ success: true, data: lists });
});

export { admin as outsourceIssuesAdmin, worker as outsourceIssuesWorker };
