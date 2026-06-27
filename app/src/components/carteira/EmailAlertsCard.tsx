"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { SegToggle } from "@/components/layout/SegToggle";
import { useI18n, useT } from "@/lib/i18n";
import { useEmailSubscription, type EmailLang } from "@/lib/notifications/useEmailSubscription";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { useWallet } from "@/lib/wallet";

// Email-notification opt-in card (Conexões tab). A connected wallet registers
// an email for protocol alerts (due dates, new pools, score) by SIGNING a
// challenge — same SIWS trust model as the admin console, proving the wallet
// owns the address. Dark unless NEXT_PUBLIC_EMAIL_NOTIFICATIONS_ENABLED=true
// (paired with the server's EMAIL_NOTIFICATIONS_ENABLED). The send side is a
// later PR; this is the cadastro surface.

const ENABLED = process.env.NEXT_PUBLIC_EMAIL_NOTIFICATIONS_ENABLED === "true";

// Light client-side format gate (the server validator is authoritative).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function EmailAlertsCard() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { lang: uiLang } = useI18n();
  const wallet = useWallet();
  const sub = useEmailSubscription();
  const [email, setEmail] = useState("");
  const [lang, setLang] = useState<EmailLang>(uiLang === "en" ? "en" : "pt");

  // Feature dark by default — render nothing until the operator enables it.
  if (!ENABLED) return null;

  const connected = wallet.status === "connected";
  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = connected && sub.canSign && emailValid && !sub.busy;

  const errMsg = (() => {
    switch (sub.error) {
      case null:
        return null;
      case "connect_wallet":
        return t("notify.email.connect");
      case "wallet_cannot_sign":
        return t("notify.email.noSign");
      case "invalid_email":
        return t("notify.email.errEmail");
      case "feature_disabled":
        return t("notify.email.errOff");
      case "rate_limited":
        return t("notify.email.errRate");
      default:
        return t("notify.email.errGeneric");
    }
  })();

  return (
    <div style={{ ...glass, padding: 18, borderRadius: 14 }}>
      <MonoLabel color={tokens.teal}>{t("notify.email.badge")}</MonoLabel>
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 16,
          fontWeight: 700,
          color: tokens.text,
          marginTop: 10,
        }}
      >
        {t("notify.email.title")}
      </div>
      <div style={{ fontSize: 12, color: tokens.text2, marginTop: 6, lineHeight: 1.5 }}>
        {t("notify.email.body")}
      </div>

      {sub.state === "subscribed" ? (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: `${tokens.green}14`,
              border: `1px solid ${tokens.green}33`,
              fontSize: 12,
              color: tokens.text,
              lineHeight: 1.5,
            }}
          >
            {t("notify.email.subscribed", { email: email.trim() })}
          </div>
          <button
            type="button"
            onClick={() => void sub.unsubscribe(email.trim())}
            disabled={sub.busy}
            style={{
              marginTop: 10,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: sub.busy ? "default" : "pointer",
              fontSize: 11,
              color: tokens.muted,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              textDecoration: "underline",
            }}
          >
            {sub.busy ? t("notify.email.signing") : t("notify.email.unsub")}
          </button>
        </div>
      ) : sub.state === "unsubscribed" ? (
        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            borderRadius: 10,
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            fontSize: 12,
            color: tokens.text2,
          }}
        >
          {t("notify.email.unsubscribed")}
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("notify.email.placeholder")}
            aria-label={t("notify.email.title")}
            style={{
              width: "100%",
              padding: "11px 12px",
              borderRadius: 10,
              background: tokens.fillSoft,
              border: `1px solid ${
                email.length === 0 || emailValid ? tokens.border : `${tokens.red}55`
              }`,
              color: tokens.text,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 12,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <MonoLabel size={9}>{t("notify.email.lang")}</MonoLabel>
            <SegToggle
              value={lang}
              onChange={(v) => setLang(v as EmailLang)}
              options={[
                { v: "pt", l: "PT" },
                { v: "en", l: "EN" },
              ]}
            />
          </div>
          <button
            type="button"
            onClick={() => void sub.subscribe(email.trim(), lang)}
            disabled={!canSubmit}
            style={{
              width: "100%",
              padding: 11,
              borderRadius: 11,
              background: tokens.green,
              color: "#04110a",
              border: "none",
              fontWeight: 700,
              fontSize: 12,
              cursor: canSubmit ? "pointer" : "default",
              opacity: canSubmit ? 1 : 0.45,
              fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
            }}
          >
            {sub.busy ? t("notify.email.signing") : t("notify.email.cta")}
          </button>
          {!connected && (
            <div style={{ fontSize: 11, color: tokens.muted, lineHeight: 1.4 }}>
              {t("notify.email.connect")}
            </div>
          )}
        </div>
      )}

      {errMsg && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: tokens.red,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            lineHeight: 1.4,
          }}
        >
          {errMsg}
        </div>
      )}
    </div>
  );
}
