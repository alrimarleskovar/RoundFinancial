"use client";

import { useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { sendClaimPayout } from "@/lib/claim-payout";
import type { ActiveGroup } from "@/data/groups";
import { DEVNET_POOLS } from "@/lib/devnet";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";
import type { RawMemberView, RawPoolView } from "@roundfi/sdk";

// Claim-payout modal — the symmetric companion to PayInstallmentModal.
// Renders only when the connected wallet's `member.slot_index` equals
// `pool.current_cycle` AND `!member.paid_out` (the natural "it's your
// turn" state). Caller (FeaturedGroup) is responsible for the
// gating; this component just renders the modal + dispatches the tx.

export interface ClaimPayoutModalProps {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
  /** The connected member record (must equal pool.current_cycle's slot). */
  memberRecord: RawMemberView;
  /** The live pool view — credit amount + cycle metadata read from chain. */
  pool: RawPoolView;
  /** DEVNET_POOLS key (matches group.devnetPool). */
  seedKey: keyof typeof DEVNET_POOLS;
}

export function ClaimPayoutModal({
  group,
  open,
  onClose,
  memberRecord,
  pool,
  seedKey,
}: ClaimPayoutModalProps) {
  const { tokens } = useTheme();
  const { fmtMoney } = useI18n();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const { explorerTx } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  const connectedWallet = adapter.publicKey;
  const creditUsdc = Number(pool.creditAmount) / 1e6;
  const creditBrl = creditUsdc * USDC_RATE;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!connectedWallet || !adapter.sendTransaction) return;
    setSubmitting(true);
    setChainError(null);

    try {
      const sig = await sendClaimPayout({
        connection,
        sendTransaction: adapter.sendTransaction,
        pool: DEVNET_POOLS[seedKey].pda,
        memberWallet: connectedWallet as PublicKey,
        cycle: pool.currentCycle,
        slotIndex: memberRecord.slotIndex,
      });
      setTxSig(sig);
      setSubmitting(false);
      setDone(true);
    } catch (err) {
      const e = err as { message?: string; logs?: string[]; cause?: unknown };
      const parts: string[] = [];
      if (e.message) parts.push(e.message);
      if (Array.isArray(e.logs) && e.logs.length > 0) {
        parts.push("logs:\n" + e.logs.join("\n"));
      }
      if (e.cause) parts.push("cause: " + String(e.cause));
      if (parts.length === 0) parts.push(String(err));
      // eslint-disable-next-line no-console
      console.error("[RoundFi] claim_payout failed:", err);
      setChainError(parts.join("\n"));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : "Receber pagamento"}
      subtitle={done ? undefined : "Você foi sorteado neste ciclo"}
      closeable={!submitting}
      width={480}
    >
      {done ? (
        <ModalSuccess
          title="Crédito recebido!"
          body={
            txSig ? (
              <>
                {fmtMoney(creditBrl, { noCents: true })} foi transferido para sua wallet.
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
              "O crédito foi transferido para sua wallet."
            )
          }
          cta={
            <button type="button" onClick={reset} style={primaryBtn(tokens)}>
              Fechar
            </button>
          }
        />
      ) : (
        <>
          {/* Group + slot context */}
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
                background: `${tokens.purple}1A`,
                border: `1px solid ${tokens.purple}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              {group.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MonoLabel size={9}>GRUPO</MonoLabel>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{group.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                slot {memberRecord.slotIndex} · ciclo {pool.currentCycle + 1}/{pool.cyclesTotal}
              </div>
            </div>
          </div>

          {/* Amount hero */}
          <div
            style={{
              padding: 18,
              borderRadius: 14,
              background: `linear-gradient(145deg, ${tokens.purple}26, ${tokens.surface1} 80%)`,
              border: `1px solid ${tokens.purple}55`,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <MonoLabel size={9} color={tokens.purple}>
              VOCÊ RECEBE
            </MonoLabel>
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
              {fmtMoney(creditBrl)}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {creditUsdc.toFixed(2)} USDC do `pool_usdc_vault` → sua ATA
            </div>
          </div>

          {/* On-chain banner */}
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 10,
              background: `${tokens.purple}14`,
              border: `1px solid ${tokens.purple}33`,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <MonoLabel size={9} color={tokens.purple}>
              ON-CHAIN
            </MonoLabel>
            <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
              Wallet {shortAddr(connectedWallet?.toBase58() ?? "")} (slot {memberRecord.slotIndex})
              é o slot contemplado do ciclo {pool.currentCycle}. Confirmar dispara{" "}
              <code style={{ color: tokens.purple }}>claim_payout(cycle={pool.currentCycle})</code>{" "}
              no devnet — Pool PDA assina a transferência USDC.
            </span>
          </div>

          {/* What happens (mini bullet list) */}
          <MonoLabel size={9}>O QUE ACONTECE</MonoLabel>
          <ul
            style={{
              marginTop: 8,
              marginBottom: 18,
              paddingLeft: 18,
              fontSize: 11,
              color: tokens.text2,
              lineHeight: 1.7,
            }}
          >
            <li>{creditUsdc.toFixed(2)} USDC sai do pool float, vai para sua ATA</li>
            <li>
              <code>pool.current_cycle</code> avança {pool.currentCycle} → {pool.currentCycle + 1}
            </li>
            <li>
              <code>member.paid_out</code> = true (não pode reclamar duas vezes)
            </li>
            <li>`SCHEMA_CYCLE_COMPLETE` attestation é gravada no seu reputation profile</li>
          </ul>

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

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              style={{
                ...primaryBtn(tokens),
                background: `linear-gradient(135deg, ${tokens.purple}, ${tokens.teal})`,
                opacity: submitting ? 0.45 : 1,
                cursor: submitting ? "default" : "pointer",
              }}
            >
              {submitting ? "Processando…" : "Confirmar recebimento"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
