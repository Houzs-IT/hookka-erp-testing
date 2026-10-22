// The desktop shell's phone gate (src/lib/prefer-desktop.ts).
//
// BUG-2026-10-02-250: "Open the full desktop app" in /m More went to /dashboard,
// and the desktop shell sent every phone straight back to /m, so the link
// never worked. A phone that chose desktop must now get through.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMobileClassDevice, shouldRedirectToMobile } from "../src/lib/prefer-desktop.ts";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

test("phones go to /m by default", () => {
  assert.equal(shouldRedirectToMobile(ANDROID, false), true);
  assert.equal(shouldRedirectToMobile(IPHONE, false), true);
});

test("a phone that chose the desktop site stays on it", () => {
  assert.equal(shouldRedirectToMobile(ANDROID, true), false);
  assert.equal(shouldRedirectToMobile(IPHONE, true), false);
});

const OLD_IPAD = "Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const FOLD = "Mozilla/5.0 (Linux; Android 14; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const CROS = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

test("desktops never redirect", () => {
  assert.equal(shouldRedirectToMobile(DESKTOP, false, 0), false);
  assert.equal(shouldRedirectToMobile(DESKTOP, false), false);
});

test("iPadOS (Macintosh UA + touch points) goes to /m; a Mac does not", () => {
  assert.equal(shouldRedirectToMobile(IPADOS, false, 5), true);
  assert.equal(shouldRedirectToMobile(IPADOS, false, 0), false);
});

test("ambiguous devices stay on desktop", () => {
  assert.equal(shouldRedirectToMobile(IPADOS, false), false, "touch points unknown");
  assert.equal(shouldRedirectToMobile(IPADOS, false, 1), false, "a single touch point is not an iPad");
  assert.equal(shouldRedirectToMobile(DESKTOP, false, 10), false, "Windows touch laptop");
  assert.equal(shouldRedirectToMobile(CROS, false, 10), false, "ChromeOS");
});

test("old iPad UA, Android tablet and foldable go to /m", () => {
  assert.equal(shouldRedirectToMobile(OLD_IPAD, false), true);
  assert.equal(shouldRedirectToMobile(ANDROID_TABLET, false), true);
  assert.equal(shouldRedirectToMobile(FOLD, false), true);
});

test("the desktop choice lets every mobile-class device through (no redirect loop)", () => {
  for (const [ua, pts] of [[IPHONE, 5], [IPADOS, 5], [OLD_IPAD, 5], [ANDROID_TABLET, 5], [FOLD, 5]]) {
    assert.equal(isMobileClassDevice(ua, pts), true);
    assert.equal(shouldRedirectToMobile(ua, true, pts), false);
  }
});

test("tablet rail has an Open desktop app link that sets the flag first", () => {
  const rail = readFileSync(new URL("../src/pages/m/components/LeftRail.tsx", import.meta.url), "utf8");
  assert.match(rail, /href="\/dashboard"\s*onClick=\{\(\) => setPreferDesktop\(true\)\}/);
  assert.match(rail, /aria-label="Open desktop app"/);
});

test("desktop shell shows the way back to /m for every mobile-class device", () => {
  const dl = readFileSync(new URL("../src/layouts/DashboardLayout.tsx", import.meta.url), "utf8");
  assert.match(dl, /mobileClassOnDesktop && \(/);
  assert.match(dl, /onClick=\{\(\) => setPreferDesktop\(false\)\}/);
});
