// ---------------------------------------------------------------------------
// One auto-sent email (desktop OutboxDetailView, read-only): status, recipient,
// the time that fits the status, attempts, the error, the body (sandboxed
// HTML or text) and the attachment downloads (GET /outbox/:id/attachments/:i/download).
// ---------------------------------------------------------------------------
import { useMemo, useRef } from "react";
import { CircleAlert, CloudOff, Download, FileText, RotateCw } from "lucide-react";
import { useCachedJson } from "@/lib/cached-fetch";
import { C, Column, CommsScreen, GhostButton, PageBar, PrimaryButton, Skeletons, StateCard } from "../comms-kit";
import { emailSrcDoc, fullWhen, looksLikeHtml, outboxStatusLabel, outboxWhen, type OutboxDetail } from "./mail-lib";
import { MiniPill } from "./mail-ui";
import { outboxTone } from "./MailList";

export function MailOutboxDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useCachedJson<OutboxDetail>(`/api/mail-center/outbox/${encodeURIComponent(id)}`, 60);
  const d = q.data;
  const [fg, bg] = outboxTone(d?.status ?? "");
  const html = d ? d.bodyHtml?.trim() || (looksLikeHtml(d.bodyText) ? d.bodyText.trim() : "") : "";
  const w = d ? outboxWhen(d) : null;
  return (
    <CommsScreen>
      <PageBar title="Auto-sent email" onBack={onBack} backLabel="Back to auto-sent"
        right={d ? <MiniPill fg={fg} bg={bg} h={24} size={11.5}><span style={{ width: 6, height: 6, borderRadius: "50%", background: fg }} />{outboxStatusLabel(d.status)}</MiniPill> : null} />
      <Column max={760}>
        <div style={{ padding: "0 16px 40px", display: "flex", flexDirection: "column", gap: 12 }}>
          {!d ? (
            q.error ? (
              <StateCard icon={CloudOff} tone="red" role="alert" title="Couldn't load this email" text={q.error}
                action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}><PrimaryButton height={44} icon={RotateCw} onClick={() => q.refresh()} style={{ width: "auto", padding: "0 20px", borderRadius: 999, fontSize: 13.5 }}>Try again</PrimaryButton><GhostButton height={44} onClick={onBack}>Back</GhostButton></div>} />
            ) : <Skeletons label="Loading email" n={2} h={120} />
          ) : (
            <>
              <section style={{ borderRadius: 18, background: C.card, boxShadow: "var(--c-sh-info)", overflow: "hidden" }}>
                {[["Status", outboxStatusLabel(d.status)], ["To", d.toAddress || "(no recipient)"], [w!.label, fullWhen(w!.at) || "—"], ["Attempts", String(d.attempts ?? 0)]].map(([k, v], i) => (
                  <div key={k} style={{ display: "flex", gap: 10, padding: "10px 14px", borderTop: i ? `1px solid ${C.hair}` : "none" }}>
                    <span style={{ width: 88, flex: "none", fontSize: 12, color: C.muted }}>{k}</span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 13, fontWeight: 600, lineHeight: 1.4, wordBreak: "break-word" }}>{v}</span>
                  </div>
                ))}
              </section>
              {(d.status || "").toUpperCase() === "FAILED" && d.lastError ? (
                <div role="alert" style={{ display: "flex", gap: 8, padding: "10px 12px", borderRadius: 12, background: C.redBg, color: C.red, fontSize: 12.5, lineHeight: 1.45, wordBreak: "break-word" }}>
                  <CircleAlert size={16} strokeWidth={2} style={{ flex: "none" }} /><span>{d.lastError}</span>
                </div>
              ) : null}
              <section style={{ borderRadius: 18, background: C.card, boxShadow: "var(--mc-msg-sh)", padding: "13px 14px" }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, wordBreak: "break-word" }}>{d.subject || "(no subject)"}</div>
                {html ? <Frame html={html} /> : <div style={{ marginTop: 8, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{d.bodyText?.trim() || "(empty)"}</div>}
                {d.attachmentNames?.length ? (
                  <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                    {d.attachmentNames.map((n, i) => (
                      <a key={`${n}-${i}`} href={`/api/mail-center/outbox/${encodeURIComponent(id)}/attachments/${i}/download`} download={n}
                        style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 46, padding: "6px 10px", borderRadius: 12, background: "var(--mc-file-bg)", boxShadow: "var(--mc-file-ring)", textDecoration: "none", color: C.ink }}>
                        <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: C.redBg, display: "flex", alignItems: "center", justifyContent: "center" }}><FileText size={15} strokeWidth={2} color="var(--c-red)" /></span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n}</span>
                        <Download size={15} strokeWidth={2} color="var(--c-gold-mid)" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          )}
        </div>
      </Column>
    </CommsScreen>
  );
}

function Frame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => emailSrcDoc(html), [html]);
  return (
    <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc}
      onLoad={() => {
        try {
          const b = ref.current?.contentWindow?.document.body;
          if (b && ref.current) ref.current.style.height = `${Math.min(b.scrollHeight + 8, 4000)}px`;
        } catch {
          /* keep the minimum height */
        }
      }}
      style={{ display: "block", width: "100%", minHeight: 80, marginTop: 10, border: "none", borderRadius: 10, background: "#FFFFFF", boxShadow: "var(--mc-frame-ring)" }} />
  );
}
