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
 *
 *   - `smtp`: sends via any SMTP server (e.g. Gmail) when SMTP_HOST is set.
 *     Uses nodemailer (SMTP is a stateful TCP protocol — can't be done with
 *     fetch). This is the zero-cost, no-domain path for the devnet canary:
 *     send through the project's own Gmail (App Password), which lands in
 *     inboxes because the mail leaves Google's servers already DKIM-aligned.
 */

import nodemailer from "nodemailer";

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
  readonly name: "noop" | "resend" | "smtp";
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

/** SMTP backend (nodemailer). For Gmail: host `smtp.gmail.com`, port 465
 *  (implicit TLS) or 587 (STARTTLS), user = the Gmail address, pass = an
 *  App Password (NOT the account password; requires 2-Step Verification). */
export function smtpEmailAdapter(opts: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}): EmailAdapter {
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure,
    auth: { user: opts.user, pass: opts.pass },
  });
  return {
    name: "smtp",
    async send(msg: EmailMessage): Promise<EmailSendResult> {
      try {
        const info = await transport.sendMail({
          from: opts.from,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
        });
        return { ok: true, id: info.messageId };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/** Default sender shown in the From: header; override via RESEND_FROM / SMTP_FROM. */
export const DEFAULT_EMAIL_FROM = "RoundFi <alerts@roundfi.app>";

/** Select the backend from env (precedence: resend → smtp → noop). All are
 *  opt-in: with no RESEND_API_KEY and no SMTP_HOST, nothing leaves the box. */
export function getEmailAdapter(): EmailAdapter {
  const key = process.env.RESEND_API_KEY;
  if (key && key.length > 0) {
    return resendEmailAdapter(key, process.env.RESEND_FROM ?? DEFAULT_EMAIL_FROM);
  }
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost && smtpHost.length > 0) {
    const port = Number(process.env.SMTP_PORT ?? "465");
    return smtpEmailAdapter({
      host: smtpHost,
      port,
      // 465 = implicit TLS; 587 = STARTTLS. Default the flag from the port.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      // For Gmail the From must align with the authed user → default to it.
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? DEFAULT_EMAIL_FROM,
    });
  }
  return noopEmailAdapter;
}
