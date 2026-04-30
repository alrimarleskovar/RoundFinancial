"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

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

  if (!group) return null;

  const tc = ((): string => {
    switch (group.tone) {
      case "g": return tokens.green;
      case "t": return tokens.teal;
      case "p": return tokens.purple;
      case "a": return tokens.amber;
      case "r": return tokens.red;
    }
  })();

  const fillPct = (group.filled / group.total) * 100;
  const groupEvents = events.filter((e) =>
    e.target.toLowerCase().includes(group.name.toLowerCase()) ||
    (group.name.toLowerCase().includes("·") &&
      e.target.toLowerCase().includes(group.name.split("·")[0]!.trim().toLowerCase()))
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group.name}
      subtitle={t("groups.details.subtitle", {
        m: group.months,
        f: group.filled,
        total: group.total,
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
        <Stat
          label={t("groups.details.fill")}
          value={`${group.filled}/${group.total}`}
          color={tokens.text2}
        />
      </div>

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
        {groupEvents.length === 0 ? (
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
            {groupEvents.slice(0, 5).map((e) => (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.4,
                }}
              >
                <span>{kindLabel(e.kind, t)}</span>
                <span
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    color: e.amountBrl >= 0 ? tokens.green : tokens.text,
                    fontWeight: 600,
                  }}
                >
                  {e.amountBrl >= 0 ? "+" : ""}
                  {fmtMoney(e.amountBrl, { noCents: true, signed: true })}
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
    case "payment": return t("groups.details.act.payment");
    case "purchase": return t("groups.details.act.purchase");
    case "sale": return t("groups.details.act.sale");
    case "join": return t("groups.details.act.join");
    case "yield": return t("groups.details.act.yield");
    default: return kind;
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
