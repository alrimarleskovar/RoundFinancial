"use client";

import { useMemo, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { ATTESTATION_SCHEMA } from "@roundfi/sdk";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { IntentPanel } from "@/components/ui/IntentPanel";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { sendContribute } from "@/lib/contribute";
import type { ActiveGroup } from "@/data/groups";
import { DEVNET_POOLS } from "@/lib/devnet";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { usePool, usePoolMembers } from "@/lib/usePool";
import { shortAddr, useWallet } from "@/lib/wallet";

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
  onSuccess,
}: {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
  // Fired right after a successful contribute() tx. Parents pass this
  // to trigger an eager re-fetch of their own usePool/usePoolMembers
  // so the dial advances in ~1s instead of waiting for the next 30s
  // poll. The modal also refreshes its own hooks unconditionally.
  onSuccess?: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { payInstallment, user, monthsPaidByGroup } = useSession();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const wallet = useWallet();
  const { explorerTx } = wallet;
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  // ─── On-chain mode detection ─────────────────────────────────────────
  // We attempt a real contribute() tx only when ALL of these hold:
  //   - the fixture has a devnetPool pointer,
  //   - usePool returns the pool live (active + cycle metadata),
  //   - the connected wallet is one of the materialized members,
  //   - and the user hasn't paid this cycle yet (member.contributions_paid
  //     < pool.current_cycle + 1 → falls out of the program's WrongCycle
  //     guard naturally).
  // Otherwise the modal falls back to the original mock 1500ms timeout
  // so localhost/demo flows are unchanged.
  const seedKey = group.devnetPool;
  const onChainPool = usePool(seedKey ?? "pool1");
  const onChainMembers = usePoolMembers(seedKey ?? "pool1");
  const connectedWallet = adapter.publicKey;
  const memberRecord = useMemo(() => {
    if (!seedKey || !connectedWallet) return null;
    if (onChainMembers.status !== "ok") return null;
    return onChainMembers.members.find((m) => m.wallet.equals(connectedWallet)) ?? null;
  }, [seedKey, connectedWallet, onChainMembers]);
  const onChainReady =
    !!seedKey &&
    onChainPool.status === "ok" &&
    !!onChainPool.pool &&
    onChainPool.pool.status === "active" &&
    !!memberRecord &&
    !memberRecord.defaulted;

  // `group` is the static fixture; live progress comes from session.
  // effectiveMonth is the month the user is *about to pay for*. When
  // it equals group.total the cycle is fully funded — no more parcelas.
  const paidExtra = monthsPaidByGroup[group.name] ?? 0;
  const effectiveMonth = Math.min(group.total, group.month + paidExtra);
  const cycleDone = effectiveMonth >= group.total;
  // Block on insufficient balance only in mock mode — on-chain mode
  // checks the real USDC ATA inside the program (InsufficientStake
  // error) so the front-end fixture balance is irrelevant there.
  const insufficient = !onChainReady && user.balance < group.installment;
  const blocked = cycleDone || insufficient;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (blocked) return;
    setSubmitting(true);
    setChainError(null);

    if (onChainReady && memberRecord && onChainPool.pool && adapter.sendTransaction) {
      try {
        // Schema selection mirrors contribute.rs:
        //   on_time = clock.unix_timestamp <= pool.next_cycle_at
        //   schema  = on_time ? SCHEMA_PAYMENT (1) : SCHEMA_LATE (2)
        // The attestation PDA seeds include the schema id, so the
        // off-chain derivation MUST match what the on-chain handler
        // will write or the AccountAlreadyInitialized / seed-mismatch
        // preflight rejects.
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        const onTime = nowSec <= onChainPool.pool.nextCycleAt;
        const schemaId = onTime ? ATTESTATION_SCHEMA.Payment : ATTESTATION_SCHEMA.Late;
        const sig = await sendContribute({
          connection,
          sendTransaction: adapter.sendTransaction,
          pool: DEVNET_POOLS[seedKey!].pda,
          memberWallet: connectedWallet as PublicKey,
          cycle: onChainPool.pool.currentCycle,
          slotIndex: memberRecord.slotIndex,
          schemaId,
        });
        setTxSig(sig);
        // Mirror the mock-mode session bookkeeping so any UI piece
        // reading session state advances immediately.
        payInstallment(group);
        // Eager on-chain re-fetch — both the modal's own copy and the
        // parent's (via onSuccess). Without this the FeaturedGroup dial
        // stays stale for up to 30s after a successful pay.
        void onChainPool.refresh();
        void onChainMembers.refresh();
        onSuccess?.();
        setSubmitting(false);
        setDone(true);
      } catch (err) {
        // Phantom + wallet-adapter often surface a generic "Unexpected
        // error" while the actual program revert log lives on
        // `err.logs` or `err.cause`. Concatenate everything we can
        // reach so the modal banner is diagnosable instead of opaque.
        const e = err as { message?: string; logs?: string[]; cause?: unknown };
        const parts: string[] = [];
        if (e.message) parts.push(e.message);
        if (Array.isArray(e.logs) && e.logs.length > 0) {
          parts.push("logs:\n" + e.logs.join("\n"));
        }
        if (e.cause) parts.push("cause: " + String(e.cause));
        if (parts.length === 0) parts.push(String(err));
        // eslint-disable-next-line no-console
        console.error("[RoundFi] contribute failed:", err);
        setChainError(parts.join("\n"));
        setSubmitting(false);
      }
      return;
    }

    // Mock fallback — preserves the original demo flow exactly.
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
          body={
            txSig ? (
              <>
                {t("modal.pay.success.body")}
                <a
                  href={explorerTx(txSig)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 12,
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 11,
                    color: tokens.green,
                    background: `${tokens.green}1a`,
                    border: `1px solid ${tokens.green}55`,
                    textDecoration: "none",
                  }}
                >
                  on-chain tx · {shortAddr(txSig, 6, 6)}
                </a>
              </>
            ) : (
              t("modal.pay.success.body")
            )
          }
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

          {/* On-chain mode banner — only when wallet matches a pool member */}
          {onChainReady && memberRecord && onChainPool.pool ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.green}14`,
                border: `1px solid ${tokens.green}33`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.green}>
                ON-CHAIN
              </MonoLabel>
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.5,
                }}
              >
                Wallet conectada (slot {memberRecord.slotIndex} ·{" "}
                {shortAddr(connectedWallet?.toBase58() ?? "")}) é membro do Pool{" "}
                {onChainPool.pool.seedId.toString()}. Confirmar dispara{" "}
                <code style={{ color: tokens.green }}>
                  contribute(cycle={onChainPool.pool.currentCycle})
                </code>{" "}
                no devnet.
              </span>
            </div>
          ) : null}

          {chainError ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.red}14`,
                border: `1px solid ${tokens.red}33`,
                fontSize: 11,
                color: tokens.text2,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                wordBreak: "break-word",
              }}
            >
              <MonoLabel size={9} color={tokens.red}>
                TX FAILED
              </MonoLabel>
              <div style={{ marginTop: 4 }}>{chainError}</div>
            </div>
          ) : null}

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

          {/* Pre-sign intent panel (#249 W3) — gated on on-chain mode.
              Renders authoritative tx summary inside our UI so the user
              has a reference to cross-check Phantom's prompt against
              (phishing-resistance). Hidden in mock mode since no real
              tx fires. */}
          {onChainReady && !blocked && (
            <IntentPanel
              action="contribute"
              amountUsdc={Number(onChainPool.pool!.installmentAmount) / 1e6}
              poolLabel={group.name}
              network={wallet.network}
              walletLabel={wallet.walletLabel}
              isHardware={wallet.isHardware}
              isUnknownWallet={wallet.isUnknownWallet}
            />
          )}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
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
