/**
 * Swappable email-send adapter for the notification cron.
 *
 * Two backends, selected by env so the actual provider can be changed without
 * touching the cron:
 *   - `noop` (DEFAULT): records the intent and returns ok WITHOUT sending. Keeps
 *     the whole feature safe-by-default — nothing leaves the box until a real
 *     key is set, and the prisma-free / no-network CI lane is unaffected.
 *   - `resend`: posts to the Resend HTTP API when RESEND_API_KEY is set. Plain
 *     fetch, no SDK dependency. Swapping to SES / Postmark later is one new
 *     branch here; the cron + templates don't change.
 *
 * The send side is gated overall by EMAIL_NOTIFICATIONS_ENABLED at the cron;
 * this module only decides HOW to send once the cron decides WHAT.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface EmailSendResult {
  ok: boolean;
  /** Provider message id on success (or "noop"). */
  id?: string;
  error?: string;
}

export interface EmailAdapter {
  readonly name: "noop" | "resend";
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

/** Default: never actually sends. The caller logs the (to, subject) it would
 *  have delivered, so a dry run is fully observable. */
export const noopEmailAdapter: EmailAdapter = {
  name: "noop",
  async send() {
    return { ok: true, id: "noop" };
  },
};

/** Resend (https://resend.com) HTTP backend. Pure fetch — no SDK. */
export function resendEmailAdapter(apiKey: string, from: string): EmailAdapter {
  return {
    name: "resend",
    async send(msg: EmailMessage): Promise<EmailSendResult> {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return { ok: false, error: `resend ${res.status}: ${body.slice(0, 200)}` };
        }
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, id: data.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Default sender shown in the From: header; override via RESEND_FROM. */
export const DEFAULT_EMAIL_FROM = "RoundFi <alerts@roundfi.app>";

/** Select the backend from env. `resend` only when RESEND_API_KEY is set —
 *  otherwise the safe noop. */
export function getEmailAdapter(): EmailAdapter {
  const key = process.env.RESEND_API_KEY;
  if (key && key.length > 0) {
    return resendEmailAdapter(key, process.env.RESEND_FROM ?? DEFAULT_EMAIL_FROM);
  }
  return noopEmailAdapter;
}
