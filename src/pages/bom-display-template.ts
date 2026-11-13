export interface VersionedTemplate {
  id: string;
  productCode: string;
  versionStatus?: "DRAFT" | "ACTIVE" | "OBSOLETE";
  effectiveFrom?: string;
}

function compareNewestEffectiveFirst(a: VersionedTemplate, b: VersionedTemplate): number {
  const aFrom = a.effectiveFrom || "";
  const bFrom = b.effectiveFrom || "";
  if (aFrom === bFrom) return 0;
  if (!aFrom) return 1;
  if (!bFrom) return -1;
  return bFrom.localeCompare(aFrom);
}

function pickDisplayTemplate<T extends VersionedTemplate>(matches: T[]): T {
  const activeMatches = matches.filter((t) => (t.versionStatus ?? "ACTIVE") === "ACTIVE");
  const pool = activeMatches.length > 0 ? activeMatches : matches;
  return [...pool].sort(compareNewestEffectiveFirst)[0];
}

export function pickDisplayTemplates<T extends VersionedTemplate>(templates: T[]): Map<string, T> {
  const templatesByCode = new Map<string, T[]>();
  for (const template of templates) {
    const matches = templatesByCode.get(template.productCode);
    if (matches) matches.push(template);
    else templatesByCode.set(template.productCode, [template]);
  }
  const displayTemplates = new Map<string, T>();
  for (const [productCode, matches] of templatesByCode) {
    displayTemplates.set(productCode, pickDisplayTemplate(matches));
  }
  return displayTemplates;
}
