import type { ConfirmOptions } from "@/components/ui/confirm-dialog";

export interface JobCardMinutesPreview {
  toUpdate: number;
  unfinished: number;
  completedThisMonth: number;
}

export type JobCardImpact =
  | { kind: "cards"; preview: JobCardMinutesPreview }
  | { kind: "unknown"; reason: string };

export interface WipTimeEdit {
  wipLabel: string;
  deptCode: string;
  minutes: number;
}

function isJobCardMinutesPreview(value: unknown): value is JobCardMinutesPreview {
  return (
    typeof value === "object" &&
    value !== null &&
    "toUpdate" in value &&
    typeof value.toUpdate === "number" &&
    "unfinished" in value &&
    typeof value.unfinished === "number" &&
    "completedThisMonth" in value &&
    typeof value.completedThisMonth === "number"
  );
}

function readErrorText(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  if ("error" in value && typeof value.error === "string") return value.error;
  return null;
}

export function readJobCardImpact(responseBody: unknown): JobCardImpact {
  if (typeof responseBody !== "object" || responseBody === null || !("jobCardPreview" in responseBody)) {
    return { kind: "unknown", reason: readErrorText(responseBody) ?? "no preview in the server reply" };
  }
  const preview = responseBody.jobCardPreview;
  if (isJobCardMinutesPreview(preview)) return { kind: "cards", preview };
  return { kind: "unknown", reason: readErrorText(preview) ?? "unreadable preview" };
}

async function requestJobCardImpact(url: string, init: RequestInit): Promise<JobCardImpact> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const responseBody: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return { kind: "unknown", reason: readErrorText(responseBody) ?? `HTTP ${response.status}` };
    }
    return readJobCardImpact(responseBody);
  } catch (err) {
    return { kind: "unknown", reason: err instanceof Error ? err.message : "network error" };
  }
}

export function previewWipTimeEdits(edits: readonly WipTimeEdit[]): Promise<JobCardImpact> {
  return requestJobCardImpact("/api/wip-times/bulk-import", {
    method: "POST",
    body: JSON.stringify({ items: edits, dryRun: true }),
  });
}

export function previewBomTemplateSave(templateId: string, template: unknown): Promise<JobCardImpact> {
  return requestJobCardImpact(`/api/bom/templates/${encodeURIComponent(templateId)}?preview=true`, {
    method: "PUT",
    body: JSON.stringify(template),
  });
}

function countJobCards(count: number): string {
  return count === 1 ? "1 job card" : `${count} job cards`;
}

export function describeJobCardPreview(
  preview: JobCardMinutesPreview,
  actionLabel: "save" | "import" = "save",
): string[] {
  const lines = [`This ${actionLabel} also changes Prod Time on ${countJobCards(preview.toUpdate)}:`];
  if (preview.unfinished > 0) lines.push(`• ${preview.unfinished} unfinished`);
  if (preview.completedThisMonth > 0) {
    lines.push(`• ${preview.completedThisMonth} completed this month (changes this month's efficiency and payroll)`);
  }
  lines.push("Cards completed before this month are not changed.");
  return lines;
}

export function jobCardImpactConfirmOptions(impact: JobCardImpact): ConfirmOptions | null {
  if (impact.kind === "unknown") {
    return {
      title: "Couldn't check job cards",
      message:
        `We couldn't work out how many job cards this save changes (${impact.reason}).\n` +
        "Saving still updates unfinished cards and cards completed this month on the steps you changed.",
      confirmLabel: "Save anyway",
      cancelLabel: "Back",
    };
  }
  if (impact.preview.toUpdate === 0) return null;
  return {
    title: "Update job card times?",
    message: describeJobCardPreview(impact.preview).join("\n"),
    confirmLabel: `Save and update ${impact.preview.toUpdate === 1 ? "1 card" : `${impact.preview.toUpdate} cards`}`,
    cancelLabel: "Back",
  };
}

export async function confirmJobCardImpact(
  confirm: (options: ConfirmOptions) => Promise<boolean>,
  impact: JobCardImpact,
): Promise<boolean> {
  const options = jobCardImpactConfirmOptions(impact);
  return options === null ? true : confirm(options);
}
