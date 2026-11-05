// Small helpers shared by the scan sheets (Purchase Invoice, Goods Receipt).
export const rm = (n: number) => `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const sen = (n: number) => rm(n / 100);
export const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const safeStore = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};
