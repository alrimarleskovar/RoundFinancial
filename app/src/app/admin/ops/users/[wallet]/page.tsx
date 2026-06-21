"use client";

// /admin/ops/users/[wallet] — behavioral profile (the credit data, auth-only).
// Score/level = CANONICAL on-chain ReputationProfile (RPC). Behavioral
// metrics = derived from events, marked "derived · experimental". Chain-truth
// Member counters shown alongside for cross-check. i18n via @/lib/i18n.

import Link from "next/link";
import { useParams } from "next/navigation";

import { useApi } from "@/lib/admin/useApi";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { BehavioralScoreCard } from "@/components/adminops/BehavioralScoreCard";
import {
  agoLabel,
  Empty,
  fmtDuration,
  MonoLabel,
  Pill,
  Section,
  StatCard,
  tableHeadStyles,
  TimingPill,
} from "@/components/adminops/ui";
import { shortAddr } from "@/lib/wallet";

interface Timeline {
  txSig: string;
  eventType: string;
  poolPda: string;
  cycle: number;
  deltaSeconds: number | null;
  graceUsed: boolean;
  defaultReason: string | null;
  defaultReasonProvenance: string | null;
}
interface Reputation {
  exists: boolean;
  level: number;
  score: string;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
}
interface ProfileResponse {
  wallet: string;
  firstEventUnix: number | null;
  pools: { total: number; active: number; completed: number };
  chainCounters: {
    onTimeCount: number;
    lateCount: number;
    contributionsPaid: number;
    defaultedMemberships: number;
  };
  behavioral: {
    timedContributions: number;
    onTime: number;
    late: number;
    graceUsed: number;
    onTimeRateBps: number | null;
    avgDelaySecondsLate: number | null;
    defaults: number;
    hadSetback: boolean;
    recovered: boolean;
  };
  reputation: Reputation | null;
  timeline: Timeline[];
  indexer: { lastProjectionUnix: number | null };
}

export default function UserProfilePage() {
  const { tokens } = useTheme();
  const t = useT();
  const TH = tableHeadStyles(tokens);
  const params = useParams<{ wallet: string }>();
  const wallet = params.wallet;
  const { data, loading, error, status } = useApi<ProfileResponse>(`/api/admin/users/${wallet}`);
  const ago = (u: number | null) => t("adminops.ago", { v: agoLabel(u) });

  if (loading)
    return <div style={{ color: tokens.muted, fontSize: 13 }}>{t("adminops.loading")}</div>;
  if (status === 404) return <Empty>{t("adminops.user.notFound")}</Empty>;
  if (error || !data) return <Empty>{t("adminops.user.err", { err: error ?? "—" })}</Empty>;

  const { behavioral: b, chainCounters: cc, reputation: rep } = data;
  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
  } as const;
  const ageSecs =
    data.firstEventUnix != null ? Math.floor(Date.now() / 1000) - data.firstEventUnix : null;
  const td: React.CSSProperties = {
    padding: "10px 12px",
    borderTop: `1px solid ${tokens.border}`,
    fontSize: 13,
    color: tokens.text,
    fontVariantNumeric: "tabular-nums",
  };
  const experimental = <Pill text={t("adminops.experimental")} color={tokens.purple} />;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/admin/ops/users"
          style={{ fontSize: 12, color: tokens.muted, textDecoration: "none" }}
        >
          {t("adminops.user.back")}
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <MonoLabel>{shortAddr(wallet, 10, 10)}</MonoLabel>
          {rep ? (
            <Pill text={t("adminops.user.levelOnchain", { lv: rep.level })} color={tokens.green} />
          ) : null}
        </div>
      </div>

      <Section title={t("adminops.user.repTitle")}>
        {rep == null ? (
          <Empty>{t("adminops.user.repUnavailable")}</Empty>
        ) : (
          <div style={grid}>
            <StatCard
              label={t("adminops.user.repLevel")}
              value={rep.level}
              sub={rep.exists ? t("adminops.user.repProfile") : t("adminops.user.repFresh")}
            />
            <StatCard
              label={t("adminops.user.repScore")}
              value={rep.score}
              sub={t("adminops.user.repScoreSub")}
            />
            <StatCard label={t("adminops.user.repOnTime")} value={rep.onTimePayments} />
            <StatCard label={t("adminops.user.repLate")} value={rep.latePayments} />
            <StatCard
              label={t("adminops.user.repDefaults")}
              value={rep.defaults}
              tone={rep.defaults === 0 ? "muted" : "default"}
            />
          </div>
        )}
      </Section>

      <BehavioralScoreCard wallet={wallet} />

      <Section title={t("adminops.user.basic")}>
        <div style={grid}>
          <StatCard
            label={t("adminops.user.age")}
            value={fmtDuration(ageSecs)}
            sub={t("adminops.user.ageSub")}
          />
          <StatCard
            label={t("adminops.col.pools")}
            value={data.pools.total}
            sub={t("adminops.user.poolsSub", { a: data.pools.active, c: data.pools.completed })}
          />
        </div>
      </Section>

      <Section title={t("adminops.user.behavioral")} note={experimental}>
        {b.timedContributions === 0 ? (
          <Empty>{t("adminops.user.behavioralEmpty")}</Empty>
        ) : (
          <div style={grid}>
            <StatCard
              label={t("adminops.col.onTime")}
              value={b.onTimeRateBps == null ? "—" : `${(b.onTimeRateBps / 100).toFixed(0)}%`}
              sub={`${b.onTime}/${b.timedContributions}`}
            />
            <StatCard
              label={t("adminops.user.late")}
              value={b.late}
              sub={t("adminops.user.lateSub", { g: b.graceUsed })}
              tone={b.late === 0 ? "muted" : "default"}
            />
            <StatCard
              label={t("adminops.user.avgDelay")}
              value={fmtDuration(b.avgDelaySecondsLate)}
              sub={t("adminops.user.avgDelaySub")}
            />
            <StatCard
              label={t("adminops.col.defaults")}
              value={b.defaults}
              tone={b.defaults === 0 ? "muted" : "default"}
            />
            <StatCard
              label={t("adminops.user.recovery")}
              value={
                !b.hadSetback
                  ? t("adminops.user.recoveryNa")
                  : b.recovered
                    ? t("adminops.user.recoveryYes")
                    : t("adminops.user.recoveryNo")
              }
              sub={
                !b.hadSetback
                  ? t("adminops.user.recoveryNoSetback")
                  : t("adminops.user.recoverySub")
              }
              tone={b.hadSetback && b.recovered ? "default" : "muted"}
            />
          </div>
        )}
      </Section>

      <Section title={t("adminops.user.crossCheck")} note={t("adminops.user.crossCheckNote")}>
        <div style={grid}>
          <StatCard
            label={t("adminops.col.onTime")}
            value={`${cc.onTimeCount} / ${b.onTime}`}
            sub={
              cc.onTimeCount === b.onTime ? t("adminops.user.chainEq") : t("adminops.user.chainNe")
            }
            tone={cc.onTimeCount === b.onTime ? "muted" : "default"}
          />
          <StatCard
            label={t("adminops.col.late")}
            value={`${cc.lateCount} / ${b.late}`}
            sub={cc.lateCount === b.late ? t("adminops.user.chainEq") : t("adminops.user.chainNe")}
            tone={cc.lateCount === b.late ? "muted" : "default"}
          />
          <StatCard label={t("adminops.user.contribsChain")} value={cc.contributionsPaid} />
          <StatCard
            label={t("adminops.user.defaultedMemberships")}
            value={cc.defaultedMemberships}
            tone={cc.defaultedMemberships === 0 ? "muted" : "default"}
          />
        </div>
      </Section>

      <Section
        title={t("adminops.user.timeline")}
        note={t("adminops.user.timelineNote", { ago: ago(data.indexer.lastProjectionUnix) })}
      >
        {data.timeline.length === 0 ? (
          <Empty>{t("adminops.user.timelineEmpty")}</Empty>
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
                <tr style={TH.row}>
                  <th style={{ ...TH.cell, paddingLeft: 16 }}>{t("adminops.col.pool")}</th>
                  <th style={TH.cell}>{t("adminops.col.cycle")}</th>
                  <th style={TH.cell}>{t("adminops.col.event")}</th>
                  <th style={TH.cell}>{t("adminops.col.timing")}</th>
                  <th style={TH.cell}>{t("adminops.col.delta")}</th>
                  <th style={TH.cell}>{t("adminops.col.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {data.timeline.map((e) => (
                  <tr key={`${e.txSig}-${e.eventType}`}>
                    <td style={{ ...td, paddingLeft: 16 }}>
                      <Link
                        href={`/admin/ops/pools/${e.poolPda}`}
                        style={{ color: tokens.text2, textDecoration: "none" }}
                      >
                        <MonoLabel>{shortAddr(e.poolPda, 4, 4)}</MonoLabel>
                      </Link>
                    </td>
                    <td style={td}>{e.cycle}</td>
                    <td style={td}>{e.eventType}</td>
                    <td style={td}>
                      <TimingPill
                        eventType={e.eventType}
                        deltaSeconds={e.deltaSeconds}
                        graceUsed={e.graceUsed}
                      />
                    </td>
                    <td style={{ ...td, color: tokens.muted }}>
                      {e.deltaSeconds == null
                        ? "—"
                        : e.deltaSeconds <= 0
                          ? `−${fmtDuration(-e.deltaSeconds)}`
                          : `+${fmtDuration(e.deltaSeconds)}`}
                    </td>
                    <td style={{ ...td, color: tokens.muted, fontSize: 12 }}>
                      {e.defaultReason
                        ? `${e.defaultReason} (${e.defaultReasonProvenance?.toLowerCase() ?? "inferred"})`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
