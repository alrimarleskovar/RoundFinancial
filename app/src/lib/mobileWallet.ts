"use client";

/**
 * Mobile wallet-environment detection + in-app-browser deep links.
 *
 * THE problem (root-caused live by the team, reproduced 3x across
 * wallets): on a phone, connecting through plain Safari/Chrome makes the
 * wallet sign in a SEPARATE process (the extension/injected provider
 * relays the tx to the wallet app and waits for the signature to come
 * back). That relay sometimes returns incomplete — the tx reaches the
 * network without the wallet's signature and fails with
 * "Signature verification failed. Missing signature for public key
 * [...]" — AFTER our pre-sign simulation already passed, so the account
 * itself is fine. Inside the wallet's OWN in-app browser (Phantom →
 * Explorar, Solflare → Browser) the provider signs in-process, same as
 * a desktop extension: works first try.
 *
 * This is ecosystem-known, not ours: Phantom's support docs tell mobile
 * users to use the in-app browser, Trust Wallet's Jupiter guide
 * instructs the same, and wallet-adapter has an open request (since
 * 2022) for native mobile detection + deep-link redirect. No library
 * solves it for us — so this module is that detection, and the
 * MobileWalletBanner + per-modal error classification are the guidance.
 *
 * Deep links are HTTPS universal links, so they degrade gracefully:
 * with the wallet app installed they open THIS page inside its in-app
 * browser; without it they land on the wallet's site (install prompt).
 */

const WALLET_UA_MARKERS = /phantom|solflare|trustwallet|trust\/|backpack|okapp|okx/i;

export function isMobileUA(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Wallet in-app browsers stamp their name into the user agent — that is
 * the reliable signal. (Checking for an injected `window.phantom` is NOT:
 * the mobile Safari/Chrome extension also injects it, and that is exactly
 * the broken relay path we're steering people away from.)
 */
export function isWalletInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return WALLET_UA_MARKERS.test(navigator.userAgent);
}

/** Phone + NOT inside a wallet's in-app browser ⇒ signatures ride the
 *  unreliable cross-process relay ⇒ steer to the in-app browser. */
export function needsWalletBrowserRedirect(): boolean {
  return isMobileUA() && !isWalletInAppBrowser();
}

function currentHref(): string {
  return typeof window === "undefined" ? "https://roundfi.app" : window.location.href;
}

function currentOrigin(): string {
  return typeof window === "undefined" ? "https://roundfi.app" : window.location.origin;
}

/** Open THIS page inside Phantom's in-app browser (documented `ul/browse`
 *  universal link). */
export function phantomBrowseUrl(target: string = currentHref()): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(
    currentOrigin(),
  )}`;
}

/** Open THIS page inside Solflare's in-app browser (`ul/v1/browse`). */
export function solflareBrowseUrl(target: string = currentHref()): string {
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(
    currentOrigin(),
  )}`;
}

/**
 * Classifier for the relay failure. It surfaces AFTER simulation passed,
 * so "your wallet didn't return the signature" is the truthful message —
 * never "insufficient funds" or a raw base58 dump.
 */
export function isMissingSignatureError(blob: string): boolean {
  return /missing signature|signature verification failed/i.test(blob);
}
