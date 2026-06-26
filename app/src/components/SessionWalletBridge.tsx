"use client";

// SessionWalletBridge — overlays the connected wallet's REAL on-chain data
// (reputation score/level, USDC balance) onto the in-memory session `user`,
// so the authenticated dashboard reflects the actual wallet instead of the
// old static "Maria Luísa" persona.
//
// Mounted once inside the wallet-adapter tree (so it can read useWallet /
// useConnection) but below SessionProvider (so it can dispatch). It NO-OPS
// while a Demo Studio persona is loaded (pitch mode) — the demo owns the
// session then.
//
// A fresh wallet reads as a true zero profile (level 1 / score 0 / R$ 0); as
// it gains an on-chain ReputationProfile and USDC those numbers fill in for
// real. Fields with no on-chain source (display name, accrued yield) stay
// empty/zero rather than fabricated.

import { useEffect } from "react";

import { computeLevel, useSession } from "@/lib/session";
import { useWallet, shortAddr } from "@/lib/wallet";
import { useReputation } from "@/lib/useReputation";
import { useUsdcBalance } from "@/lib/useUsdcBalance";
import { USDC_RATE } from "@/lib/i18n";

export function SessionWalletBridge() {
  const { setWalletUser, demoActive } = useSession();
  const wallet = useWallet();
  const rep = useReputation();
  const usdc = useUsdcBalance();

  const connected = wallet.status === "connected" && wallet.publicKey != null;
  const pk = wallet.publicKey;
  const usdcAmount = usdc.uiAmount;

  useEffect(() => {
    // A demo persona owns the session while a pitch preset is loaded.
    if (demoActive) return;

    if (!connected || !pk) {
      // Disconnected → reset to the zero/guest profile.
      setWalletUser(null);
      return;
    }

    // Tier (label / collateral % / leverage / next threshold) is derived
    // from the real score via the shared LEVEL_TABLE, keeping (score, level)
    // consistent with the rest of the score-driven UI.
    const tier = computeLevel(rep.score);

    setWalletUser({
      // No on-chain display name — identify by the truncated address.
      name: "",
      handle: "",
      avatar: pk.slice(0, 2).toUpperCase(),
      walletShort: shortAddr(pk),
      score: rep.score,
      scoreDelta: 0,
      level: tier.level,
      levelLabel: tier.label,
      nextLevel: tier.next,
      colateralPct: tier.colat,
      leverageX: tier.lev,
      // BRL hero = real USDC balance × rate (elsewhere USDC = BRL / USDC_RATE).
      balance: (usdcAmount ?? 0) * USDC_RATE,
      yield: 0, // no per-wallet accrued-yield source on devnet yet
    });
  }, [demoActive, connected, pk, rep.score, usdcAmount, setWalletUser]);

  return null;
}
