"use client";

import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { ActiveGroup } from "@/data/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

// Pay-installment modal. Shows the active group + installment amount
// + Triple Shield breakdown (65 / 30 / 5).

const SHIELD_SPLITS = [
  { key: "escrow", pct: 65 },
  { key: "vault", pct: 30 },
  { key: "fee", pct: 5 },
] as const;

export function PayInstallmentModal({
  group,
  open,
  onClose,
}: {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { payInstallment, user, monthsPaidByGroup } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // `group` is the static fixture; live progress comes from session.
  // effectiveMonth is the month the user is *about to pay for*. When
  // it equals group.total the cycle is fully funded — no more parcelas.
  const paidExtra = monthsPaidByGroup[group.name] ?? 0;
  const effectiveMonth = Math.min(group.total, group.month + paidExtra);
  const cycleDone = effectiveMonth >= group.total;
  const insufficient = user.balance < group.installment;
  const blocked = cycleDone || insufficient;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    onClose();
  };

  const handleConfirm = () => {
    if (blocked) return;
    setSubmitting(true);
    setTimeout(() => {
      payInstallment(group);
      setSubmitting(false);
      setDone(true);
    }, 1500);
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : t("modal.pay.title")}
      subtitle={done ? undefined : t("modal.pay.subtitle")}
      closeable={!submitting}
      width={480}
    >
      {done ? (
        <ModalSuccess
          title={t("modal.pay.success.title")}
          body={t("modal.pay.success.body")}
          cta={
            <button type="button" onClick={reset} style={primaryBtn(tokens)}>
              {t("modal.close")}
            </button>
          }
        />
      ) : (
        <>
          {/* Group + month */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 12,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: `${tokens.green}1A`,
                border: `1px solid ${tokens.green}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              {group.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MonoLabel size={9}>{t("modal.pay.group")}</MonoLabel>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{group.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("modal.pay.month", { m: effectiveMonth, t: group.total })} ·{" "}
                {t("modal.pay.due", { d: group.nextDue })}
              </div>
            </div>
          </div>

          {/* Amount hero */}
          <div
            style={{
              padding: 18,
              borderRadius: 14,
              background: `linear-gradient(145deg, ${tokens.navyDeep}, ${tokens.surface1} 80%)`,
              border: `1px solid ${tokens.border}`,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <MonoLabel size={9}>{t("modal.pay.amount")}</MonoLabel>
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 40,
                fontWeight: 800,
                color: tokens.text,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                marginTop: 6,
              }}
            >
              {fmtMoney(group.installment)}
            </div>
          </div>

          {/* Triple Shield breakdown */}
          <MonoLabel size={9}>{t("modal.pay.breakdown")}</MonoLabel>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ flex: 65, background: tokens.green }} />
            <div style={{ flex: 30, background: tokens.teal }} />
            <div style={{ flex: 5, background: tokens.purple }} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
              marginBottom: 18,
            }}
          >
            {SHIELD_SPLITS.map((s) => {
              const c =
                s.key === "escrow" ? tokens.green : s.key === "vault" ? tokens.teal : tokens.purple;
              return (
                <div key={s.key}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 2,
                        background: c,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                        fontSize: 10,
                        color: c,
                        fontWeight: 600,
                      }}
                    >
                      {s.pct}%
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: tokens.text2, marginTop: 2 }}>
                    {t(`modal.pay.breakdown.${s.key}`)}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: tokens.text,
                      marginTop: 2,
                    }}
                  >
                    {fmtMoney((group.installment * s.pct) / 100, {
                      noCents: true,
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Block reasons (cycle done / insufficient balance) */}
          {blocked && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.red}14`,
                border: `1px solid ${tokens.red}33`,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.red}>
                {cycleDone ? "CICLO COMPLETO" : "SALDO INSUFICIENTE"}
              </MonoLabel>
              <span
                style={{
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.5,
                }}
              >
                {cycleDone
                  ? `Você já pagou todas as ${group.total} parcelas deste ciclo.`
                  : `Saldo atual ${fmtMoney(user.balance, { noCents: true })} — adicione fundos pela tela de Carteira.`}
              </span>
            </div>
          )}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || blocked}
              style={{
                ...primaryBtn(tokens),
                opacity: submitting || blocked ? 0.45 : 1,
                cursor: submitting || blocked ? "default" : "pointer",
              }}
            >
              {submitting ? t("modal.processing") : t("modal.pay.cta")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
