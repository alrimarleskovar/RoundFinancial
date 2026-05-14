"use client";

import { useEffect, useState } from "react";

import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { classifyHostname } from "@/lib/domainPinning";

// PhishingBanner — top-of-page warning when the user is on a
// non-canonical domain. Mitigates T1 from
// docs/security/frontend-security-checklist.md (typo-squat phishing).
//
// SSR-safe: renders nothing on first render (matches SSR) and decides
// post-hydration based on `window.location.hostname`. The flicker is
// intentional and acceptable — false-positive flashes on canonical
// domains are NOT acceptable (would train users to ignore the warning).

export function PhishingBanner() {
  const { tokens } = useTheme();
  const t = useT();
  const [status, setStatus] = useState<"loading" | "canonical" | "preview" | "unknown">("loading");
  const [hostname, setHostname] = useState<string>("");

  useEffect(() => {
    const result = classifyHostname();
    if (result.kind === "unknown") {
      setStatus("unknown");
      setHostname(result.hostname);
    } else if (result.kind === "preview") {
      setStatus("preview");
      setHostname(result.hostname);
    } else {
      setStatus("canonical");
    }
  }, []);

  if (status === "loading" || status === "canonical") return null;

  if (status === "preview") {
    // Soft hint — preview deployments are legitimate but the user
    // should know they're not on the canonical URL.
    return (
      <div
        role="status"
        style={{
          padding: "6px 12px",
          background: `${tokens.teal}1A`,
          borderBottom: `1px solid ${tokens.teal}55`,
          color: tokens.teal,
          fontSize: 11,
          fontWeight: 600,
          textAlign: "center",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        }}
      >
        {t("phishing.previewBanner", { host: hostname })}
      </div>
    );
  }

  // status === "unknown" — possible phishing
  return (
    <div
      role="alert"
      style={{
        padding: "10px 16px",
        background: `${tokens.red}1A`,
        borderBottom: `2px solid ${tokens.red}`,
        color: tokens.red,
        fontSize: 12,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
      }}
    >
      <Icons.info size={14} stroke={tokens.red} />
      <span>{t("phishing.unknownBanner", { host: hostname })}</span>
    </div>
  );
}
