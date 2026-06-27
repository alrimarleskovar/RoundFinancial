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

import { useCallback, useState } from "react";

import { useWallet } from "@/lib/wallet";

export type EmailOptInState = "idle" | "subscribed" | "unsubscribed";
export type EmailLang = "pt" | "en";
type EmailAction = "subscribe" | "unsubscribe";

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
  subscribe: (email: string, lang: EmailLang) => Promise<void>;
  unsubscribe: (email: string) => Promise<void>;
  reset: () => void;
}

export function useEmailSubscription(): EmailSubscriptionHook {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<EmailOptInState>("idle");

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
        setState(action === "subscribe" ? "subscribed" : "unsubscribed");
      } catch (err) {
        // User rejected the signature, or the wallet threw.
        setError(err instanceof Error ? err.message : "sign_failed");
      } finally {
        setBusy(false);
      }
    },
    [wallet],
  );

  return {
    busy,
    error,
    state,
    canSign: wallet.signMessage != null,
    subscribe: (email, lang) => run("subscribe", email, lang),
    unsubscribe: (email) => run("unsubscribe", email, "pt"),
    reset: () => {
      setState("idle");
      setError(null);
    },
  };
}
