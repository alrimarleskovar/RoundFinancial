/**
 * The 3 RoundFi notification email templates, PT + EN — pure functions that
 * render `{ subject, html }`. Design approved with the team (due-date reminder,
 * pool-started, new-group-for-your-level).
 *
 * Email-client notes:
 *   - The logo is a HOSTED PNG (`logoUrl`), not inline SVG — Gmail/Outlook strip
 *     inline SVG. The cron passes an absolute https URL.
 *   - Inline styles only (no <style>/<head> CSS — many clients drop it). Layout
 *     is intentionally simple; a wrapper-table refactor for legacy Outlook can
 *     come later if the canary needs it.
 *   - All links are absolute https. `unsubUrl` is a one-click unsubscribe the
 *     cron mints per-recipient (also surfaced as a List-Unsubscribe header).
 */

export type EmailLang = "pt" | "en";

export interface RenderedEmail {
  subject: string;
  html: string;
}

interface Common {
  /** Recipient address — shown in the footer. */
  email: string;
  /** Shortened wallet (e.g. "81u3…bchNy") — shown in the footer. */
  walletShort: string;
  /** Absolute https URL to the brand PNG. */
  logoUrl: string;
  /** Absolute https one-click unsubscribe URL. */
  unsubUrl: string;
}

export interface DueDateData extends Common {
  groupName: string;
  installmentBrl: string;
  dueDate: string;
  days: number;
  payUrl: string;
}

export interface PoolStartedData extends Common {
  groupName: string;
  membersTarget: number;
  firstDueDate: string;
  installmentBrl: string;
  groupUrl: string;
}

export interface NewGroupData extends Common {
  groupName: string;
  levelLabel: string;
  slotsFilled: number;
  slotsTotal: number;
  collateralPct: number;
  groupUrl: string;
}

const C = {
  bg: "#04070c",
  card: "#0d1320",
  border: "#1c2636",
  text: "#ffffff",
  text2: "#aab4c5",
  muted: "#7a8699",
  green: "#14F195",
  ctaText: "#04110a",
};

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

function field(label: string, value: string): string {
  return `<div style="min-width:100px;"><div style="font-size:10px;letter-spacing:0.1em;color:${C.muted};font-family:monospace;">${esc(label)}</div><div style="font-size:15px;color:${C.text};font-weight:600;margin-top:4px;">${esc(value)}</div></div>`;
}

function footer(lang: EmailLang, c: Common, reason: string): string {
  const cancel = lang === "pt" ? "Cancelar alertas" : "Unsubscribe";
  const devnet =
    lang === "pt"
      ? "ambiente de testes (devnet), sem valor real."
      : "test environment (devnet), no real value.";
  return `<p style="font-size:11px;color:#6b7689;line-height:1.6;margin-top:18px;text-align:center;">${esc(reason)}<br/><a href="${esc(c.unsubUrl)}" style="color:${C.muted};text-decoration:underline;">${cancel}</a> · ${devnet}</p>`;
}

function layout(opts: {
  c: Common;
  badge: string;
  title: string;
  body: string;
  fields: string;
  ctaLabel: string;
  ctaUrl: string;
  footerReason: string;
  lang: EmailLang;
}): string {
  return `<!doctype html><html lang="${opts.lang === "pt" ? "pt-BR" : "en"}"><body style="margin:0;background:${C.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">
  <div style="background:${C.card};border:1px solid ${C.border};border-radius:18px;padding:26px;">
    <div style="margin-bottom:20px;">
      ${
        opts.c.logoUrl
          ? `<img src="${esc(opts.c.logoUrl)}" width="120" height="34" alt="RoundFi" style="display:block;border:0;outline:none;" />`
          : `<span style="font-size:22px;font-weight:800;color:${C.text};letter-spacing:-0.02em;"><span style="color:${C.green};">◆</span> RoundFi</span>`
      }
    </div>
    <div style="font-size:11px;letter-spacing:0.12em;color:${C.green};font-family:monospace;margin-bottom:10px;">${esc(opts.badge)}</div>
    <div style="font-size:24px;font-weight:800;color:${C.text};letter-spacing:-0.02em;line-height:1.25;">${opts.title}</div>
    <p style="font-size:14px;color:${C.text2};line-height:1.6;margin:14px 0 0;">${opts.body}</p>
    <div style="margin-top:20px;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};padding:16px 0;display:flex;flex-wrap:wrap;gap:18px;">${opts.fields}</div>
    <a href="${esc(opts.ctaUrl)}" style="display:block;text-align:center;margin-top:22px;padding:13px;border-radius:11px;background:${C.green};color:${C.ctaText};font-size:14px;font-weight:700;text-decoration:none;">${esc(opts.ctaLabel)} →</a>
    ${footer(opts.lang, opts.c, opts.footerReason)}
  </div>
</div></body></html>`;
}

export function dueDateEmail(d: DueDateData, lang: EmailLang): RenderedEmail {
  const pt = lang === "pt";
  const subject = pt
    ? `Sua parcela vence em ${d.days} ${d.days === 1 ? "dia" : "dias"} · ${d.groupName}`
    : `Your installment is due in ${d.days} ${d.days === 1 ? "day" : "days"} · ${d.groupName}`;
  return {
    subject,
    html: layout({
      c: d,
      lang,
      badge: pt ? "◆ AVISO DE VENCIMENTO" : "◆ PAYMENT DUE",
      title: pt
        ? `Sua parcela vence em <span style="color:${C.green};">${d.days} ${d.days === 1 ? "dia" : "dias"}</span>`
        : `Your installment is due in <span style="color:${C.green};">${d.days} ${d.days === 1 ? "day" : "days"}</span>`,
      body: pt
        ? "Pague no prazo pra manter seu score subindo e seu colateral baixo."
        : "Pay on time to keep your score climbing and your collateral low.",
      fields:
        field(pt ? "GRUPO" : "GROUP", d.groupName) +
        field(pt ? "PARCELA" : "INSTALLMENT", d.installmentBrl) +
        field(pt ? "VENCIMENTO" : "DUE DATE", d.dueDate),
      ctaLabel: pt ? "Pagar parcela" : "Pay installment",
      ctaUrl: d.payUrl,
      footerReason: pt
        ? `Você recebe isto porque cadastrou ${d.email} para a carteira ${d.walletShort}.`
        : `You get this because ${d.email} is registered for wallet ${d.walletShort}.`,
    }),
  };
}

export function poolStartedEmail(d: PoolStartedData, lang: EmailLang): RenderedEmail {
  const pt = lang === "pt";
  return {
    subject: pt
      ? `Seu grupo começou 🎉 · ${d.groupName}`
      : `Your group has started 🎉 · ${d.groupName}`,
    html: layout({
      c: d,
      lang,
      badge: pt ? "◆ POOL INICIADA" : "◆ POOL STARTED",
      title: pt ? "Seu grupo começou 🎉" : "Your group has started 🎉",
      body: pt
        ? `Os <b style="color:${C.text};">${d.membersTarget} membros</b> entraram e a <b style="color:${C.text};">${esc(d.groupName)}</b> está ativa. Os ciclos começam agora — fique de olho na sua primeira parcela.`
        : `All <b style="color:${C.text};">${d.membersTarget} members</b> joined and <b style="color:${C.text};">${esc(d.groupName)}</b> is now active. Cycles start now — watch for your first installment.`,
      fields:
        field(pt ? "MEMBROS" : "MEMBERS", `${d.membersTarget} / ${d.membersTarget}`) +
        field(pt ? "1ª PARCELA" : "1ST DUE", d.firstDueDate) +
        field(pt ? "VALOR" : "AMOUNT", d.installmentBrl),
      ctaLabel: pt ? "Ver meu grupo" : "View my group",
      ctaUrl: d.groupUrl,
      footerReason: pt
        ? `Carteira ${d.walletShort} · ${d.email}`
        : `Wallet ${d.walletShort} · ${d.email}`,
    }),
  };
}

export function newGroupEmail(d: NewGroupData, lang: EmailLang): RenderedEmail {
  const pt = lang === "pt";
  return {
    subject: pt
      ? `Abriu um grupo do seu nível · ${d.groupName}`
      : `A group for your level just opened · ${d.groupName}`,
    html: layout({
      c: d,
      lang,
      badge: pt ? "◆ NOVO GRUPO PRO SEU NÍVEL" : "◆ NEW GROUP FOR YOUR LEVEL",
      title: pt ? "Abriu um grupo do seu nível" : "A group for your level just opened",
      body: pt
        ? `Como você está no nível <b style="color:${C.green};">${esc(d.levelLabel)}</b>, liberou um grupo novo com colateral menor. Tem vaga — entre se quiser.`
        : `Since you're at <b style="color:${C.green};">${esc(d.levelLabel)}</b> level, a new group with lower collateral opened up. Spots are open — join if you like.`,
      fields:
        field(pt ? "GRUPO" : "GROUP", d.groupName) +
        field(pt ? "VAGAS" : "SPOTS", `${d.slotsFilled} / ${d.slotsTotal}`) +
        field(pt ? "COLATERAL" : "COLLATERAL", `${d.collateralPct}%`),
      ctaLabel: pt ? "Ver grupo" : "View group",
      ctaUrl: d.groupUrl,
      footerReason: pt
        ? "Recomendações são baseadas no seu nível atual."
        : "Recommendations are based on your current level.",
    }),
  };
}
