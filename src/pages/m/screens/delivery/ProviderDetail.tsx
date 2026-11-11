// ===========================================================================
// 3PL provider detail (read-only), laid out as the Claude Design provider
// overlay. Data: the same reads the desktop provider dialog makes — the
// provider row from GET /api/drivers, /api/three-pl-vehicles,
// /api/three-pl-drivers and /api/three-pl-state-rates ?providerId=.
// Rates shown are only the ones the API prices with: per state (State Rate
// Card) and per vehicle. There is no single provider rate. Editing stays on
// desktop.
// ===========================================================================
import { useCachedJson } from "@/lib/cached-fetch";
import { MobileHeader } from "../../components";
import { M } from "../../theme";
import { money } from "../../config/helpers";
import { n, providerStatusLabel, rows, s, type RawRow } from "../../lib/do-mobile";
import { Notice, Surface, TilePill } from "./ui";
import { DL, sem } from "./ui-tokens";

type Envelope = { success?: boolean; data?: RawRow[] };

function statusColor(v: string): string {
  return v === "ACTIVE" ? sem("success") : v === "ON_LEAVE" ? "var(--dl-pill-warning-fg)" : M.ink;
}

function Row({ a, b, c, first, cColor }: { a: string; b?: string; c?: string; first: boolean; cColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 50, borderTop: first ? "none" : `1px solid ${DL.track}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: M.raisin }}>{a}</div>
        {b ? <div style={{ fontSize: 12, color: M.ink, marginTop: 2 }}>{b}</div> : null}
      </div>
      {c ? <span style={{ flex: "none", fontSize: 13, fontWeight: 600, color: cColor ?? M.raisin, fontVariantNumeric: "tabular-nums" }}>{c}</span> : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: M.taupe, margin: "22px 4px 8px" }}>{title}</div>
      <Surface style={{ padding: "2px 15px" }}>{children}</Surface>
    </>
  );
}

export function ProviderDetail({ provider, onBack }: { provider: RawRow; onBack: () => void }) {
  const id = s(provider, "id");
  const q = `providerId=${encodeURIComponent(id)}`;
  const vehicles = useCachedJson<Envelope>(`/api/three-pl-vehicles?${q}`);
  const drivers = useCachedJson<Envelope>(`/api/three-pl-drivers?${q}`);
  const rates = useCachedJson<Envelope>(`/api/three-pl-state-rates?${q}`);
  const st = s(provider, "status");
  const vList = rows(vehicles.data?.data);
  const dList = rows(drivers.data?.data);
  // Only states with a real rate pair (0/0 = unset, the house rule).
  const rList = rows(rates.data?.data).filter((r) => n(r, "ratePerTripSen") > 0 || n(r, "ratePerExtraDropSen") > 0);
  const loading = (x: { loading: boolean; data: unknown }) => x.loading && !x.data;
  const empty = (text: string) => <div style={{ padding: "14px 0", fontSize: 12.5, color: M.ink }}>{text}</div>;

  const info: [string, string][] = [
    ["Contact person", s(provider, "contactPerson") || "—"],
    ["Phone", s(provider, "phone") || "—"],
  ];
  if (s(provider, "remarks")) info.push(["Remarks", s(provider, "remarks")]);

  return (
    <>
      <MobileHeader title={s(provider, "name") || "3PL provider"} onBack={onBack} />
      <div style={{ padding: "2px 18px 40px" }}>
        <TilePill tone={st === "ACTIVE" ? "success" : "neutral"} label={providerStatusLabel(st)} size="md" />
        <Surface style={{ marginTop: 14, padding: "4px 15px" }}>
          {info.map(([k, v], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", minHeight: 46, borderTop: i ? `1px solid ${DL.track}` : "none" }}>
              <span style={{ fontSize: 12.5, color: M.ink }}>{k}</span>
              <span style={{ minWidth: 0, textAlign: "right", fontSize: 13.5, fontWeight: 600, color: M.raisin, overflowWrap: "anywhere" }}>{v}</span>
            </div>
          ))}
        </Surface>

        <Group title={`VEHICLES · ${vList.length}`}>
          {loading(vehicles) ? empty("Loading…") : vList.length === 0 ? empty("No vehicles.") : vList.map((v, i) => (
            <Row
              key={s(v, "id")}
              first={i === 0}
              a={s(v, "plateNo") || "—"}
              b={[s(v, "vehicleType"), n(v, "capacityM3") ? `${n(v, "capacityM3")} m³` : "", n(v, "ratePerTripSen") ? `${money(n(v, "ratePerTripSen"))}/trip` : ""].filter(Boolean).join(" · ")}
              c={providerStatusLabel(s(v, "status"))}
              cColor={statusColor(s(v, "status"))}
            />
          ))}
        </Group>

        <Group title={`DRIVERS · ${dList.length}`}>
          {loading(drivers) ? empty("Loading…") : dList.length === 0 ? empty("No drivers.") : dList.map((d, i) => (
            <Row key={s(d, "id")} first={i === 0} a={s(d, "name") || "—"} b={s(d, "phone")} c={providerStatusLabel(s(d, "status"))} cColor={statusColor(s(d, "status"))} />
          ))}
        </Group>

        <Group title={`STATES COVERED · ${rList.length}`}>
          {loading(rates) ? empty("Loading…") : rList.length === 0 ? empty("No state rates set.") : rList.map((r, i) => (
            <Row
              key={s(r, "state")}
              first={i === 0}
              a={s(r, "state")}
              b={`From the State Rate Card · per extra drop ${money(n(r, "ratePerExtraDropSen"))}`}
              c={`${money(n(r, "ratePerTripSen"))}/trip`}
            />
          ))}
        </Group>

        <div style={{ marginTop: 16 }}>
          <Notice>Adding or editing providers, vehicles, drivers and the State Rate Card stays on desktop.</Notice>
        </div>
      </div>
    </>
  );
}
