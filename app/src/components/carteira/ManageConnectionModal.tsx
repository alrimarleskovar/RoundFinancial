"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { Modal } from "@/components/ui/Modal";
import type { ConnSpec, ConnMeta } from "@/components/carteira/ConnectionCard";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Connection management view — read-only inspector for the
// connected provider. Exposes the meta rows + permissions the
// provider has, plus a demo callout for the settings flow that
// ships post-M3 (the indexer + SDK round-trips will surface real
// last-sync timestamps then).

export function ManageConnectionModal({
  conn,
  meta,
  permissions,
  open,
  onClose,
}: {
  conn: ConnSpec | null;
  meta: ConnMeta[];
  permissions: string[];
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();

  if (!conn) return null;

  const accent = ((): string => {
    switch (conn.tone) {
      case "g":
        return tokens.green;
      case "t":
        return tokens.teal;
      case "p":
        return tokens.purple;
      case "a":
        return tokens.amber;
      case "r":
        return tokens.red;
    }
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modal.manage.title", { name: conn.name })}
      subtitle={conn.tagline}
      width={460}
    >
      {/* Status badge */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px",
          borderRadius: 999,
          background: `${tokens.green}14`,
          border: `1px solid ${tokens.green}33`,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 10,
          color: tokens.green,
          letterSpacing: "0.08em",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: tokens.green,
            display: "inline-block",
          }}
        />
        {t("modal.manage.connected")}
      </div>

      {/* Meta rows */}
      {meta.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <MonoLabel size={9}>{t("modal.manage.metaTitle")}</MonoLabel>
          <div
            style={{
              marginTop: 6,
              padding: 14,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {meta.map((m, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    color: tokens.muted,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontSize: 10,
                  }}
                >
                  {m.l}
                </span>
                <span
                  style={{
                    color: tokens.text,
                    fontFamily: m.mono
                      ? "var(--font-jetbrains-mono), JetBrains Mono, monospace"
                      : "var(--font-dm-sans), DM Sans, sans-serif",
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {m.v}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Permissions */}
      {permissions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <MonoLabel size={9}>{t("modal.manage.permsTitle")}</MonoLabel>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {permissions.map((p, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.5,
                }}
              >
                <Icons.check size={12} stroke={accent} sw={2.4} />
                <span>{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Demo callout */}
      <div
        style={{
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: 10,
          background: `${tokens.amber}14`,
          border: `1px solid ${tokens.amber}33`,
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <MonoLabel size={9} color={tokens.amber}>
          {t("modal.manage.demoBadge")}
        </MonoLabel>
        <span style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
          {t("modal.manage.demoBody")}
        </span>
      </div>

      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 18,
          width: "100%",
          padding: 11,
          borderRadius: 11,
          background: tokens.fillMed,
          color: tokens.text,
          border: `1px solid ${tokens.borderStr}`,
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        }}
      >
        {t("modal.manage.close")}
      </button>
    </Modal>
  );
}
