"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// i18n + currency context. Ported from prototype/components/i18n.jsx.
// Uses React context instead of the prototype's global pub/sub.

export type Lang = "pt" | "en";
export type Currency = "BRL" | "USDC";

// 1 USDC ≈ R$ 5.50 (reasonable 2026 mid-market rate; editable).
export const USDC_RATE = 5.5;

type Dict = Record<string, string>;

export const DICT: Record<Lang, Dict> = {
  pt: {
    // sidebar & nav
    "nav.home": "Início",
    "nav.groups": "Grupos",
    "nav.score": "Reputação",
    "nav.wallet": "Carteira",
    "nav.market": "Mercado",
    "nav.insights": "Insights",
    // top bar
    "top.search": "Buscar grupos, membros, atestados…",
    "top.deposit": "+ Depositar",
    "top.network": "Solana Mainnet",
    "top.connect": "Conectar Phantom",
    "top.connecting": "Conectando…",
    "top.network.devnet": "Devnet",
    "top.network.offline": "Phantom · offline",
    // home
    "home.badge": "◆ Dashboard",
    "home.greeting": "Bom dia,",
    "home.summary.a": "Você tem",
    "home.summary.b": "1 parcela",
    "home.summary.c": "vencendo em 5 dias e",
    "home.summary.d": "de yield acumulado.",
    "home.yieldAmt": "{v} de yield",
    "home.payInstallment": "Pagar parcela",
    "home.joinGroup": "Entrar em grupo",
    "home.kpi.balance": "Saldo protegido",
    "home.kpi.score": "Reputação",
    "home.kpi.yield": "Yield Kamino",
    "home.kpi.colat": "Colateral atual",
    "home.kpi.delta.balance": "+2,4% mês",
    "home.kpi.delta.yield": "6,8% APY",
    "home.kpi.delta.lev": "{x}x alav.",
    "home.kpi.delta.score": "+{d} este mês",
    "home.yourGroups": "Seus grupos",
    "home.seeAll": "Ver tudo →",
    "home.featured": "◆ Rodada ativa · destaque",
    "home.meta.prize": "Prêmio",
    "home.meta.next": "Próxima parcela",
    "home.meta.draw": "Sorteio",
    "home.drawIn": "5 dias",
    "home.installments": "cotas",
    "home.drawn": "sorteadas",
    "home.installment": "Parcela",
    "home.month": "Mês",
    "home.passport": "◆ SAS Passport",
    "home.shield": "◆ Triplo Escudo · ativo",
    "home.activity": "◆ Atividade recente",
    // levels
    "level.proven": "COMPROVADO Nv.2",
    "level.beginner": "Iniciante",
    "level.provenName": "Comprovado",
    "level.veteran": "Veterano",
    "level.youLabel": "← VOCÊ",
    "level.ptsToNext": "{n} pts até Veterano",
    // score / reputação screen
    "score.badge": "◆ SAS Passport",
    "score.title": "Reputação on-chain",
    "score.cardChain": "SOLANA · SAS",
    "score.cardLabel": "REPUTATION SCORE",
    "score.scaleLow": "BAIXO 300",
    "score.scaleMid": "● COMPROVADO",
    "score.scaleHigh": "VETERANO 850",
    "score.lvPill": "Nv.{n} · {name}",
    "score.levelsTitle": "◆ Níveis de reputação",
    "score.lvDetail": "{c}% colateral · {l}x alavancagem",
    "score.bondsTitle": "◆ Atestados SAS emitidos",
    "score.bondsTotals": "{n} parcelas pagas · {c} ciclos",
    "score.bondAttest": "{n} atestados",
    "score.bondActive": "Ativo",
    "score.bondClosed": "✓ Fechado",
    // groups
    "groups.badge": "◆ Catálogo",
    "groups.title": "Grupos disponíveis",
    "groups.subtitle":
      "{open} grupos com vagas abertas · seu nível atual dá acesso a {access}",
    "groups.newCycle": "Abrir novo ciclo",
    "groups.search": "Buscar por nome do grupo…",
    "groups.sort.relevant": "Relevância",
    "groups.sort.priceLow": "Prêmio ↑",
    "groups.sort.priceHigh": "Prêmio ↓",
    "groups.sort.spots": "Vagas restantes",
    "groups.filter.level": "Nível",
    "groups.filter.category": "Categoria",
    "groups.filter.prize": "Prêmio",
    "groups.filter.duration": "Duração",
    "groups.filter.avail": "Disponibilidade",
    "groups.chip.all": "Todos",
    "groups.chip.any": "Qualquer",
    "groups.chip.onlyOpen": "Apenas com vagas",
    "groups.chip.lt6": "≤ 6 meses",
    "groups.chip.7to12": "7–12 meses",
    "groups.chip.gt12": "> 12 meses",
    "groups.chip.lt15": "< {v}",
    "groups.chip.15to30": "{a} – {b}",
    "groups.chip.gt30": "> {v}",
    "groups.lvl1": "Nv.1 Iniciante",
    "groups.lvl2": "Nv.2 Comprovado",
    "groups.lvl3": "Nv.3 ✦ VIP",
    "groups.ofN": "{n} de {total} grupos · {c} filtro{s} ativo{s}",
    "groups.clear": "Limpar filtros",
    "groups.empty.title": "Nenhum grupo com esses filtros",
    "groups.empty.sub": "Tente relaxar os critérios ou abra um novo ciclo.",
    "groups.card.joined": "✓ No grupo",
    "groups.card.vip": "✦ VIP",
    "groups.card.nv1": "Nv.1+",
    "groups.card.cta.view": "Ver detalhes",
    "groups.card.cta.join": "Entrar no grupo",
    "groups.card.spots": "{f}/{t} cotas",
    // categories
    "cat.pme": "PME",
    "cat.vip": "✦ VIP",
    "cat.dev": "Dev/Profissional",
    "cat.delivery": "Delivery",
    "cat.estudo": "Estudo",
    "cat.casa": "Casa",
    "cat.pessoal": "Pessoal",
    // wallet
    "wallet.badge": "◆ Carteira multi-cofre",
    "wallet.title": "Sua posição na RoundFi",
    "wallet.send": "Enviar",
    "wallet.receive": "Receber",
    "wallet.tab.overview": "Visão geral",
    "wallet.tab.positions": "Posições NFT",
    "wallet.tab.transactions": "Transações",
    "wallet.tab.connections": "Conexões",
    "wallet.total": "SALDO TOTAL · {c}",
    "wallet.comp": "COMPOSIÇÃO",
    "wallet.quota": "Cotas ativas",
    "wallet.yieldVault": "Yield vault",
    "wallet.collateral": "Colateral",
    "wallet.free": "Livre",
    "wallet.kamino": "◆ Kamino Vault",
    "wallet.yieldAcc": "Rendimento acumulado · 2 ciclos",
    "wallet.withdraw": "Sacar rendimento",
    "wallet.positions": "◆ Cotas NFT em custódia",
    "wallet.positions.c": "{n} posições",
    "wallet.tx.recent": "◆ Atividade recente",
    "wallet.tx.all": "◆ Todas as transações",
    "wallet.tx.seeAll": "Ver tudo →",
    "wallet.sell": "Vender",
    "wallet.expires": "expira {d}",
    // wallet menus / errors
    "wallet.menu.copy": "Copiar endereço",
    "wallet.menu.copied": "Copiado!",
    "wallet.menu.airdrop": "Airdrop 1 SOL",
    "wallet.menu.explorer": "Ver no Explorer",
    "wallet.menu.disconnect": "Desconectar",
    "wallet.error.title": "Erro na carteira",
    // faucet
    "wallet.faucet.title": "Faucet · Devnet",
    "wallet.faucet.sub":
      "Peça SOL de teste pra executar transações em devnet.",
    "wallet.faucet.btn": "Solicitar 1 SOL",
    "wallet.faucet.busy": "Solicitando airdrop…",
    "wallet.faucet.ok": "Airdrop confirmado",
    "wallet.faucet.viewTx": "Ver tx no Explorer →",
    "wallet.faucet.rate":
      "Limite do RPC público atingido. Use o faucet hospedado:",
    "wallet.faucet.hostedCTA": "Abrir faucet Solana",
    "wallet.faucet.failed": "Airdrop falhou: {msg}",
    "wallet.faucet.usdcTitle": "Precisa de USDC devnet?",
    "wallet.faucet.usdcSub":
      "USDC devnet não é distribuído pelo RPC. Use o faucet oficial da Circle.",
    "wallet.faucet.usdcCTA": "Abrir faucet Circle",
    // connections
    "conn.badge": "◆ Integrações ativas",
    "conn.count": "{c} de {t} conectadas",
    "conn.connected": "conectado",
    "conn.disconnected": "desconectado",
    "conn.pending": "pendente",
    "conn.since": "desde {d}",
    "conn.details": "Detalhes",
    "conn.perms": "Permissões concedidas",
    "conn.manage": "Gerenciar permissões",
    "conn.revoke": "Desconectar",
    "conn.connect": "Conectar {n}",
    "conn.connecting": "Conectando…",
    "conn.reconnect": "Reconectar",
    "conn.keys.title": "Suas chaves, seu controle",
    "conn.keys.body":
      "Todas as integrações rodam em Solana com permissões granulares. Você revoga a qualquer momento — o RoundFi nunca custodia seus ativos.",
    "conn.soon": "◆ Em breve",
    "conn.roadmap": "roadmap",
    "conn.phantom.tag": "Wallet Solana · custódia self-custodial",
    "conn.solflare.tag": "Wallet alternativa · Solana",
    "conn.civic.tag": "Verificação de identidade · passaporte on-chain",
    "conn.kamino.tag": "Yield vault · USDC · APY 6,8%",
    "conn.pix.tag": "Depósitos em reais · liquidação D+0",
    "conn.phantom.addr": "Endereço",
    "conn.phantom.net": "Rede",
    "conn.phantom.mainnet": "Solana Mainnet Beta",
    "conn.phantom.devnet": "Solana Devnet",
    "conn.phantom.balance": "Saldo",
    "conn.phantom.sigs": "Assinaturas neste mês",
    "conn.phantom.sigsV": "{n} transações",
    "conn.phantom.p1": "Assinar transações",
    "conn.phantom.p2": "Aprovar mints de NFT",
    "conn.phantom.p3": "Ler saldo da carteira",
    "conn.phantom.install": "Phantom não detectada",
    "conn.phantom.installCTA": "Instalar Phantom",
    "conn.phantom.rejected": "Conexão cancelada pelo usuário.",
    "conn.phantom.failed": "Falha ao conectar: {msg}",
    "conn.civic.passId": "Pass ID",
    "conn.civic.tier": "Nível de verificação",
    "conn.civic.tierV": "Tier 2 · KYC + Proof-of-Personhood",
    "conn.civic.exp": "Expira",
    "conn.civic.p1": "Ler atributos verificados",
    "conn.civic.p2": "Assinar atestados SAS",
    "conn.kamino.vault": "Vault",
    "conn.kamino.alloc": "Capital alocado",
    "conn.kamino.yield": "Rendimento acumulado",
    "conn.kamino.p1": "Depositar no vault",
    "conn.kamino.p2": "Sacar rendimento",
    "conn.kamino.p3": "Ler saldo",
    "conn.pix.provider": "Provedor",
    "conn.pix.notSet": "Não configurado",
    "conn.pix.req": "Requisitos",
    "conn.pix.reqV": "CPF + conta bancária brasileira",
    "conn.pix.p1": "Converter {c1} → {c2}",
    "conn.pix.p2": "Converter {c2} → {c1}",
    "conn.soon.marginfi": "Colateral alternativo",
    "conn.soon.solflare": "Wallet adicional",
    "conn.soon.jupiter": "Swap integrado BRL/USDC",
    "conn.soon.openfin": "Score bancário complementar",
    // footer
    "footer.rightsReserved": "Suas chaves, seu controle.",
  },
  en: {
    "nav.home": "Home",
    "nav.groups": "Groups",
    "nav.score": "Reputation",
    "nav.wallet": "Wallet",
    "nav.market": "Market",
    "nav.insights": "Insights",
    "top.search": "Search groups, members, attestations…",
    "top.deposit": "+ Deposit",
    "top.network": "Solana Mainnet",
    "top.connect": "Connect Phantom",
    "top.connecting": "Connecting…",
    "top.network.devnet": "Devnet",
    "top.network.offline": "Phantom · offline",
    "home.badge": "◆ Dashboard",
    "home.greeting": "Good morning,",
    "home.summary.a": "You have",
    "home.summary.b": "1 installment",
    "home.summary.c": "due in 5 days and",
    "home.summary.d": "of yield accrued.",
    "home.yieldAmt": "{v} in yield",
    "home.payInstallment": "Pay installment",
    "home.joinGroup": "Join a group",
    "home.kpi.balance": "Protected balance",
    "home.kpi.score": "Reputation",
    "home.kpi.yield": "Kamino yield",
    "home.kpi.colat": "Current collateral",
    "home.kpi.delta.balance": "+2.4% mo",
    "home.kpi.delta.yield": "6.8% APY",
    "home.kpi.delta.lev": "{x}x lev.",
    "home.kpi.delta.score": "+{d} this month",
    "home.yourGroups": "Your groups",
    "home.seeAll": "See all →",
    "home.featured": "◆ Active round · featured",
    "home.meta.prize": "Prize",
    "home.meta.next": "Next installment",
    "home.meta.draw": "Draw",
    "home.drawIn": "5 days",
    "home.installments": "shares",
    "home.drawn": "drawn",
    "home.installment": "Installment",
    "home.month": "Month",
    "home.passport": "◆ SAS Passport",
    "home.shield": "◆ Triple Shield · active",
    "home.activity": "◆ Recent activity",
    "level.proven": "PROVEN Lv.2",
    "level.beginner": "Beginner",
    "level.provenName": "Proven",
    "level.veteran": "Veteran",
    "level.youLabel": "← YOU",
    "level.ptsToNext": "{n} pts to Veteran",
    // score / reputation screen
    "score.badge": "◆ SAS Passport",
    "score.title": "On-chain reputation",
    "score.cardChain": "SOLANA · SAS",
    "score.cardLabel": "REPUTATION SCORE",
    "score.scaleLow": "LOW 300",
    "score.scaleMid": "● PROVEN",
    "score.scaleHigh": "VETERAN 850",
    "score.lvPill": "Lv.{n} · {name}",
    "score.levelsTitle": "◆ Reputation tiers",
    "score.lvDetail": "{c}% collateral · {l}x leverage",
    "score.bondsTitle": "◆ SAS attestations issued",
    "score.bondsTotals": "{n} installments paid · {c} cycles",
    "score.bondAttest": "{n} attestations",
    "score.bondActive": "Active",
    "score.bondClosed": "✓ Closed",
    "groups.badge": "◆ Catalog",
    "groups.title": "Available groups",
    "groups.subtitle":
      "{open} groups with open spots · your current level unlocks {access}",
    "groups.newCycle": "Start new cycle",
    "groups.search": "Search by group name…",
    "groups.sort.relevant": "Relevance",
    "groups.sort.priceLow": "Prize ↑",
    "groups.sort.priceHigh": "Prize ↓",
    "groups.sort.spots": "Spots left",
    "groups.filter.level": "Level",
    "groups.filter.category": "Category",
    "groups.filter.prize": "Prize",
    "groups.filter.duration": "Duration",
    "groups.filter.avail": "Availability",
    "groups.chip.all": "All",
    "groups.chip.any": "Any",
    "groups.chip.onlyOpen": "Only with spots",
    "groups.chip.lt6": "≤ 6 months",
    "groups.chip.7to12": "7–12 months",
    "groups.chip.gt12": "> 12 months",
    "groups.chip.lt15": "< {v}",
    "groups.chip.15to30": "{a} – {b}",
    "groups.chip.gt30": "> {v}",
    "groups.lvl1": "Lv.1 Beginner",
    "groups.lvl2": "Lv.2 Proven",
    "groups.lvl3": "Lv.3 ✦ VIP",
    "groups.ofN": "{n} of {total} groups · {c} active filter{s}",
    "groups.clear": "Clear filters",
    "groups.empty.title": "No groups match these filters",
    "groups.empty.sub": "Try relaxing the criteria or start a new cycle.",
    "groups.card.joined": "✓ Joined",
    "groups.card.vip": "✦ VIP",
    "groups.card.nv1": "Lv.1+",
    "groups.card.cta.view": "View details",
    "groups.card.cta.join": "Join group",
    "groups.card.spots": "{f}/{t} shares",
    "cat.pme": "SMB",
    "cat.vip": "✦ VIP",
    "cat.dev": "Dev/Professional",
    "cat.delivery": "Delivery",
    "cat.estudo": "Study",
    "cat.casa": "Home",
    "cat.pessoal": "Personal",
    "wallet.badge": "◆ Multi-vault wallet",
    "wallet.title": "Your RoundFi position",
    "wallet.send": "Send",
    "wallet.receive": "Receive",
    "wallet.tab.overview": "Overview",
    "wallet.tab.positions": "NFT Positions",
    "wallet.tab.transactions": "Transactions",
    "wallet.tab.connections": "Connections",
    "wallet.total": "TOTAL BALANCE · {c}",
    "wallet.comp": "COMPOSITION",
    "wallet.quota": "Active shares",
    "wallet.yieldVault": "Yield vault",
    "wallet.collateral": "Collateral",
    "wallet.free": "Free",
    "wallet.kamino": "◆ Kamino Vault",
    "wallet.yieldAcc": "Accrued yield · 2 cycles",
    "wallet.withdraw": "Withdraw yield",
    "wallet.positions": "◆ NFT shares in escrow",
    "wallet.positions.c": "{n} positions",
    "wallet.tx.recent": "◆ Recent activity",
    "wallet.tx.all": "◆ All transactions",
    "wallet.tx.seeAll": "See all →",
    "wallet.sell": "Sell",
    "wallet.expires": "expires {d}",
    "wallet.menu.copy": "Copy address",
    "wallet.menu.copied": "Copied!",
    "wallet.menu.airdrop": "Airdrop 1 SOL",
    "wallet.menu.explorer": "View on Explorer",
    "wallet.menu.disconnect": "Disconnect",
    "wallet.error.title": "Wallet error",
    "wallet.faucet.title": "Faucet · Devnet",
    "wallet.faucet.sub": "Get test SOL to run transactions on devnet.",
    "wallet.faucet.btn": "Request 1 SOL",
    "wallet.faucet.busy": "Requesting airdrop…",
    "wallet.faucet.ok": "Airdrop confirmed",
    "wallet.faucet.viewTx": "View tx on Explorer →",
    "wallet.faucet.rate": "Public RPC rate limit hit. Use the hosted faucet:",
    "wallet.faucet.hostedCTA": "Open Solana faucet",
    "wallet.faucet.failed": "Airdrop failed: {msg}",
    "wallet.faucet.usdcTitle": "Need devnet USDC?",
    "wallet.faucet.usdcSub":
      "Devnet USDC is not distributed by the RPC. Use Circle’s official faucet.",
    "wallet.faucet.usdcCTA": "Open Circle faucet",
    "conn.badge": "◆ Active integrations",
    "conn.count": "{c} of {t} connected",
    "conn.connected": "connected",
    "conn.disconnected": "disconnected",
    "conn.pending": "pending",
    "conn.since": "since {d}",
    "conn.details": "Details",
    "conn.perms": "Granted permissions",
    "conn.manage": "Manage permissions",
    "conn.revoke": "Disconnect",
    "conn.connect": "Connect {n}",
    "conn.connecting": "Connecting…",
    "conn.reconnect": "Reconnect",
    "conn.keys.title": "Your keys, your control",
    "conn.keys.body":
      "All integrations run on Solana with granular permissions. Revoke any time — RoundFi never custodies your assets.",
    "conn.soon": "◆ Coming soon",
    "conn.roadmap": "roadmap",
    "conn.phantom.tag": "Solana wallet · self-custodial",
    "conn.solflare.tag": "Alternative Solana wallet",
    "conn.civic.tag": "Identity verification · on-chain passport",
    "conn.kamino.tag": "Yield vault · USDC · 6.8% APY",
    "conn.pix.tag": "BRL deposits · T+0 settlement",
    "conn.phantom.addr": "Address",
    "conn.phantom.net": "Network",
    "conn.phantom.mainnet": "Solana Mainnet Beta",
    "conn.phantom.devnet": "Solana Devnet",
    "conn.phantom.balance": "Balance",
    "conn.phantom.sigs": "Signatures this month",
    "conn.phantom.sigsV": "{n} transactions",
    "conn.phantom.p1": "Sign transactions",
    "conn.phantom.p2": "Approve NFT mints",
    "conn.phantom.p3": "Read wallet balance",
    "conn.phantom.install": "Phantom not detected",
    "conn.phantom.installCTA": "Install Phantom",
    "conn.phantom.rejected": "Connection cancelled by user.",
    "conn.phantom.failed": "Connection failed: {msg}",
    "conn.civic.passId": "Pass ID",
    "conn.civic.tier": "Verification tier",
    "conn.civic.tierV": "Tier 2 · KYC + Proof-of-Personhood",
    "conn.civic.exp": "Expires",
    "conn.civic.p1": "Read verified attributes",
    "conn.civic.p2": "Sign SAS attestations",
    "conn.kamino.vault": "Vault",
    "conn.kamino.alloc": "Allocated capital",
    "conn.kamino.yield": "Accrued yield",
    "conn.kamino.p1": "Deposit in vault",
    "conn.kamino.p2": "Withdraw yield",
    "conn.kamino.p3": "Read balance",
    "conn.pix.provider": "Provider",
    "conn.pix.notSet": "Not configured",
    "conn.pix.req": "Requirements",
    "conn.pix.reqV": "CPF + Brazilian bank account",
    "conn.pix.p1": "Convert {c1} → {c2}",
    "conn.pix.p2": "Convert {c2} → {c1}",
    "conn.soon.marginfi": "Alternative collateral",
    "conn.soon.solflare": "Additional wallet",
    "conn.soon.jupiter": "Integrated BRL/USDC swap",
    "conn.soon.openfin": "Complementary bank score",
    "footer.rightsReserved": "Your keys, your control.",
  },
};

// ── Helpers ────────────────────────────────────────────────
function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] != null ? String(params[k]) : `{${k}}`,
  );
}

export function translate(
  dict: Dict,
  fallback: Dict,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = dict[key] ?? fallback[key] ?? key;
  return interpolate(raw, params);
}

// ── Context ────────────────────────────────────────────────
export interface I18nContextValue {
  lang: Lang;
  currency: Currency;
  setLang: (l: Lang) => void;
  setCurrency: (c: Currency) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  fmtMoney: (brlAmount: number, opts?: FmtOptions) => string;
  moneySymbol: () => string;
  fmtMoneyThreshold: (brl: number) => string;
}

export interface FmtOptions {
  compact?: boolean;
  noCents?: boolean;
  signed?: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────
export function I18nProvider({
  initialLang = "pt",
  initialCurrency = "BRL",
  children,
}: {
  initialLang?: Lang;
  initialCurrency?: Currency;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang === "pt" ? "pt-BR" : "en");
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const setCurrency = useCallback((c: Currency) => setCurrencyState(c), []);

  const value = useMemo<I18nContextValue>(() => {
    const dict = DICT[lang] ?? DICT.pt;
    const fallback = DICT.pt;

    const t = (key: string, params?: Record<string, string | number>) =>
      translate(dict, fallback, key, params);

    const fmtMoney = (brlAmount: number, opts: FmtOptions = {}) => {
      const { compact = false, noCents = false, signed = false } = opts;
      const isUSDC = currency === "USDC";
      const amount = isUSDC ? brlAmount / USDC_RATE : brlAmount;
      const locale = lang === "pt" ? "pt-BR" : "en-US";
      const minDec = noCents ? 0 : 2;
      const maxDec = noCents ? 0 : 2;

      let num: string;
      if (compact && Math.abs(amount) >= 1000) {
        num = amount.toLocaleString(locale, {
          notation: "compact",
          compactDisplay: "short",
          maximumFractionDigits: 1,
        });
      } else {
        num = amount.toLocaleString(locale, {
          minimumFractionDigits: minDec,
          maximumFractionDigits: maxDec,
        });
      }

      const prefix = signed && brlAmount > 0 ? "+" : "";
      return isUSDC ? `${prefix}${num} USDC` : `${prefix}R$ ${num}`;
    };

    const moneySymbol = () => (currency === "USDC" ? "USDC" : "R$");

    const fmtMoneyThreshold = (brl: number) => {
      if (currency === "USDC") {
        const u = brl / USDC_RATE;
        const k =
          u >= 1000
            ? `${(u / 1000).toFixed(1).replace(/\.0$/, "")}k`
            : `${u.toFixed(0)}`;
        return `${k} USDC`;
      }
      const k = brl >= 1000 ? `${(brl / 1000).toFixed(0)}k` : `${brl}`;
      return `R$ ${k}`;
    };

    return {
      lang,
      currency,
      setLang,
      setCurrency,
      t,
      fmtMoney,
      moneySymbol,
      fmtMoneyThreshold,
    };
  }, [lang, currency, setLang, setCurrency]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ── Hooks ──────────────────────────────────────────────────
export function useI18n(): I18nContextValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n() must be used within <I18nProvider>");
  return v;
}

// Convenience: just the `t` function, matches prototype's useT().
export function useT() {
  return useI18n().t;
}
