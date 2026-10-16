// ---------------------------------------------------------------------------
// finance-names.ts — account and line names in normal case on the finance
// reports (owner 2026-10-14). The chart of accounts is keyed in capitals
// ("STAFF SALARIES"); the reports show "Staff Salaries". Abbreviations stay in
// capitals (EPF, SST, HLBB …), and so do codes (S.WEBBING, B.FILLER, 2026, WD).
// A name that already has a small letter was cased by hand and is left alone.
// Display only: exports, searches and the ledger keep the name as keyed.
// ---------------------------------------------------------------------------

/** Abbreviations with a vowel in them (a word with none — HLBB, SST, HKMFG — stays in capitals anyway). */
const KEEP_UPPER = new Set([
  "AIA", "AP", "AR", "ASB", "ATM", "CEO", "CIMB", "COGS", "EA", "EIS", "EPF", "GDEX", "IBG", "IT", "IWK",
  "MIDA", "OCB", "OCBC", "ODB", "PERKESO", "PPE", "SIRIM", "SME", "SOCSO", "UOB", "UTC", "WIP",
]);

/** Little words written small inside a name ("Interest on Trade Finance"). */
const SMALL = new Set(["A", "AN", "AND", "AS", "AT", "BY", "FOR", "FROM", "IN", "OF", "ON", "OR", "PER", "THE", "TO", "VIA", "WITH"]);

function caseWord(word: string, first: boolean): string {
  if (!/[A-Z]/.test(word)) return word; // "&", "-", "(", "2026"
  if (/[0-9./]/.test(word)) return word; // a code: S.WEBBING, B.FILLER, A/C, 3M
  if (/[A-Z]&[A-Z]/.test(word)) return word; // R&D, M&E
  if (word.includes("-")) {
    // WORK-IN-PROGRESS → Work-in-Progress
    return word.split("-").map((part, i) => caseWord(part, first && i === 0)).join("-");
  }
  const core = word.replace(/[^A-Z]/g, "");
  if (KEEP_UPPER.has(core)) return word;
  if (SMALL.has(core)) return first ? cap(word) : word.toLowerCase();
  if (core.length <= 2) return word; // SM, BM, WD, TF, M, S
  if (!/[AEIOUY]/.test(core)) return word; // HLBB, SST, HKMFG, SDN BHD
  return cap(word);
}

/** "(UNCLOSED)" → "(Unclosed)": the first letter stays, the rest go small. */
function cap(word: string): string {
  const i = word.search(/[A-Za-z]/);
  if (i < 0) return word;
  return word.slice(0, i + 1).toUpperCase() + word.slice(i + 1).toLowerCase();
}

/**
 * An account or report line name as the finance reports show it. A name that
 * is mostly capitals is recased word by word ("WIP MOVEMENT (net)" → "WIP
 * Movement (net)"); one that is mostly small letters was cased by hand and is
 * left exactly as keyed ("Amount due to HOUZS").
 */
export function acctName(name: string | null | undefined): string {
  const s = name ?? "";
  const lettered = s.match(/\S*[A-Za-z]\S*/g) ?? [];
  const caps = lettered.filter((w) => !/[a-z]/.test(w));
  if (caps.length * 2 <= lettered.length) return s;
  let first = true;
  return s.replace(/\S+/g, (w) => {
    const out = /[a-z]/.test(w) ? w : caseWord(w, first);
    if (/[A-Za-z]/.test(w)) first = false;
    return out;
  });
}
