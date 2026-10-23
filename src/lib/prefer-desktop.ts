// Phones, foldables, iPads and Android tablets are sent from the desktop shell to the /m mobile app. "Open the full
// desktop app" (/m More) sets this flag so the redirect lets them through;
// "Back to mobile app" (desktop shell) clears it.
// ponytail: sessionStorage, so the choice lasts until the tab / installed app
// is closed and a desktop link opened in a new tab lands on /m again. Move to
// localStorage if people want the choice remembered.
const KEY = "hookka.preferDesktop";

const PHONE_UA = /Android|iPhone|iPod|Mobile/i;
const IPAD_UA = /iPad/i;
const MAC_UA = /Macintosh/i;

/** True for phone-class browsers. Android tablets match too (their UA carries
 * "Android" with or without "Mobile"). Kept for callers that only need the UA. */
export function isPhoneUa(ua: string): boolean {
  return PHONE_UA.test(ua);
}

/**
 * Phone, foldable, iPad or Android tablet: the devices that use /m by default.
 *
 * iPadOS 13+ sends a desktop "Macintosh" UA, so the UA alone cannot tell it
 * from a Mac. A real Mac reports 0 touch points and an iPad reports 5, so
 * "Macintosh + maxTouchPoints > 1" is the iPad signal. Anything ambiguous (touch
 * points unknown, or a Windows / Linux / ChromeOS touch laptop) is NOT
 * mobile-class: desktop and laptop users must never be redirected by a guess.
 */
export function isMobileClassDevice(ua: string, maxTouchPoints?: number): boolean {
  if (PHONE_UA.test(ua) || IPAD_UA.test(ua)) return true;
  return MAC_UA.test(ua) && typeof maxTouchPoints === "number" && maxTouchPoints > 1;
}

/** The desktop shell's gate: mobile-class devices go to /m unless they chose desktop. */
export function shouldRedirectToMobile(
  ua: string,
  preferDesktop: boolean,
  maxTouchPoints?: number,
): boolean {
  return isMobileClassDevice(ua, maxTouchPoints) && !preferDesktop;
}

export function prefersDesktop(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setPreferDesktop(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the phone simply stays on /m */
  }
}
