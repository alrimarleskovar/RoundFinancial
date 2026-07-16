"use client";

import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import {
  needsWalletBrowserRedirect,
  phantomBrowseUrl,
  solflareBrowseUrl,
} from "@/lib/mobileWallet";
import { useTheme } from "@/lib/theme";

// One-tap steer to the wallet's in-app browser — the launch-critical
// guidance for the "Missing signature" mobile relay failure (see
// lib/mobileWallet.ts for the root cause). Shown ONLY on a phone browser
// that is NOT a wallet's in-app browser; the deep-link buttons reopen the
// CURRENT page inside Phantom/Solflare, so the user lands exactly where
// they were. Dismissible per session — a visitor just browsing shouldn't
// be nagged, but every fresh session gets warned before their first sign.

const DISMISS_KEY = "roundfi.mobileWalletBanner.dismissed";

export function MobileWalletBanner() {
  const t = useT();
  const { tokens } = useTheme();
  // Render nothing until mounted — UA detection is client-only and must
  // not desync SSR hydration.
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // sessionStorage unavailable (private mode) — still show the banner.
    }
    setShow(needsWalletBrowserRedirect());
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // best-effort — worst case the banner reappears on next navigation
    }
    setShow(false);
  };

  const linkBtn: React.CSSProperties = {
    flex: 1,
    textAlign: "center",
    padding: "10px 12px",
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 800,
    textDecoration: "none",
    color: "#1A1200",
    background: tokens.amber ?? "#FFB547",
  };

  return (
    <div
      style={{
        margin: "10px 12px 0",
        padding: "12px 14px",
        borderRadius: 14,
        border: `1px solid ${tokens.amber ?? "#FFB547"}55`,
        background: `${tokens.amber ?? "#FFB547"}14`,
        color: tokens.text,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800 }}>📱 {t("wallet.mobileBanner.title")}</div>
      <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.55, color: tokens.text2 }}>
        {t("wallet.mobileBanner.body")}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {/* Universal links — same page reopened inside the wallet's browser. */}
        <a href={phantomBrowseUrl()} style={linkBtn}>
          {t("wallet.mobileBanner.phantom")}
        </a>
        <a href={solflareBrowseUrl()} style={linkBtn}>
          {t("wallet.mobileBanner.solflare")}
        </a>
      </div>
      <button
        type="button"
        onClick={dismiss}
        style={{
          marginTop: 8,
          width: "100%",
          background: "transparent",
          border: "none",
          color: tokens.muted,
          fontSize: 11,
          textDecoration: "underline",
          cursor: "pointer",
        }}
      >
        {t("wallet.mobileBanner.dismiss")}
      </button>
    </div>
  );
}
