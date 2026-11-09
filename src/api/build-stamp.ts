// Overwritten by .github/workflows/deploy.yml just before `pages deploy` with
// the commit being shipped, so GET /api/health answers "which code is live?"
// (Houzs review list, owner 2026-11-08). Locally it stays "dev".
export const BUILD_COMMIT = "dev";
