"use client";

// useIdentity() — reads the connected wallet's on-chain IdentityRecord
// (Human Passport / Proof-of-Personhood) from the devnet reputation program,
// IDL-free via the SDK's `fetchIdentityRecordRaw`. Drives the REAL state of
// the "Human Passport" connection card (replacing the old hard-coded mock).
//
// A wallet that never linked has no IdentityRecord PDA. The program treats
// that as Unverified, so we mirror that default (exists:false, verified:false)
// rather than erroring — that IS the correct empty-state. An RPC failure
// yields status:"fallback" so the card can say "indisponível" instead of
// showing a misleading not-verified.

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { fetchIdentityRecordRaw } from "@roundfi/sdk";

import { DEVNET_PROGRAM_IDS } from "./devnet";

export type UseIdentityStatus = "loading" | "ok" | "fallback";

/** On-chain `IdentityStatus` enum (state/identity.rs). */
export type IdentityStatusCode = 0 | 1 | 2 | 3; // Unverified | Verified | Expired | Revoked

export interface UseIdentityResult {
  status: UseIdentityStatus;
  /** true iff an on-chain IdentityRecord exists for this wallet. */
  exists: boolean;
  /** true iff status == Verified AND not past expiry. */
  verified: boolean;
  /** Raw on-chain status code (0..3); 0 when no record. */
  statusCode: IdentityStatusCode;
  /** Unix seconds of expiry; 0 ≡ never / unknown. */
  expiresAt: number;
  /** Unix seconds the wallet was verified; 0 when unknown. */
  verifiedAt: number;
  /** The linked attestation account (base58); null when no record. */
  gatewayToken: string | null;
  refresh: () => Promise<void>;
}

const EMPTY: Omit<UseIdentityResult, "refresh"> = {
  status: "ok",
  exists: false,
  verified: false,
  statusCode: 0,
  expiresAt: 0,
  verifiedAt: 0,
  gatewayToken: null,
};

export function useIdentity(refreshMs = 30_000): UseIdentityResult {
  const { connection } = useConnection();
  const { publicKey } = useAdapterWallet();
  const [state, setState] = useState<Omit<UseIdentityResult, "refresh">>({
    ...EMPTY,
    status: "loading",
  });
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    if (!publicKey) {
      setState({ ...EMPTY, status: "ok" });
      return;
    }
    try {
      const raw = await fetchIdentityRecordRaw(
        connection,
        DEVNET_PROGRAM_IDS.reputation,
        publicKey,
      );
      if (cancelledRef.current) return;
      if (!raw) {
        setState({ ...EMPTY, status: "ok" });
        return;
      }
      const statusCode = (raw.status as IdentityStatusCode) ?? 0;
      const expiresAt = Number(raw.expiresAt);
      const nowSec = Math.floor(Date.now() / 1000);
      const verified = statusCode === 1 && (expiresAt === 0 || expiresAt > nowSec);
      setState({
        status: "ok",
        exists: true,
        verified,
        statusCode,
        expiresAt,
        verifiedAt: Number(raw.verifiedAt),
        gatewayToken: raw.gatewayToken.toBase58(),
      });
    } catch {
      if (cancelledRef.current) return;
      setState({ ...EMPTY, status: "fallback" });
    }
  }, [connection, publicKey]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}
