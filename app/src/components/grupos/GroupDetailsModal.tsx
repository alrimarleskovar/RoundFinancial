"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { useMyDevnetTxHistory } from "@/lib/useMyDevnetTxHistory";
import { usePool } from "@/lib/usePool";

// "Ver detalhes" panel for groups the user has already joined
// (either via the regular Join flow or a /mercado purchase). Shows
// the full economic snapshot — installment, prize, monthly schedule,
// fill ratio — plus the user's recent ledger activity tied to this
// group (payments + secondary-market events).
//
// On-chain: this is the surface that will render from
// `getPoolState(pubkey)` once the Anchor program ships in M2.

export function GroupDetailsModal({
  group,
  open,
  onClose,
}: {
  group: CatalogGroup | null;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const { fmtMoney } = useI18n();
  const t = useT();
  const { events } = useSession();
  // Live on-chain state for devnet-linked groups — members joined, Forming vs
  // Active status, and the cycle clock. The hook must run before the early
  // return; the "pool1" arg is inert when the group isn't devnet-linked.
  const live = usePool(group?.devnetPool ?? "pool1");
  // Durable on-chain ledger for THIS pool (Member-PDA scan), so the activity
  // list survives a reload and shows real payments — not just this session's
  // optimistic events.
  const history = useMyDevnetTxHistory();

  if (!group) return null;

  const liveOn = !!group.devnetPool && live.status === "ok" && !!live.pool;
  const pool = liveOn ? live.pool : null;
  // Devnet cards show REAL members_joined/target; fixtures keep their static
  // fill. This is what lets the first joiner watch the pool fill toward start
  // instead of staring at a stale "0/5" (or a bogus "5/5").
  const filled = pool ? pool.membersJoined : group.filled;
  const total = pool ? pool.membersTarget : group.total;
  const forming = pool ? pool.status === "forming" : false;
  const active = pool ? pool.status === "active" : false;
  const remaining = Math.max(0, total - filled);
  const cycleDays = pool ? Math.max(1, Math.round(Number(pool.cycleDurationSec) / 86_400)) : 0;
  const nextDueDays =
    pool && active && pool.nextCycleAt > 0n
      ? Math.max(0, Math.ceil((Number(pool.nextCycleAt) * 1000 - Date.now()) / 86_400_000))
      : null;

  const tc = ((): string => {
    switch (group.tone) {
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

  const fillPct = total > 0 ? (filled / total) * 100 : 0;
  const groupEvents = events.filter(
    (e) =>
      e.target.toLowerCase().includes(group.name.toLowerCase()) ||
      (group.name.toLowerCase().includes("·") &&
        e.target.toLowerCase().includes(group.name.split("·")[0]!.trim().toLowerCase())),
  );

  // Unified ledger: durable on-chain rows for this pool first (the source of
  // truth), then session events the chain scan hasn't caught yet (deduped by
  // signature), newest-first.
  const realLedger = (
    group.devnetPool ? history.txs.filter((tx) => tx.seedKey === group.devnetPool) : []
  ).map((tx) => ({ id: tx.addr, label: tx.label, amountBrl: tx.amount, ts: tx.ts ?? 0 }));
  const realSigs = new Set(realLedger.map((r) => r.id));
  const sessionLedger = groupEvents
    .filter((e) => !realSigs.has(e.txid))
    .map((e) => ({ id: e.id, label: kindLabel(e.kind, t), amountBrl: e.amountBrl, ts: e.ts ?? 0 }));
  const ledgerRows = [...realLedger, ...sessionLedger].sort((a, b) => b.ts - a.ts).slice(0, 6);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group.name}
      subtitle={t("groups.details.subtitle", {
        m: group.months,
        f: filled,
        total,
      })}
      width={560}
    >
      {/* Header strip with emoji + level pill */}
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          background: `${tc}0F`,
          border: `1px solid ${tc}40`,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: `${tc}1F`,
            border: `1px solid ${tc}55`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}
        >
          {group.emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 20,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.02em",
            }}
          >
            {group.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: tokens.muted,
              marginTop: 4,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t(`cat.${group.category}`)} · {t(`groups.lvl${group.level}`)}
          </div>
        </div>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: `${tokens.green}1F`,
            border: `1px solid ${tokens.green}55`,
            color: tokens.green,
            fontSize: 9,
            fontWeight: 700,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          ◆ {t("groups.card.joined")}
        </span>
      </div>

      {/* Economic snapshot */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <Stat
          label={t("home.meta.prize")}
          value={fmtMoney(group.prize, { noCents: true })}
          color={tokens.text}
          emphasis
        />
        <Stat
          label={t("home.installment")}
          value={fmtMoney(group.installment, { noCents: true })}
          color={tokens.text}
          emphasis
        />
        <Stat
          label={t("groups.details.duration")}
          value={t("groups.details.months", { m: group.months })}
          color={tokens.text2}
        />
        <Stat label={t("groups.details.fill")} value={`${filled}/${total}`} color={tokens.text2} />
      </div>

      {/* On-chain status — Forming progress (how full, how many to start, when
          the first installment lands) or the Active cycle clock. Devnet pools
          only; the whole point is letting the joiner PREPARE instead of being
          surprised by a payment they didn't expect. */}
      {pool && (forming || active) ? (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            background: forming ? `${tokens.amber}12` : `${tokens.green}12`,
            border: `1px solid ${forming ? tokens.amber : tokens.green}33`,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: forming ? tokens.amber : tokens.green,
                boxShadow: `0 0 8px ${forming ? tokens.amber : tokens.green}`,
              }}
            />
            <MonoLabel size={9} color={forming ? tokens.amber : tokens.green}>
              {forming ? t("groups.details.forming.title") : t("groups.details.active.title")}
            </MonoLabel>
          </div>
          <div style={{ fontSize: 12, color: tokens.text, fontWeight: 600 }}>
            {forming
              ? t("groups.details.forming.line", { f: filled, t: total, r: remaining })
              : t("groups.details.active.line", { c: pool.currentCycle + 1, t: total })}
          </div>
          <div style={{ fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
            {forming
              ? t("groups.details.forming.prep", { d: cycleDays })
              : t("groups.details.active.next", { d: nextDueDays ?? cycleDays })}
          </div>
        </div>
      ) : null}

      {/* Fill bar */}
      <div style={{ marginTop: 14 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 6,
          }}
        >
          <MonoLabel size={9}>{t("groups.details.fillLabel")}</MonoLabel>
          <span
            style={{
              fontSize: 11,
              color: tokens.text2,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {fillPct.toFixed(0)}%
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: tokens.fillMed,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${fillPct}%`,
              height: "100%",
              background: tc,
              transition: "width 200ms ease",
            }}
          />
        </div>
      </div>

      {/* Recent ledger activity for this group */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          borderRadius: 12,
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
        }}
      >
        <MonoLabel size={9} color={tokens.muted}>
          {t("groups.details.activity")}
        </MonoLabel>
        {ledgerRows.length === 0 ? (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: tokens.muted,
              lineHeight: 1.5,
            }}
          >
            {t("groups.details.activityEmpty")}
          </div>
        ) : (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {ledgerRows.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.4,
                }}
              >
                <span>{row.label}</span>
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    color: row.amountBrl >= 0 ? tokens.green : tokens.text,
                    fontWeight: 600,
                  }}
                >
                  {row.amountBrl >= 0 ? "+" : ""}
                  {fmtMoney(row.amountBrl, { noCents: true, signed: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action row */}
      <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            flex: 1,
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
          {t("groups.details.close")}
        </button>
      </div>
    </Modal>
  );
}

function kindLabel(kind: string, t: (k: string) => string): string {
  switch (kind) {
    case "payment":
      return t("groups.details.act.payment");
    case "purchase":
      return t("groups.details.act.purchase");
    case "sale":
      return t("groups.details.act.sale");
    case "join":
      return t("groups.details.act.join");
    case "yield":
      return t("groups.details.act.yield");
    default:
      return kind;
  }
}

function Stat({
  label,
  value,
  color,
  emphasis,
}: {
  label: string;
  value: string;
  color: string;
  emphasis?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 9,
          color: tokens.muted,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: emphasis
            ? "var(--font-syne), Syne"
            : "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: emphasis ? 22 : 13,
          fontWeight: emphasis ? 800 : 600,
          color,
          letterSpacing: emphasis ? "-0.02em" : 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}
