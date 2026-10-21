# Bug log — one file per bug

Each new bug is its own file here, named by its id: `BUG-YYYY-MM-DD-NNN.md`. Start it with
the same heading the archive uses, so a search for the id finds it:

    ## BUG-2026-10-21-381 — what went wrong `module` `area` 🟡

then the entry as you would have written it in `docs/BUG-HISTORY.md` (the archive, up to
BUG-2026-10-21-380). Newest-first order is the file name order reversed.

Why files: two branches inserting entries at the same spot in one ledger conflict on every
merge. Two new files never do. Two branches that pick the SAME number now meet as an
add/add conflict on the file name, which is the collision surfacing early instead of a
silent duplicate. `scripts/check-docs-freshness.mjs` still fails on a duplicate id across
the archive and this folder.
