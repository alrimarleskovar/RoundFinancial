"use client";

/**
 * Client-side admin session hook (ADR 0009 §1). Drives the SIWS flow from
 * the browser:
 *   1. POST /api/admin/auth/nonce { pubkey } → { message, nonce, issuedAt, challengeToken }
 *   2. wallet.signMessage(utf8(message)) → signature
 *   3. POST /api/admin/auth/verify { pubkey, nonce, issuedAt, challengeToken, signature(b64) }
 *      → server sets the httpOnly session cookie.
 *
 * The client NEVER sees ADMIN_SESSION_SECRET — it only relays the wallet's
 * signature. The cookie is httpOnly, so we learn auth state from
 * GET /api/admin/auth/session, not by reading the cookie.
 */

import { useCallback, useEffect, useState } from "react";

import { useWallet } from "@/lib/wallet";

export type AdminSessionStatus = "loading" | "anon" | "authed";

export interface AdminSession {
  status: AdminSessionStatus;
  pubkey: string | null;
  busy: boolean;
  error: string | null;
  /** Whether the connected wallet can sign messages (SIWS requires it). */
  canSign: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function useAdminSession(): AdminSession {
  const wallet = useWallet();
  const [status, setStatus] = useState<AdminSessionStatus>("loading");
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/auth/session", { cache: "no-store" });
      const body = (await res.json()) as { authenticated: boolean; pubkey?: string };
      if (body.authenticated) {
        setStatus("authed");
        setPubkey(body.pubkey ?? null);
      } else {
        setStatus("anon");
        setPubkey(null);
      }
    } catch {
      setStatus("anon");
      setPubkey(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async () => {
    setError(null);
    if (!wallet.publicKey) {
      setError("connect_wallet");
      return;
    }
    if (!wallet.signMessage) {
      setError("wallet_cannot_sign");
      return;
    }
    setBusy(true);
    try {
      const nonceRes = await fetch("/api/admin/auth/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubkey: wallet.publicKey }),
      });
      if (!nonceRes.ok) {
        setError("nonce_failed");
        return;
      }
      const challenge = (await nonceRes.json()) as {
        message: string;
        nonce: string;
        issuedAt: number;
        challengeToken: string;
      };

      const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message));

      const verifyRes = await fetch("/api/admin/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pubkey: wallet.publicKey,
          nonce: challenge.nonce,
          issuedAt: challenge.issuedAt,
          challengeToken: challenge.challengeToken,
          signature: toBase64(signature),
        }),
      });
      if (!verifyRes.ok) {
        const body = (await verifyRes.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "verify_failed");
        return;
      }
      await refresh();
    } catch (err) {
      // User rejected the signature, or the wallet threw.
      setError(err instanceof Error ? err.message : "sign_failed");
    } finally {
      setBusy(false);
    }
  }, [wallet, refresh]);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return {
    status,
    pubkey,
    busy,
    error,
    canSign: wallet.signMessage != null,
    signIn,
    signOut,
    refresh,
  };
}
