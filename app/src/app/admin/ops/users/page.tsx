"use client";

// /admin/ops/users — indexed wallets with a behavioral summary. Identity =
// wallet (per-wallet on-chain reputation; no cross-wallet linking). Rows
// link to the behavioral profile.

import Link from "next/link";

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { agoLabel, Empty, MonoLabel, Pill, Section } from "@/components/adminops/ui";
import { shortAddr } from "@/lib/wallet";

interface UserRow {
  wallet: string;
  pools: number;
  level: number;
  timedContributions: number;
  onTime: number;
  onTimeRateBps: number | null;
  defaults: number;
}
interface UsersResponse {
  users: UserRow[];
  indexer: { lastUpdateUnix: number | null; lastProjectionUnix: number | null };
  servedAtUnix: number;
}

const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  padding: "0 12px 10px",
};

export default function UsersPage() {
  const { tokens } = useTheme();
  const t = useT();
  const { data, loading, error } = useApi<UsersResponse>("/api/admin/users");
  const ago = (u: number | null) => t("adminops.ago", { v: agoLabel(u) });

  if (loading)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (error || !data) return <Empty>{t("adminops.users.err", { err: error ?? "—" })}</Empty>;

  const td: React.CSSProperties = {
    padding: "12px",
    borderTop: `1px solid ${tokens.border}`,
    fontSize: 13,
    color: tokens.text,
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <Section
      title={t("adminops.users.title")}
      note={t("adminops.users.note", {
        n: data.users.length,
        ago: ago(data.indexer.lastProjectionUnix),
      })}
    >
      {data.users.length === 0 ? (
        <Empty>{t("adminops.users.empty")}</Empty>
      ) : (
        <div
          style={{
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            overflow: "hidden",
            background: tokens.surface1,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: tokens.muted }}>
                <th style={{ ...TH, paddingLeft: 16 }}>{t("adminops.col.wallet")}</th>
                <th style={TH}>{t("adminops.col.level")}</th>
                <th style={TH}>{t("adminops.col.pools")}</th>
                <th style={TH}>{t("adminops.col.onTime")}</th>
                <th style={TH}>{t("adminops.col.defaults")}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.wallet}>
                  <td style={{ ...td, paddingLeft: 16 }}>
                    <Link
                      href={`/admin/ops/users/${u.wallet}`}
                      style={{ color: tokens.text, textDecoration: "none" }}
                    >
                      <MonoLabel>{shortAddr(u.wallet, 6, 6)}</MonoLabel>
                    </Link>
                  </td>
                  <td style={td}>
                    <span style={{ color: tokens.muted }}>L</span>
                    {u.level}
                  </td>
                  <td style={td}>{u.pools}</td>
                  <td style={td}>
                    {u.onTimeRateBps == null ? (
                      <span style={{ color: tokens.muted }}>—</span>
                    ) : (
                      <>
                        {(u.onTimeRateBps / 100).toFixed(0)}%
                        <span style={{ color: tokens.muted, fontSize: 12 }}>
                          {" "}
                          ({u.onTime}/{u.timedContributions})
                        </span>
                      </>
                    )}
                  </td>
                  <td style={td}>
                    {u.defaults > 0 ? (
                      <Pill text={String(u.defaults)} color={tokens.red} />
                    ) : (
                      <span style={{ color: tokens.muted }}>0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
