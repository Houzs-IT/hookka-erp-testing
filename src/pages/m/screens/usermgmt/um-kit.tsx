// ===========================================================================
// User Management (mobile) — the prototype's blocks: avatar, badges, member and
// invite cards, identity header, info rows, notes, form fields, role chips,
// skeletons and the solid action dock. Full-screen layers (form page, sheet,
// dialog) and the toast are reused from the 3PL kit (threepl/tpl-kit, tpl-toast),
// so this file adds no fixed-position layer of its own.
// ===========================================================================
import type { ReactNode } from "react";
import { CircleDashed, Clock, LogIn, MailCheck, MailX, type LucideIcon } from "lucide-react";
import { ResponsiveActionDock } from "../../components/ResponsiveActionDock";
import {
  avatarTone, expiryText, fmtDateTime, initials, nameOf, roleChip, ROLE_CODES, type Account, type Invite,
} from "../../lib/usermgmt-lib";
import { AVATAR, SECTION, TONE, U, type Tone } from "./um-style";
import { CHIP_BTN, SH_CARD, SH_CARD_ON } from "../threepl/tpl-style";

export function Avatar({ seed, size = 42 }: { seed: string; size?: number }) {
  const t = AVATAR[avatarTone(seed)];
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, flex: "none", borderRadius: "50%", background: t.b, color: t.c, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size >= 56 ? 20 : 14.5, fontWeight: 700, letterSpacing: 0.3,
      }}
    >
      {initials(seed)}
    </span>
  );
}

export function Badge({ l, tone }: { l: string; tone: Tone }) {
  const t = TONE[tone];
  return (
    <span style={{ flex: "none", height: 20, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: t.b, color: t.c, fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
      {l}
    </span>
  );
}

export function AccountBadges({ a, me }: { a: Account; me: boolean }) {
  return (
    <>
      <Badge l={roleChip(a.role)} tone="brand" />
      <Badge l={a.isActive ? "Active" : "Disabled"} tone={a.isActive ? "ok" : "neu"} />
      {me ? <Badge l="You" tone="info" /> : null}
    </>
  );
}

function Line({ icon: Icon, t, warn }: { icon: LucideIcon; t: string; warn?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: warn ? 700 : 500, color: warn ? U.warn : U.mut, minWidth: 0 }}>
      <Icon size={13} strokeWidth={2} style={{ flex: "none" }} aria-hidden />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>
    </span>
  );
}

function CardShell({ aria, current, dim, onOpen, children }: { aria: string; current?: boolean; dim?: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={aria}
      aria-current={current ? "true" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex", gap: 12, alignItems: "flex-start", padding: "13px 14px", borderRadius: 16, background: U.card, color: U.ink, minWidth: 0,
        boxShadow: current ? SH_CARD_ON : SH_CARD, opacity: dim ? 0.75 : 1, cursor: "pointer", WebkitTapHighlightColor: "transparent", boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}

function CardBody({ name, email, badges, meta, lines }: { name: string; email: string; badges: ReactNode; meta: string; lines: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
      {email ? <div style={{ fontSize: 12.5, color: U.mut, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>{badges}</div>
      {meta ? <div style={{ fontSize: 12.5, color: U.sub, marginTop: 7, overflowWrap: "anywhere" }}>{meta}</div> : null}
      <div style={{ display: "grid", gap: 3, marginTop: 6 }}>{lines}</div>
    </div>
  );
}

export function MemberCard({ a, me, current, onOpen }: { a: Account; me: boolean; current: boolean; onOpen: () => void }) {
  const name = nameOf(a);
  return (
    <CardShell aria={`${name}, ${roleChip(a.role)}, ${a.isActive ? "Active" : "Disabled"}`} current={current} dim={!a.isActive} onOpen={onOpen}>
      <Avatar seed={name} />
      <CardBody
        name={name}
        email={a.displayName ? a.email : ""}
        badges={<AccountBadges a={a} me={me} />}
        meta={[a.department, a.position].filter(Boolean).join(" · ")}
        lines={a.lastLoginAt ? <Line icon={LogIn} t={`Last login ${fmtDateTime(a.lastLoginAt)}`} /> : <Line icon={CircleDashed} t="Never signed in" warn />}
      />
    </CardShell>
  );
}

export function InviteCard({ x, nowMs, onOpen }: { x: Invite; nowMs: number; onOpen: () => void }) {
  const name = x.displayName || x.email;
  return (
    <CardShell aria={`Invite for ${x.email}`} onOpen={onOpen}>
      <Avatar seed={name} />
      <CardBody
        name={name}
        email={x.displayName ? x.email : ""}
        badges={<><Badge l={roleChip(x.role)} tone="brand" /><Badge l="Pending" tone="warn" /></>}
        meta={x.inviterName ? `Invited by ${x.inviterName}` : ""}
        lines={
          <>
            <Line icon={Clock} t={expiryText(x.expiresAt, nowMs)} />
            {x.emailSentAt ? <Line icon={MailCheck} t={`Sent ${fmtDateTime(x.emailSentAt)}`} /> : <Line icon={MailX} t="Email not sent" warn />}
          </>
        }
      />
    </CardShell>
  );
}

/** List label row: "14 ACCOUNTS ———— Name A–Z". */
export function ListLabel({ t, r, rTone }: { t: string; r?: string; rTone?: "warn" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px 8px" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: U.br }}>{t}</span>
      <span style={{ flex: 1, height: 1, background: U.ln }} />
      {r ? <span style={{ fontSize: 11.5, fontWeight: 600, color: rTone === "warn" ? U.warn : U.mut }}>{r}</span> : null}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 4px 0" }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: U.br }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: U.ln }} />
    </div>
  );
}

export type KV = { k: string; v: string; warn?: boolean };
export function InfoRows({ rows }: { rows: KV[] }) {
  return (
    <div style={SECTION}>
      {rows.map((r, i) => (
        <div key={r.k} style={{ display: "flex", alignItems: "flex-start", gap: 12, minHeight: 46, padding: "12px 14px", boxSizing: "border-box", borderTop: i ? `1px solid ${U.ln}` : "none" }}>
          <span style={{ flex: "none", width: 104, fontSize: 12.5, color: U.mut }}>{r.k}</span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 13.5, fontWeight: 600, color: r.warn ? U.warn : r.v ? U.ink : U.mut, overflowWrap: "anywhere" }}>{r.v || "—"}</span>
        </div>
      ))}
    </div>
  );
}

export function Note({ tone, icon: Icon, children }: { tone: Tone; icon: LucideIcon; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 14, background: t.b, color: t.c, fontSize: 13, lineHeight: 1.45 }}>
      <Icon size={16} strokeWidth={2} style={{ flex: "none", marginTop: 1 }} aria-hidden />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

export function Skeleton({ h, r = 16 }: { h: number; r?: number }) {
  return <div className="tpl-anim" aria-hidden style={{ height: h, borderRadius: r, background: U.card, animation: "tpl-pulse 1.2s ease-in-out infinite" }} />;
}

// ---- form fields ------------------------------------------------------------------
export function InputField({ l, hint, v, on, ph, type = "text", err }: {
  l: string; hint?: string; v: string; on: (v: string) => void; ph?: string; type?: "text" | "email"; err?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, fontSize: 12.5, fontWeight: 700, color: U.ink }}>
        {l}
        {hint ? <span style={{ fontWeight: 500, color: U.mut }}>{hint}</span> : null}
      </span>
      <span style={{ display: "flex", alignItems: "center", height: 46, padding: "0 13px", borderRadius: 12, background: U.inp, boxShadow: err ? `0 0 0 1.5px ${U.bad}` : `0 0 0 1px ${U.ln}` }}>
        <input
          className="tpl-in"
          type={type}
          inputMode={type === "email" ? "email" : "text"}
          autoComplete="off"
          autoCapitalize={type === "email" ? "off" : "words"}
          spellCheck={false}
          value={v}
          onChange={(e) => on(e.target.value)}
          placeholder={ph}
          aria-invalid={err ? true : undefined}
          style={{ flex: 1, minWidth: 0, height: "100%", border: "none", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 16, color: U.ink, padding: 0 }}
        />
      </span>
      {err ? <span role="alert" style={{ display: "block", marginTop: 5, fontSize: 11.5, color: U.bad }}>{err}</span> : null}
    </label>
  );
}

/** Role picker: shows roleShort, stores the ROLE_OPTIONS code. No default. */
export function RoleChips({ v, on, err }: { v: string; on: (code: string) => void; err?: string }) {
  return (
    <div>
      <div style={{ marginBottom: 8, fontSize: 12.5, fontWeight: 700, color: U.ink }}>Role *</div>
      <div role="radiogroup" aria-label="Role" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ROLE_CODES.map((code) => {
          const on2 = v === code;
          return (
            <button key={code} type="button" role="radio" aria-checked={on2} onClick={() => on(code)} style={{ ...CHIP_BTN(on2), height: 38 }}>
              {roleChip(code)}
            </button>
          );
        })}
      </div>
      {err ? <span role="alert" style={{ display: "block", marginTop: 6, fontSize: 11.5, color: U.bad }}>{err}</span> : null}
    </div>
  );
}

// ---- solid bottom action bar (above the tab bar on phones) --------------------------
export function ActionDock({ l, icon: Icon, danger, onTap }: { l: string; icon: LucideIcon; danger: boolean; onTap: () => void }) {
  return (
    <ResponsiveActionDock scope="auto" phoneBottom={56} zIndex={31}>
      <div style={{ pointerEvents: "auto", width: "100%", boxSizing: "border-box", padding: "10px 16px", background: U.bg, boxShadow: `0 -1px 0 ${U.ln}` }}>
        <button
          type="button"
          onClick={onTap}
          style={{
            display: "flex", width: "100%", maxWidth: 640, margin: "0 auto", height: 50, borderRadius: 14, border: "none", background: danger ? U.bad : U.grad,
            color: "#FFFFFF", fontFamily: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          <Icon size={17} strokeWidth={2.2} />
          {l}
        </button>
      </div>
    </ResponsiveActionDock>
  );
}
