// ---------------------------------------------------------------------------
// Mail Center (Batch 2 v3) — the bottom sheets: Folders and mailboxes, What may
// I see, View settings, Manage labels, Labels picker, and the plain action
// sheet. All on the kit's CommsSheet (the shared Sheet), so no fixed layer here.
// ---------------------------------------------------------------------------
import { useEffect, useState, type ReactNode } from "react";
import {
  Archive, Bell, Building2, Check, ChevronDown, ChevronRight, FilePen, Inbox, Info, Layers, LifeBuoy, Mails, Plus, Send, Settings2, ShieldCheck, ShoppingBag,
  ShoppingCart, Star, Trash2, User, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { useResponsiveLayout } from "../../../lib/responsive-layout";
import { BTN, C, CommsSheet, InfoNote, NUM, Segmented, Spinner, Switch } from "../comms-kit";
import { FOLDER_LABEL, LABEL_PALETTE, labelColor, mailboxKind, mailboxName, missingCanonical, type Folder, type MailAddress, type MailLabel, type MailboxFilter, type Visibility } from "./mail-lib";
import { createLabel, setCategoryTabs, setDensity, updateLabel, usePrefs, type MailCtx } from "./mail-api";
import { setPane, usePane } from "./mail-store";
import { MiniPill, RowGroup, SheetHead, type RowSpec } from "./mail-ui";

// eslint-disable-next-line react-refresh/only-export-components -- co-located constants / helpers for these screens; HMR penalty is acceptable
export const FOLDER_ICON: Record<Folder, LucideIcon> = {
  "my-inbox": Inbox, "my-sent": Send, inbox: Inbox, starred: Star, sent: Send, drafts: FilePen, autosent: Bell, archive: Archive, trash: Trash2, all: Mails,
};
const TONE: Record<Folder, [string, string]> = {
  "my-inbox": ["var(--c-gold)", "var(--c-cream)"], inbox: ["var(--c-gold)", "var(--c-cream)"], starred: ["var(--c-amber)", "var(--c-amber-bg)"],
  sent: ["var(--c-teal)", "var(--c-teal-bg)"], "my-sent": ["var(--c-teal)", "var(--c-teal-bg)"], autosent: ["var(--c-green)", "var(--c-green-bg)"],
  archive: ["var(--c-grey)", "var(--c-grey-bg)"], trash: ["var(--c-red)", "var(--c-red-bg)"], all: ["var(--c-plum)", "var(--c-plum-bg)"], drafts: ["var(--c-amber)", "var(--c-amber-bg)"],
};
const DEPT_ICON: Record<string, [LucideIcon, string, string]> = {
  Support: [LifeBuoy, "var(--c-teal)", "var(--c-teal-bg)"],
  Finance: [Wallet, "var(--c-green)", "var(--c-green-bg)"],
  HR: [Users, "var(--c-plum)", "var(--c-plum-bg)"],
  Sales: [ShoppingCart, "var(--c-teal)", "var(--c-teal-bg)"],
  Procurement: [ShoppingBag, "var(--c-amber)", "var(--c-amber-bg)"],
};

const SheetBody = ({ children }: { children: ReactNode }) => <div style={{ padding: "4px 16px calc(24px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>;

// ---- the plain action sheet ------------------------------------------------------------
export function ActionSheet({ open, onClose, title, sub, rows }: { open: boolean; onClose: () => void; title: string; sub?: string; rows: RowSpec[] }) {
  return (
    <CommsSheet open={open} onClose={onClose} title={title} sub={sub}>
      <SheetBody><RowGroup rows={rows} /></SheetBody>
    </CommsSheet>
  );
}

// ---- Folders and mailboxes ---------------------------------------------------------------
export type FolderTileInfo = { folder: Folder; label: string; n: number; badge?: "red" };
export function FoldersSheet(p: {
  open: boolean;
  onClose: () => void;
  folder: Folder;
  curMailboxLine: string;
  curUnread: number;
  mine: FolderTileInfo[] | null;
  all: FolderTileInfo[];
  onFolder: (f: Folder) => void;
  labels: { name: string; color: string; count: number }[];
  label: string | null;
  onLabel: (name: string | null) => void;
  canManageLabels: boolean;
  onManage: () => void;
  groups: { dept: string; mailboxes: MailAddress[] }[];
  mailbox: MailboxFilter;
  onMailbox: (m: MailboxFilter) => void;
  unreadByMailbox: Map<string, number>;
  myAddress: string;
  totalMailboxes: number;
  allAddresses: MailAddress[] | null;
  isSuperAdmin: boolean;
  onSetup: (address: string, dept: string) => void;
  onSee: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ Support: true, Finance: true, HR: true });
  const CurIcon = FOLDER_ICON[p.folder];
  const tile = (t: FolderTileInfo) => {
    const on = p.folder === t.folder;
    const Icon = FOLDER_ICON[t.folder];
    const [fg, bg] = TONE[t.folder];
    return (
      <button key={t.folder} type="button" onClick={() => p.onFolder(t.folder)} aria-pressed={on} className="c-press"
        style={{ ...BTN, minWidth: 0, minHeight: 66, padding: "10px 10px 9px", borderRadius: 16, background: on ? "var(--mc-tile-on)" : C.card, boxShadow: on ? "var(--mc-tile-on-sh)" : "var(--c-sh-card)", textAlign: "left", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <span style={{ width: 30, height: 30, flex: "none", borderRadius: 10, background: on ? "rgba(255,255,255,.18)" : bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={15} strokeWidth={2.1} color={on ? "#FFFFFF" : fg} />
          </span>
          {t.n ? (
            <span style={{ minWidth: 20, height: 20, boxSizing: "border-box", padding: "0 6px", borderRadius: 999, background: on ? "#FFFFFF" : t.badge === "red" ? C.red : fg, color: on ? "#6B5C32" : "#FFFFFF", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", ...NUM }}>{t.n}</span>
          ) : null}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: on ? "#FFFFFF" : C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</span>
      </button>
    );
  };
  const allOn = p.mailbox.kind === "all";
  const mbRow = (key: string, on: boolean, label: string, sub: string, kind: string, Icon: LucideIcon, personal: boolean, n: number, onClick: () => void) => (
    <button key={key} type="button" onClick={onClick} aria-pressed={on}
      style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 10px", borderRadius: 12, background: on ? "var(--mc-row-sel)" : "var(--mc-row-read)", boxShadow: on ? "var(--mc-sh-sel)" : "var(--mc-sh-read)", textAlign: "left", width: "100%" }}>
      <span style={{ width: 28, height: 28, flex: "none", borderRadius: "50%", background: personal ? C.tealBg : C.cream, color: personal ? C.teal : C.gold, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={13} strokeWidth={2.2} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={{ display: "block", fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
      </span>
      {n ? <span style={{ minWidth: 18, height: 18, boxSizing: "border-box", padding: "0 5px", borderRadius: 999, background: C.red, color: "#FFFFFF", fontSize: 10, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", ...NUM }}>{n}</span> : null}
      <MiniPill fg={personal ? C.teal : C.grey} bg={personal ? C.tealBg : C.greyBg} size={9.5}>{kind}</MiniPill>
      {on ? <Check size={16} strokeWidth={2.6} color="var(--c-gold)" style={{ flex: "none" }} /> : null}
    </button>
  );
  return (
    <CommsSheet open={p.open} onClose={p.onClose} title="Folders and mailboxes">
      <SheetBody>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 18, background: "var(--mc-hero)", color: "#FFFFFF", boxShadow: "var(--mc-hero-sh)" }}>
          <span style={{ width: 40, height: 40, flex: "none", borderRadius: 12, background: "rgba(255,255,255,.16)", display: "flex", alignItems: "center", justifyContent: "center" }}><CurIcon size={19} strokeWidth={2} color="#FFFFFF" /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: ".8px", color: "var(--mc-hero-sub)" }}>VIEWING</span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 700, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{FOLDER_LABEL[p.folder]}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "rgba(255,255,255,.8)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.curMailboxLine}</span>
          </span>
          {p.curUnread ? (
            <span style={{ flex: "none", textAlign: "right" }}>
              <span style={{ display: "block", fontSize: 20, fontWeight: 800, lineHeight: 1, ...NUM }}>{p.curUnread}</span>
              <span style={{ display: "block", fontSize: 10, color: "var(--mc-hero-sub)", marginTop: 3 }}>unread</span>
            </span>
          ) : null}
        </div>

        {p.mine ? (
          <>
            <SheetHead title="MY MAILBOX" />
            <div style={{ flex: "none", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>{p.mine.map(tile)}</div>
          </>
        ) : null}
        <SheetHead title="ALL MAIL" />
        <div style={{ flex: "none", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>{p.all.map(tile)}</div>

        <SheetHead title="LABELS" action={p.canManageLabels ? (p.labels.length ? "Manage" : "Create") : undefined} onAction={p.onManage} icon={Settings2} />
        {p.labels.length ? (
          <div style={{ flex: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {p.labels.map((l) => {
              const on = p.label?.toLowerCase() === l.name.toLowerCase();
              return (
                <button key={l.name} type="button" onClick={() => p.onLabel(on ? null : l.name)} aria-pressed={on}
                  style={{ ...BTN, minHeight: 36, padding: "0 13px 0 11px", borderRadius: 999, background: on ? l.color : C.card, color: on ? "#FFFFFF" : C.ink, boxShadow: on ? `0 8px 16px -8px ${l.color}` : "var(--c-sh-panel)", fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: l.color, boxShadow: on ? "0 0 0 2px rgba(255,255,255,.7)" : "none" }} />
                  {l.name}
                  {l.count ? <span style={{ opacity: 0.75, ...NUM }}>{l.count}</span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: C.muted, padding: "0 4px" }}>No labels yet.</div>
        )}

        <SheetHead title="MAILBOXES" />
        <button type="button" onClick={() => p.onMailbox({ kind: "all" })} aria-pressed={allOn}
          style={{ ...BTN, flex: "none", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "0 12px", borderRadius: 14, background: allOn ? "var(--mc-tile-on)" : C.card, boxShadow: allOn ? "var(--mc-tile-on-sh)" : "var(--c-sh-panel)", textAlign: "left" }}>
          <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: allOn ? "rgba(255,255,255,.18)" : C.cream, display: "flex", alignItems: "center", justifyContent: "center" }}><Layers size={15} strokeWidth={2} color={allOn ? "#FFFFFF" : "var(--c-gold)"} /></span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: allOn ? "#FFFFFF" : C.ink }}>All mailboxes</span>
          <span style={{ fontSize: 11.5, color: allOn ? "rgba(255,255,255,.8)" : C.muted, ...NUM }}>{p.totalMailboxes} {p.totalMailboxes === 1 ? "mailbox" : "mailboxes"}</span>
        </button>
        {p.groups.map((g) => {
          const isOpen = open[g.dept] ?? false;
          const [Icon, fg, bg] = DEPT_ICON[g.dept] ?? [Building2, "var(--c-gold)", "var(--c-cream)"];
          const un = g.mailboxes.reduce((n, m) => n + (p.unreadByMailbox.get(m.address) ?? 0), 0);
          const missing = p.isSuperAdmin ? missingCanonical(g.dept, p.allAddresses) : [];
          const deptOn = p.mailbox.kind === "dept" && p.mailbox.value === g.dept;
          if (!g.mailboxes.length && !missing.length) return null;
          return (
            <div key={g.dept} style={{ flex: "none", borderRadius: 16, background: C.card, boxShadow: "var(--c-sh-panel)", overflow: "hidden" }}>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.dept]: !isOpen }))} aria-expanded={isOpen}
                style={{ ...BTN, width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 52, padding: "0 12px", background: "transparent", textAlign: "left" }}>
                <span style={{ width: 32, height: 32, flex: "none", borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={15} strokeWidth={2} color={fg} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.ink }}>{g.dept}</span>
                  <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 1 }}>{g.mailboxes.length ? [...new Set(g.mailboxes.map(mailboxKind))].join(" · ") : "Not set up yet"}</span>
                </span>
                {un ? <span style={{ minWidth: 20, height: 20, boxSizing: "border-box", padding: "0 6px", borderRadius: 999, background: C.red, color: "#FFFFFF", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", ...NUM }}>{un}</span> : null}
                <span className="c-anim" style={{ display: "flex", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}><ChevronDown size={16} strokeWidth={2} color="var(--c-chev)" /></span>
              </button>
              {isOpen ? (
                <div style={{ padding: "0 8px 8px", display: "grid", gap: 6 }}>
                  {g.mailboxes.length ? mbRow(`dept:${g.dept}`, deptOn, `All ${g.dept} mailboxes`, `${g.mailboxes.length} ${g.mailboxes.length === 1 ? "mailbox" : "mailboxes"}`, "Department", Building2, false, 0, () => p.onMailbox({ kind: "dept", value: g.dept })) : null}
                  {g.mailboxes.map((m) => {
                    const personal = mailboxKind(m) === "Personal";
                    const on = p.mailbox.kind === "mailbox" && p.mailbox.value === m.address;
                    return mbRow(m.id, on, `${mailboxName(m)}${m.address === p.myAddress ? " (you)" : ""}`, m.address, mailboxKind(m), personal ? User : Users, personal, p.unreadByMailbox.get(m.address) ?? 0, () => p.onMailbox({ kind: "mailbox", value: m.address }));
                  })}
                  {missing.map((addr) => (
                    <div key={addr} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 6px 0 10px", borderRadius: 12, background: "var(--mc-row-read)", boxShadow: "var(--mc-sh-read)" }}>
                      <span style={{ width: 28, height: 28, flex: "none", borderRadius: "50%", background: C.track, color: C.faint, display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={13} strokeWidth={2.2} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.muted }}>{addr}</span>
                        <span style={{ display: "block", fontSize: 11, color: C.faint }}>Not set up yet</span>
                      </span>
                      <button type="button" onClick={() => p.onSetup(addr, g.dept)} style={{ ...BTN, height: 36, padding: "0 12px", borderRadius: 999, background: C.tint, color: C.gold, fontSize: 12, fontWeight: 700 }}>Set up</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        <button type="button" onClick={p.onSee}
          style={{ ...BTN, flex: "none", display: "flex", alignItems: "center", gap: 12, minHeight: 58, padding: "0 14px", borderRadius: 16, background: C.tealBg, boxShadow: "var(--mc-teal-ring)", textAlign: "left" }}>
          <span style={{ width: 34, height: 34, flex: "none", borderRadius: 11, background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}><ShieldCheck size={16} strokeWidth={2} color="var(--c-teal)" /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--mc-teal-ink)" }}>What may I see</span>
            <span style={{ display: "block", fontSize: 11.5, color: C.teal, marginTop: 1 }}>{p.totalMailboxes} {p.totalMailboxes === 1 ? "mailbox" : "mailboxes"} you can read and send from</span>
          </span>
          <ChevronRight size={16} strokeWidth={2} color="var(--c-teal)" />
        </button>
      </SheetBody>
    </CommsSheet>
  );
}

// ---- What may I see (GET /visibility) ----------------------------------------------------------
const LEVEL: Record<string, [string, string]> = {
  personal: ["Personal", "Your own mailbox plus any shared box granted to you."],
  department: ["Department", "Your own mailbox plus every mailbox in your department."],
  company: ["Company", "Every active mailbox."],
};
export function SeeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, error } = useCachedJson<Visibility>(open ? "/api/mail-center/visibility" : null, 120);
  const lv = data ? LEVEL[data.level] ?? [data.level, ""] : null;
  return (
    <CommsSheet open={open} onClose={onClose} title="What may I see" sub="Set by an admin · read-only here">
      <SheetBody>
        {!data ? (
          error ? <div role="alert" style={{ fontSize: 12.5, color: C.red }}>Couldn't load this: {error}</div> : <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted }}><Spinner /> Loading…</div>
        ) : (
          <>
            <SheetHead title="YOUR VISIBILITY" />
            <RowGroup rows={[{ key: "lv", label: lv![0], sub: lv![1], icon: ShieldCheck, tag: { text: "Current", fg: C.green, bg: C.greenBg } }]} />
            <InfoNote icon={Info} style={{ padding: "0 4px" }}>Levels: Personal · Department · Company.</InfoNote>
            <SheetHead title="MAILBOXES YOU CAN ACCESS" />
            {data.readable.length ? (
              <RowGroup rows={data.readable.map((m) => ({ key: m.address, label: `${m.label || m.address.split("@")[0]}${m.own ? " · yours" : ""}`, sub: m.address, icon: m.own ? User : Users, iconFg: m.own ? "var(--c-teal)" : undefined, iconBg: m.own ? "var(--c-teal-bg)" : undefined, tag: m.dept ? { text: m.dept, fg: C.grey, bg: C.greyBg } : undefined }))} />
            ) : (
              <div style={{ fontSize: 12.5, color: C.muted, padding: "0 4px", lineHeight: 1.45 }}>No mailbox is assigned to you yet. Ask an admin to assign one in User Management.</div>
            )}
            <InfoNote icon={Info} style={{ padding: "0 4px" }}>You can read from and send from every mailbox listed.</InfoNote>
          </>
        )}
      </SheetBody>
    </CommsSheet>
  );
}

// ---- View settings ---------------------------------------------------------------------------
export function ViewSheet({ open, onClose, isSuperAdmin, onInject, injecting }: { open: boolean; onClose: () => void; isSuperAdmin: boolean; onInject: () => void; injecting: boolean }) {
  const prefs = usePrefs();
  const pane = usePane();
  const tablet = useResponsiveLayout().mode !== "phone";
  return (
    <CommsSheet open={open} onClose={onClose} title="View settings">
      <SheetBody>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Density</div>
          <Segmented label="Density" role="radiogroup" value={prefs.density} onChange={setDensity} items={[{ key: "compact", label: "Compact" }, { key: "comfortable", label: "Comfortable" }]} />
        </div>
        <button type="button" role="switch" aria-checked={prefs.categoryTabs} onClick={() => setCategoryTabs(!prefs.categoryTabs)}
          style={{ ...BTN, display: "flex", alignItems: "center", gap: 10, minHeight: 54, padding: "0 14px", borderRadius: 14, background: C.card, boxShadow: "var(--c-sh-ring)", textAlign: "left" }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: C.ink }}>Category tabs</span>
            <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>All · Primary · Notifications</span>
          </span>
          <Switch on={prefs.categoryTabs} />
        </button>
        {tablet ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Reading pane</div>
            <Segmented label="Reading pane" role="radiogroup" value={pane} onChange={setPane} items={[{ key: "full", label: "No split" }, { key: "split", label: "Split" }]} />
            <InfoNote icon={Info} style={{ marginTop: 8 }}>Split shows the list beside the conversation when the screen is wide enough. Phones always open the conversation full screen.</InfoNote>
          </div>
        ) : null}
        {isSuperAdmin ? (
          <>
            <SheetHead title="SUPER ADMIN" />
            <RowGroup rows={[{ key: "inject", label: injecting ? "Adding…" : "Inject a test email", sub: "Adds a sample customer email to the first mailbox", icon: Send, disabled: injecting, onClick: onInject }]} />
          </>
        ) : null}
      </SheetBody>
    </CommsSheet>
  );
}

// ---- Manage labels ----------------------------------------------------------------------------
function Swatches({ value, onPick, disabled }: { value: string; onPick: (c: string) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Colour" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {LABEL_PALETTE.map((c) => {
        const on = value.toLowerCase() === c.value.toLowerCase();
        return (
          <button key={c.value} type="button" role="radio" aria-checked={on} aria-label={c.name} disabled={disabled} onClick={() => onPick(c.value)}
            style={{ ...BTN, width: 32, height: 32, borderRadius: "50%", background: c.value, boxShadow: on ? `0 0 0 2px var(--c-paper), 0 0 0 4px ${c.value}` : "none", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF", opacity: disabled ? 0.5 : 1 }}>
            {on ? <Check size={13} strokeWidth={3} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function LabelRow({ l, ctx, onDelete, toast }: { l: MailLabel; ctx: MailCtx; onDelete: (l: MailLabel) => void; toast: (m: string) => void }) {
  const [name, setName] = useState(l.name);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- follow a rename that landed from the server
  useEffect(() => setName(l.name), [l.name]);
  const save = async () => {
    const n = name.trim();
    if (!n || n === l.name) return setName(l.name);
    if (ctx.labels.some((x) => x.id !== l.id && x.name.toLowerCase() === n.toLowerCase())) {
      toast("That label already exists");
      return setName(l.name);
    }
    if (!(await updateLabel(l.id, { name: n }))) {
      toast("Couldn't rename. Please try again.");
      setName(l.name);
    }
  };
  return (
    <div style={{ padding: "10px 12px", borderRadius: 14, background: C.card, boxShadow: "var(--c-sh-ring)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 12, height: 12, flex: "none", borderRadius: "50%", background: l.color || LABEL_PALETTE[0].value }} />
        <input className="c-input" value={name} readOnly={!ctx.canUpdate} onChange={(e) => setName(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label={`Rename ${l.name}`} maxLength={60}
          style={{ flex: 1, minWidth: 0, height: 40, border: "none", outline: "none", background: "var(--mc-file-bg)", borderRadius: 10, padding: "0 10px", fontFamily: "inherit", fontSize: 16, fontWeight: 600, color: C.ink, boxShadow: "var(--mc-file-ring)" }} />
        {ctx.canDelete ? (
          <button type="button" onClick={() => onDelete(l)} aria-label={`Delete ${l.name}`} style={{ ...BTN, width: 44, height: 44, background: "none", color: C.red, display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={16} strokeWidth={2} /></button>
        ) : null}
      </div>
      {ctx.canUpdate ? (
        <div style={{ marginTop: 8 }}>
          <Swatches value={l.color || LABEL_PALETTE[0].value} onPick={async (c) => { if (!(await updateLabel(l.id, { color: c }))) toast("Couldn't change the colour. Please try again."); }} />
        </div>
      ) : null}
    </div>
  );
}

/** Create / rename / recolour / delete. `apply` = create, then put it on these conversations. */
export function LabelsSheet({ open, onClose, ctx, onDelete, toast, apply }: { open: boolean; onClose: () => void; ctx: MailCtx; onDelete: (l: MailLabel) => void; toast: (m: string) => void; apply?: (name: string) => Promise<void> }) {
  const [nn, setNn] = useState("");
  const [nc, setNc] = useState(LABEL_PALETTE[3].value);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const n = nn.trim();
    if (!n) return toast("Give the label a name");
    if (ctx.labels.some((l) => l.name.toLowerCase() === n.toLowerCase()) && !apply) return toast("That label already exists");
    setBusy(true);
    const ok = await createLabel(n, nc);
    if (ok && apply) await apply(n);
    setBusy(false);
    if (!ok) return toast("Couldn't create the label. Please try again.");
    setNn("");
    if (!apply) toast(`Label "${n}" created`);
  };
  return (
    <CommsSheet open={open} onClose={onClose} title="Manage labels" sub={`${ctx.labels.length} ${ctx.labels.length === 1 ? "label" : "labels"}`}>
      <SheetBody>
        {ctx.labels.map((l) => <LabelRow key={l.id} l={l} ctx={ctx} onDelete={onDelete} toast={toast} />)}
        {!ctx.labels.length ? <div style={{ padding: 14, textAlign: "center", fontSize: 12.5, color: C.muted }}>No labels yet.{ctx.canCreate ? " Create one below." : ""}</div> : null}
        {ctx.canCreate ? (
          <div style={{ padding: 12, borderRadius: 14, background: C.card, boxShadow: "0 0 0 1.5px var(--c-sand)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>New label</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="c-input" value={nn} onChange={(e) => setNn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} placeholder="Label name" aria-label="New label name" maxLength={60}
                style={{ flex: 1, minWidth: 0, height: 44, border: "none", outline: "none", background: "var(--mc-file-bg)", borderRadius: 10, padding: "0 10px", fontFamily: "inherit", fontSize: 16, color: C.ink, boxShadow: "var(--mc-file-ring)" }} />
              <button type="button" onClick={() => void create()} disabled={busy} style={{ ...BTN, height: 44, padding: "0 14px", borderRadius: 10, background: "#6B5C32", color: "#FFFFFF", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, opacity: busy ? 0.7 : 1 }}>
                {busy ? <Spinner size={12} color="#FFFFFF" /> : null}{apply ? "Create and apply" : "Create"}
              </button>
            </div>
            <div style={{ marginTop: 8 }}><Swatches value={nc} onPick={setNc} /></div>
          </div>
        ) : null}
        <InfoNote icon={Info} style={{ padding: "0 4px" }}>Renames save when you leave the name. Deleting removes the label from every conversation.</InfoNote>
      </SheetBody>
    </CommsSheet>
  );
}

// ---- Labels picker ------------------------------------------------------------------------------
/**
 * mode "toggle" (in a conversation): tap adds or removes.
 * mode "add" (from the list): tap adds; labels already on it show ticked.
 * mode "bulk": tap adds to every selected conversation.
 */
export function LabelPickSheet({ open, onClose, mode, names, catalog, current, count, onPick, onNew }: { open: boolean; onClose: () => void; mode: "toggle" | "add" | "bulk"; names: string[]; catalog: MailLabel[]; current: string[]; count?: number; onPick: (name: string, on: boolean) => void; onNew: (() => void) | null }) {
  const rows: RowSpec[] = names.map((n) => {
    const on = mode !== "bulk" && current.some((c) => c.toLowerCase() === n.toLowerCase());
    return { key: n, label: n, dot: labelColor(n, catalog), check: on, pressed: on, disabled: mode === "add" && on, onClick: () => onPick(n, on) };
  });
  if (onNew) rows.push({ key: "__new", label: "New label", icon: Plus, onClick: onNew });
  return (
    <CommsSheet open={open} onClose={onClose} title={mode === "bulk" ? `Label ${count} ${count === 1 ? "conversation" : "conversations"}` : "Labels"} sub={mode === "bulk" ? "Adds the label to every selected conversation" : mode === "add" ? "Tap to add. Remove a label inside the conversation." : "Tap to add or remove"}>
      <SheetBody>
        {rows.length ? <RowGroup rows={rows} /> : <div style={{ fontSize: 12.5, color: C.muted }}>No labels yet.</div>}
      </SheetBody>
    </CommsSheet>
  );
}

