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
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";
import type { RawMemberView, RawPoolView } from "@roundfi/sdk";

// Claim-payout modal — the symmetric companion to PayInstallmentModal.
// Dual mode:
//   - **chain**: all of memberRecord/pool/seedKey are passed → fires
//     a real claim_payout(cycle) tx via the wallet adapter.
//   - **mock**: those props are omitted → fires `session.claimPayoutMock`
//     (mock reducer) on a 1500ms timeout. Used by Demo Studio scenarios
//     where the contemplated user clicks Receber but no wallet is
//     connected to the matching on-chain member.

export interface ClaimPayoutModalProps {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
  /** Chain-mode: the connected member record (must equal current_cycle's slot). */
  memberRecord?: RawMemberView;
  /** Chain-mode: the live pool view. */
  pool?: RawPoolView;
  /** Chain-mode: DEVNET_POOLS key (matches group.devnetPool). */
  seedKey?: keyof typeof DEVNET_POOLS;
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
  const { claimPayoutMock } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  const connectedWallet = adapter.publicKey;
  const chainMode = !!(pool && memberRecord && seedKey);
  // Credit amount sourcing: chain mode reads from on-chain pool, mock
  // mode falls back to the fixture's prize (already BRL) and converts
  // back to USDC for the breakdown line.
  const creditUsdc = chainMode ? Number(pool!.creditAmount) / 1e6 : group.prize / USDC_RATE;
  const creditBrl = chainMode ? creditUsdc * USDC_RATE : group.prize;
  const slotIndexDisplay = chainMode ? memberRecord!.slotIndex : "—";
  const cycleDisplay = chainMode ? pool!.currentCycle : group.month;
  const cyclesTotalDisplay = chainMode ? pool!.cyclesTotal : group.total;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setChainError(null);

    if (
      chainMode &&
      connectedWallet &&
      adapter.sendTransaction &&
      pool &&
      memberRecord &&
      seedKey
    ) {
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
      return;
    }

    // Mock mode — Demo Studio scenarios + any non-chain caller.
    setTimeout(() => {
      claimPayoutMock(group);
      setSubmitting(false);
      setDone(true);
    }, 1500);
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
                slot {slotIndexDisplay} · ciclo {cycleDisplay + 1}/{cyclesTotalDisplay}
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
          {chainMode ? (
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
                Wallet {shortAddr(connectedWallet?.toBase58() ?? "")} (slot {slotIndexDisplay}) é o
                slot contemplado do ciclo {cycleDisplay}. Confirmar dispara{" "}
                <code style={{ color: tokens.purple }}>claim_payout(cycle={cycleDisplay})</code> no
                devnet — Pool PDA assina a transferência USDC.
              </span>
            </div>
          ) : (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: tokens.fillSoft,
                border: `1px solid ${tokens.borderStr}`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.purple}>
                MODO DEMO
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                Cenário do Demo Studio. Confirmar dispara o `claim_payout` mock — credita o prêmio
                no saldo da sessão. A versão on-chain (com wallet conectada num pool deployed) envia
                uma tx real assinada pelo Phantom.
              </span>
            </div>
          )}

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
            <li>
              {chainMode ? `${creditUsdc.toFixed(2)} USDC` : fmtMoney(creditBrl)} sai do pool float,
              vai para a sua wallet
            </li>
            <li>
              <code>pool.current_cycle</code> avança {cycleDisplay} → {cycleDisplay + 1}
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
