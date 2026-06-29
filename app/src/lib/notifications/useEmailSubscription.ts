"use client";

/**
 * Client-side email opt-in hook — drives the SIWS flow for binding (or
 * clearing) a notification email on the connected wallet. The notification
 * twin of `useAdminSession`:
 *   1. POST /api/notifications/email/challenge { pubkey, email, action }
 *        → { message, nonce, issuedAt, challengeToken }
 *   2. wallet.signMessage(utf8(message)) → signature
 *   3. POST /api/notifications/email { …challenge, signature(b64), lang }
 *        → server verifies + upserts.
 *
 * `signMessage` (not a co-signed transaction) is used, so this works on mobile
 * wallets that struggle with multi-signer txs. The client never sees the
 * signing secret — it only relays the wallet's signature.
 */

import { useCallback, useEffect, useState } from "react";

import { useWallet } from "@/lib/wallet";

export type EmailOptInState = "idle" | "subscribed" | "unsubscribed";
export type EmailLang = "pt" | "en";
type EmailAction = "subscribe" | "unsubscribe";

// Same build-time flag the card gates on — when dark, skip the status fetch
// entirely (the card renders null anyway, so a request would be wasted).
const HYDRATE_ENABLED = process.env.NEXT_PUBLIC_EMAIL_NOTIFICATIONS_ENABLED === "true";

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export interface EmailSubscriptionHook {
  busy: boolean;
  /** Raw error code from the server (or a client sentinel) — the card maps it
   *  to a localized message. null when clear. */
  error: string | null;
  state: EmailOptInState;
  /** Whether the connected wallet can sign messages (opt-in requires it). */
  canSign: boolean;
  /** Server-confirmed bound email (after a reload-hydrate or a fresh subscribe),
   *  so the subscribed view survives a refresh without the user re-typing. null
   *  when unknown / not subscribed. */
  subscribedEmail: string | null;
  /** True while the initial server status check (rehydrate) is in flight. */
  hydrating: boolean;
  subscribe: (email: string, lang: EmailLang) => Promise<void>;
  unsubscribe: (email: string) => Promise<void>;
  reset: () => void;
}

export function useEmailSubscription(): EmailSubscriptionHook {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<EmailOptInState>("idle");
  const [subscribedEmail, setSubscribedEmail] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(HYDRATE_ENABLED);

  const run = useCallback(
    async (action: EmailAction, email: string, lang: EmailLang) => {
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
        const cr = await fetch("/api/notifications/email/challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pubkey: wallet.publicKey, email, action }),
        });
        if (!cr.ok) {
          const b = (await cr.json().catch(() => ({}))) as { error?: string };
          setError(b.error ?? "challenge_failed");
          return;
        }
        const challenge = (await cr.json()) as {
          message: string;
          nonce: string;
          issuedAt: number;
          challengeToken: string;
        };

        const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message));

        const vr = await fetch("/api/notifications/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pubkey: wallet.publicKey,
            email,
            action,
            nonce: challenge.nonce,
            issuedAt: challenge.issuedAt,
            challengeToken: challenge.challengeToken,
            signature: toBase64(signature),
            ...(action === "subscribe" ? { lang } : {}),
          }),
        });
        if (!vr.ok) {
          const b = (await vr.json().catch(() => ({}))) as { error?: string };
          setError(b.error ?? "confirm_failed");
          return;
        }
        if (action === "subscribe") {
          setSubscribedEmail(email);
          setState("subscribed");
        } else {
          setSubscribedEmail(null);
          setState("unsubscribed");
        }
      } catch (err) {
        // User rejected the signature, or the wallet threw.
        setError(err instanceof Error ? err.message : "sign_failed");
      } finally {
        setBusy(false);
      }
    },
    [wallet],
  );

  // Rehydrate from the server on mount / wallet change — the binding is durable
  // in Postgres + wallet-bound, so a reload should show "subscribed" instead of
  // the empty form. A fresh subscribe/unsubscribe sets state directly (above),
  // so this only drives the initial paint (and a wallet switch).
  useEffect(() => {
    if (!HYDRATE_ENABLED || !wallet.publicKey) {
      setHydrating(false);
      setState("idle");
      setSubscribedEmail(null);
      return;
    }
    let cancelled = false;
    setHydrating(true);
    const pubkey = wallet.publicKey;
    fetch(`/api/notifications/email/status?pubkey=${pubkey}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { optedIn?: boolean; email?: string } | null) => {
        if (cancelled || !d?.optedIn || typeof d.email !== "string") return;
        setSubscribedEmail(d.email);
        setState("subscribed");
      })
      .catch(() => {
        /* network/store hiccup → leave the form; (re)subscribe is idempotent */
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet.publicKey]);

  return {
    busy,
    error,
    state,
    canSign: wallet.signMessage != null,
    subscribedEmail,
    hydrating,
    subscribe: (email, lang) => run("subscribe", email, lang),
    unsubscribe: (email) => run("unsubscribe", email, "pt"),
    reset: () => {
      setState("idle");
      setError(null);
      setSubscribedEmail(null);
    },
  };
}
