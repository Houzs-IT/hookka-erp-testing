// ---------------------------------------------------------------------------
// grid-shared-layouts.tsx — the "Team layouts" block inside the DataGrid's
// Columns panel (review G6; Houzs#5221). Lists the grid's layouts shared with
// the whole team, each with a "Shared" tag and who shared it; one click
// switches your columns to it. "Share current layout" names your current
// columns and shares them. Only the author or an admin sees Update / Delete
// on a layout (the server decides, `canEdit`, and refuses anyone else).
//
// Fetched when the panel opens, not on every grid mount, so the list page's
// hot path is unchanged. Rules: src/lib/grid-shared-layouts.ts. Server:
// src/api/routes/datagrid-layouts.ts (/shared).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { fetchJson, passthrough } from "@/lib/fetch-json";
import { useToast } from "@/components/ui/toast";
import {
  cleanSharedLayoutName,
  sortSharedLayouts,
  type SharedLayout,
} from "@/lib/grid-shared-layouts";

// fetchJson throws with the server's own sentence ("Only the person who
// shared this layout…", the 409 duplicate name) already in `.message`.
function responseErrorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** The grid's shared layouts, sorted by name; an empty list on any failure. */
async function fetchSharedLayouts(gridId: string): Promise<SharedLayout[]> {
  try {
    const res = (await fetchJson(
      `/api/datagrid-layouts?gridId=${encodeURIComponent(gridId)}`,
      passthrough,
    )) as { shared?: SharedLayout[] };
    return sortSharedLayouts(Array.isArray(res?.shared) ? res.shared : []);
  } catch {
    return [];
  }
}

export type LayoutSnapshot = {
  visibleCols: string[];
  colOrder: string[];
  colWidths: Record<string, string>;
};

export function GridSharedLayouts({
  gridId,
  current,
  onApply,
}: {
  gridId: string;
  /** The columns on screen now (what Share / Update saves). */
  current: () => LayoutSnapshot;
  /** Switch this grid to a shared layout (becomes the user's own layout). */
  onApply: (layout: SharedLayout) => void;
}) {
  const { toast } = useToast();
  const [layouts, setLayouts] = useState<SharedLayout[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLayouts(await fetchSharedLayouts(gridId));
  }, [gridId]);

  useEffect(() => {
    let cancelled = false;
    void fetchSharedLayouts(gridId).then((list) => {
      if (!cancelled) setLayouts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [gridId]);

  const share = async () => {
    const named = cleanSharedLayoutName(name);
    if ("error" in named) {
      toast.error(named.error);
      return;
    }
    setBusy(true);
    try {
      await fetchJson(`/api/datagrid-layouts/shared`, passthrough, {
        method: "POST",
        body: { gridId, name: named.name, ...current() },
      });
      toast.success(`Shared "${named.name}" with the team`);
      setNaming(false);
      setName("");
      await load();
    } catch (e) {
      toast.error(responseErrorText(e, "Could not share the layout"));
    } finally {
      setBusy(false);
    }
  };

  const update = async (l: SharedLayout) => {
    setBusy(true);
    try {
      await fetchJson(`/api/datagrid-layouts/shared/${encodeURIComponent(l.id)}`, passthrough, {
        method: "PUT",
        body: { gridId, ...current() },
      });
      toast.success(`"${l.name}" now has your current columns`);
      await load();
    } catch (e) {
      toast.error(responseErrorText(e, "Could not update the shared layout"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (l: SharedLayout) => {
    setBusy(true);
    try {
      await fetchJson(
        `/api/datagrid-layouts/shared/${encodeURIComponent(l.id)}?gridId=${encodeURIComponent(gridId)}`,
        passthrough,
        { method: "DELETE" },
      );
      toast.success(`Stopped sharing "${l.name}"`);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(responseErrorText(e, "Could not delete the shared layout"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-[#E5E5E5] px-3 py-2 space-y-1.5" data-testid="grid-shared-layouts">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#888]">Team layouts</div>
      {layouts === null && <div className="text-[11px] text-[#999]">Loading…</div>}
      {layouts !== null && layouts.length === 0 && (
        <div className="text-[11px] text-[#999]">No shared layouts on this list yet.</div>
      )}
      {layouts?.map((l) => (
        <div key={l.id} className="group">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-[12px] text-[#333] hover:text-[#6B5C32] hover:underline"
              title={`Switch to "${l.name}"${l.createdByName ? ` (shared by ${l.createdByName})` : ""}`}
              onClick={() => {
                onApply(l);
                toast.success(`Switched to "${l.name}"`);
              }}
            >
              {l.name}
            </button>
            <span className="shrink-0 rounded bg-[#EEF2FF] px-1 py-px text-[9px] font-semibold uppercase text-[#4338CA]">
              Shared
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#999]">
            <span className="truncate">{l.createdByName ? `by ${l.createdByName}` : ""}</span>
            {l.canEdit && confirmDelete !== l.id && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className="ml-auto text-[#6B5C32] hover:underline disabled:opacity-50"
                  title="Replace this shared layout with the columns on screen now"
                  onClick={() => void update(l)}
                >
                  Update
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="text-[#B91C1C] hover:underline disabled:opacity-50"
                  onClick={() => setConfirmDelete(l.id)}
                >
                  Delete
                </button>
              </>
            )}
            {l.canEdit && confirmDelete === l.id && (
              <>
                <span className="ml-auto text-[#B91C1C]">Stop sharing?</span>
                <button
                  type="button"
                  disabled={busy}
                  className="font-semibold text-[#B91C1C] hover:underline disabled:opacity-50"
                  onClick={() => void remove(l)}
                >
                  Yes
                </button>
                <button type="button" className="hover:underline" onClick={() => setConfirmDelete(null)}>
                  No
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {naming ? (
        <div className="flex items-center gap-1 pt-1">
          <input
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void share();
              if (e.key === "Escape") {
                e.stopPropagation();
                setNaming(false);
              }
            }}
            placeholder="Layout name"
            className="min-w-0 flex-1 rounded border border-[#D0D0D0] px-1.5 py-0.5 text-[11px] outline-none focus:border-[#6B5C32]"
          />
          <button
            type="button"
            disabled={busy}
            className="rounded bg-[#6B5C32] px-2 py-0.5 text-[11px] text-white hover:bg-[#4D4224] disabled:opacity-50"
            onClick={() => void share()}
          >
            Share
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1.5 pt-1 text-[11px] font-medium text-[#6B5C32] hover:underline"
          title="Name the columns on screen now and share them with everyone"
          onClick={() => setNaming(true)}
        >
          + Share current layout
        </button>
      )}
    </div>
  );
}
