import type { ReactElement } from "react";
import { AlertTriangle } from "lucide-react";
import { describeJobCardPreview, type JobCardImpact } from "@/lib/job-card-impact";

export interface JobCardImpactNoticeProps {
  impact: JobCardImpact;
}

const WARNING_BOX = "flex gap-2 rounded bg-[#FAEFCB] p-3 text-sm text-[#7A5717]";
const NEUTRAL_BOX = "rounded bg-[#FAF8F5] p-3 text-sm text-[#374151]";

export function JobCardImpactNotice({ impact }: JobCardImpactNoticeProps): ReactElement {
  if (impact.kind === "unknown") {
    return (
      <div role="status" className={WARNING_BOX}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>Couldn't check how many job cards this import changes ({impact.reason}).</p>
      </div>
    );
  }
  if (impact.preview.toUpdate === 0) {
    return (
      <p role="status" className={NEUTRAL_BOX}>
        No job card Prod Time changes.
      </p>
    );
  }
  const [heading, ...details] = describeJobCardPreview(impact.preview, "import");
  const boxClass = impact.preview.completedThisMonth > 0 ? WARNING_BOX : NEUTRAL_BOX;
  return (
    <div role="status" className={boxClass}>
      {impact.preview.completedThisMonth > 0 && (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <div>
        <p className="font-semibold">{heading}</p>
        {details.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}
