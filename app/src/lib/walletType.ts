// Mobile type ramp for /carteira → "Visão geral", specced by mobile QA (Caio).
//
// These px sizes are applied ONLY on mobile (every call site is isMobile-gated);
// desktop keeps its existing, larger display sizes untouched. Centralised here
// so the ramp can be retuned in one place — change a number and every matching
// element on the wallet overview follows.
export const WALLET_MOBILE_TYPE = {
  hero: 36, // page title ("Carteira")
  valorPrincipal: 44, // the balance hero number
  valorSecundario: 28, // the Kamino vault number
  cardTitle: 18, // card section headers (eyebrow labels)
  body: 16, // primary row text
  tabs: 15, // tab strip labels
  button: 16, // action buttons (Receber / Enviar / Sacar / Vender)
  description: 14, // subtitles + secondary row lines
  label: 12, // small labels
  micro: 11, // tiny mono captions (floor — nothing smaller on mobile)
} as const;
