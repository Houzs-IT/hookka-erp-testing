// ===========================================================================
// 3PL Providers (Batch 4, Claude Design "3PL Providers") — data layer.
//
// Reads (all existing endpoints; nothing new on the API):
//   providers     GET /api/drivers            (+ vehicleCount / driverCount / ratedStates[])
//   rate card     GET /api/three-pl-state-rates?providerId=   (16 rows; lazily seeds 0/0 rows)
//   fleet         GET /api/three-pl-vehicles?providerId=
//   drivers       GET /api/three-pl-drivers?providerId=
//   attachments   GET /api/files?resourceType=THREE_PL_PROVIDER&resourceId=
// Writes: POST/PUT/DELETE /api/drivers[/:id], PUT /api/three-pl-state-rates/bulk,
// POST/PUT /api/three-pl-vehicles[/:id], POST/PUT /api/three-pl-drivers[/:id],
// POST /api/files (multipart), DELETE /api/files/:id.
//
// Money is integer sen. This screen only DISPLAYS rates — DO cost is computed
// by the API (delivery-orders.ts), never here.
// ===========================================================================
import { invalidateCachePrefix } from "@/lib/cached-fetch";
import { MALAYSIA_STATES } from "@/lib/malaysia-states";

export type RawRow = Record<string, unknown>;

export type ProviderStatus = "ACTIVE" | "INACTIVE" | "ON_LEAVE";
export type UnitStatus = "ACTIVE" | "INACTIVE";

export type Provider = {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  status: ProviderStatus;
  remarks: string;
  vehicleCount: number;
  driverCount: number;
  ratedStates: string[];
};
export type Vehicle = {
  id: string;
  plateNo: string;
  vehicleType: string;
  capacityM3: number;
  ratePerTripSen: number;
  ratePerExtraDropSen: number;
  status: UnitStatus;
  remarks: string;
  boxLengthFt: number | null;
  boxWidthFt: number | null;
  boxHeightFt: number | null;
};
export type Driver = { id: string; name: string; phone: string; status: UnitStatus; remarks: string };
export type StateRate = { state: string; label: string; tripSen: number; dropSen: number };
export type FileRow = { id: string; filename: string; contentType: string; sizeBytes: number; uploadedAt: string };

export type Envelope = { success?: boolean; data?: RawRow[]; error?: string };

// ---- dual-key reads -----------------------------------------------------------
const str = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null && v !== "") return String(v);
  }
  return "";
};
const num = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null && v !== "" && isFinite(Number(v))) return Number(v);
  }
  return 0;
};
const numOrNull = (r: RawRow, ...k: string[]) => {
  for (const key of k) {
    const v = r[key];
    if (v != null && v !== "" && isFinite(Number(v))) return Number(v);
  }
  return null;
};
const rows = (v: unknown): RawRow[] => (Array.isArray(v) ? (v as RawRow[]) : []);

export const STATE_ORDER = new Map(MALAYSIA_STATES.map((s, i) => [s.code, i]));
export const STATE_LABEL = new Map(MALAYSIA_STATES.map((s) => [s.code, s.label]));

function providerStatus(v: string): ProviderStatus {
  return v === "INACTIVE" || v === "ON_LEAVE" ? v : "ACTIVE";
}
const unitStatus = (v: string): UnitStatus => (v === "INACTIVE" ? "INACTIVE" : "ACTIVE");

export function toProvider(r: RawRow): Provider {
  const rated = Array.isArray(r.ratedStates ?? r.rated_states) ? ((r.ratedStates ?? r.rated_states) as unknown[]).map(String) : [];
  return {
    id: str(r, "id"),
    name: str(r, "name"),
    contactPerson: str(r, "contactPerson", "contact_person"),
    phone: str(r, "phone"),
    status: providerStatus(str(r, "status")),
    remarks: str(r, "remarks"),
    vehicleCount: num(r, "vehicleCount", "vehicle_count"),
    driverCount: num(r, "driverCount", "driver_count"),
    ratedStates: [...rated].sort((a, b) => (STATE_ORDER.get(a) ?? 99) - (STATE_ORDER.get(b) ?? 99)),
  };
}
export function toVehicle(r: RawRow): Vehicle {
  return {
    id: str(r, "id"),
    plateNo: str(r, "plateNo", "plate_no", "plateno"),
    vehicleType: str(r, "vehicleType", "vehicle_type"),
    capacityM3: num(r, "capacityM3", "capacity_m3"),
    ratePerTripSen: num(r, "ratePerTripSen", "rate_per_trip_sen"),
    ratePerExtraDropSen: num(r, "ratePerExtraDropSen", "rate_per_extra_drop_sen"),
    status: unitStatus(str(r, "status")),
    remarks: str(r, "remarks"),
    boxLengthFt: numOrNull(r, "boxLengthFt", "boxlengthft"),
    boxWidthFt: numOrNull(r, "boxWidthFt", "boxwidthft"),
    boxHeightFt: numOrNull(r, "boxHeightFt", "boxheightft"),
  };
}
export function toDriver(r: RawRow): Driver {
  return { id: str(r, "id"), name: str(r, "name"), phone: str(r, "phone"), status: unitStatus(str(r, "status")), remarks: str(r, "remarks") };
}
/** The fixed 16-state card, in canonical order; a state the server did not send reads 0/0. */
export function toRates(v: unknown): StateRate[] {
  const by = new Map(rows(v).map((r) => [str(r, "state"), r]));
  return MALAYSIA_STATES.map((s) => {
    const r = by.get(s.code);
    return {
      state: s.code,
      label: s.label,
      tripSen: r ? num(r, "ratePerTripSen", "rate_per_trip_sen") : 0,
      dropSen: r ? num(r, "ratePerExtraDropSen", "rate_per_extra_drop_sen") : 0,
    };
  });
}
export function toFile(r: RawRow): FileRow {
  return {
    id: str(r, "id"),
    filename: str(r, "filename", "fileName", "file_name") || "File",
    contentType: str(r, "contentType", "content_type"),
    sizeBytes: num(r, "sizeBytes", "size_bytes"),
    uploadedAt: str(r, "uploadedAt", "uploaded_at"),
  };
}
export const listOf = <T,>(env: Envelope | null | undefined, map: (r: RawRow) => T): T[] => rows(env?.data).map(map);

/** A rate pair counts as "served" when either side is non-zero (0/0 = unset, house rule). */
export const served = (r: StateRate) => r.tripSen > 0 || r.dropSen > 0;

// ---- urls ---------------------------------------------------------------------
export const PROVIDERS_URL = "/api/drivers";
export const FILE_RESOURCE = "THREE_PL_PROVIDER";
const q = encodeURIComponent;
export const providerUrl = (id: string) => `/api/drivers/${q(id)}`;
export const ratesUrl = (id: string) => `/api/three-pl-state-rates?providerId=${q(id)}`;
export const vehiclesUrl = (id: string) => `/api/three-pl-vehicles?providerId=${q(id)}`;
export const driversUrl = (id: string) => `/api/three-pl-drivers?providerId=${q(id)}`;
export const filesUrl = (id: string) => `/api/files?resourceType=${FILE_RESOURCE}&resourceId=${q(id)}`;
export const fileDownloadUrl = (fileId: string) => `/api/files/${q(fileId)}/download`;

/** After any write: every cached 3PL read refetches (lists, cards, counts). */
export function invalidate3pl(): void {
  invalidateCachePrefix(PROVIDERS_URL);
  invalidateCachePrefix("/api/three-pl-");
  invalidateCachePrefix(`/api/files?resourceType=${FILE_RESOURCE}`);
}

// ---- writes -------------------------------------------------------------------
export type SendResult = { ok: true; data: RawRow | null } | { ok: false; error: string; status: number };

/** JSON (or FormData) mutation; the server's own `error` text is what the user reads. */
export async function send(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<SendResult> {
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; data?: RawRow };
    if (!res.ok || json.success === false) {
      return { ok: false, status: res.status, error: json.error || (res.status === 403 ? "You don't have permission to do this." : `Request failed (HTTP ${res.status})`) };
    }
    return { ok: true, data: json.data ?? null };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error && e.message ? `Network error: ${e.message}` : "Network error. Check your connection and try again." };
  }
}

// ---- formatting / parsing -----------------------------------------------------
export const rm = (sen: number) => `RM ${(sen / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** sen → the input's text ("" for 0 = blank = unset). */
export const senText = (sen: number) => (sen ? (sen / 100).toFixed(2) : "");
export const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim());
/** Validated RM text → integer sen; blank → 0. Only call after isMoney(). */
export const toSen = (v: string) => (v.trim() === "" ? 0 : Math.round(Number(v.replace(/,/g, "").trim()) * 100));
export const isDecimal = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim()) || /^\d*\.\d+$/.test(v.trim());

/** ft³ → m³, desktop's withAutoCap rule (src/pages/delivery/index.tsx). */
export function autoCapacity(L: string, W: string, H: string): string | null {
  const l = Number(L), w = Number(W), h = Number(H);
  const ok = (n: number) => isFinite(n) && n > 0 && n < 100; // the server's dimension rule
  if (L !== "" && W !== "" && H !== "" && ok(l) && ok(w) && ok(h)) {
    return (l * w * h * 0.028316846592).toFixed(2);
  }
  return null;
}
/** Server rule (three-pl-vehicles.ts validateDimension): blank, or > 0 and < 100 ft. */
export function dimError(v: string): string {
  if (v.trim() === "") return "";
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "Must be more than 0";
  if (n >= 100) return "Must be under 100 ft";
  return "";
}
export const fmt2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function fileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export function fileKind(f: FileRow): string {
  const ext = f.filename.includes(".") ? f.filename.split(".").pop()!.toUpperCase() : "";
  if (ext && ext.length <= 4) return ext;
  if (f.contentType.startsWith("image/")) return "Image";
  if (f.contentType === "application/pdf") return "PDF";
  return "File";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Providers that can't be picked for new DOs: inactive AND on leave. */
export const notPickable = (s: ProviderStatus) => s !== "ACTIVE";

/** The DO pricing rule as the API applies it today (delivery-orders.ts) — display only. */
export const PRICING_RULE =
  "A Delivery Order's cost is the vehicle's trip rate + (drop points − 1) × its extra-drop rate when the vehicle has rates; otherwise the provider's own (legacy) rates. It is only filled in when no cost was typed on the DO.";
