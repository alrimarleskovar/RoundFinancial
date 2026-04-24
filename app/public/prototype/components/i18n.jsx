// RoundFi — i18n + currency + connection state (global reactive store)
//
// Exposes:
//   window.APP_STATE      — { lang, currency, connections }
//   window.useAppState()  — React hook that re-renders on changes
//   window.useT()         — returns t(key) → string in current lang
//   window.t(key)         — non-hook version (for use outside components)
//   window.fmtMoney(n)    — formats in current currency (BRL or USDC)
//   window.setLang(lang)  — 'pt' | 'en'
//   window.setCurrency(c) — 'BRL' | 'USDC'

// ── Exchange rate (editable) ────────────────────────────────
// Real-world: 1 USDC ≈ R$ 5.50 (reasonable 2026 mid-market rate)
const USDC_RATE = 5.50;

// ── Dictionary ──────────────────────────────────────────────
const DICT = {
  pt: {
    // sidebar & nav
    'nav.home':       'Início',
    'nav.groups':     'Grupos',
    'nav.score':      'Reputação',
    'nav.wallet':     'Carteira',
    'nav.market':     'Mercado',
    'nav.insights':   'Insights',
    // top bar
    'top.search':     'Buscar grupos, membros, atestados…',
    'top.deposit':    '+ Depositar',
    'top.network':    'Solana Mainnet',
    // home
    'home.badge':     '◆ Dashboard',
    'home.greeting':  'Bom dia,',
    'home.summary.a': 'Você tem',
    'home.summary.b': '1 parcela',
    'home.summary.c': 'vencendo em 5 dias e',
    'home.summary.d': 'de yield acumulado.',
    'home.yieldAmt':  '{v} de yield',
    'home.payInstallment': 'Pagar parcela',
    'home.joinGroup':      'Entrar em grupo',
    'home.kpi.balance':    'Saldo protegido',
    'home.kpi.score':      'Reputação',
    'home.kpi.yield':      'Yield Kamino',
    'home.kpi.colat':      'Colateral atual',
    'home.kpi.delta.balance': '+2,4% mês',
    'home.kpi.delta.yield':   '6,8% APY',
    'home.kpi.delta.lev':     '{x}x alav.',
    'home.kpi.delta.score':   '+{d} este mês',
    'home.yourGroups':     'Seus grupos',
    'home.seeAll':         'Ver tudo →',
    'home.featured':       '◆ Rodada ativa · destaque',
    'home.meta.prize':     'Prêmio',
    'home.meta.next':      'Próxima parcela',
    'home.meta.draw':      'Sorteio',
    'home.drawIn':         '5 dias',
    'home.installments':   'cotas',
    'home.drawn':          'sorteadas',
    'home.installment':    'Parcela',
    'home.month':          'Mês',
    'home.passport':       '◆ SAS Passport',
    'home.shield':         '◆ Triplo Escudo · ativo',
    'home.activity':       '◆ Atividade recente',
    'level.proven':        'COMPROVADO Nv.2',
    'level.beginner':      'Iniciante',
    'level.provenName':    'Comprovado',
    'level.veteran':       'Veterano',
    'level.youLabel':      '← VOCÊ',
    'level.ptsToNext':     '{n} pts até Veterano',
    // groups
    'groups.badge':        '◆ Catálogo',
    'groups.title':        'Grupos disponíveis',
    'groups.subtitle':     '{open} grupos com vagas abertas · seu nível atual dá acesso a {access}',
    'groups.newCycle':     'Abrir novo ciclo',
    'groups.search':       'Buscar por nome do grupo…',
    'groups.sort.relevant':  'Relevância',
    'groups.sort.priceLow':  'Prêmio ↑',
    'groups.sort.priceHigh': 'Prêmio ↓',
    'groups.sort.spots':     'Vagas restantes',
    'groups.filter.level':   'Nível',
    'groups.filter.category':'Categoria',
    'groups.filter.prize':   'Prêmio',
    'groups.filter.duration':'Duração',
    'groups.filter.avail':   'Disponibilidade',
    'groups.chip.all':       'Todos',
    'groups.chip.any':       'Qualquer',
    'groups.chip.onlyOpen':  'Apenas com vagas',
    'groups.chip.lt6':       '≤ 6 meses',
    'groups.chip.7to12':     '7–12 meses',
    'groups.chip.gt12':      '> 12 meses',
    'groups.chip.lt15':      '< {v}',
    'groups.chip.15to30':    '{a} – {b}',
    'groups.chip.gt30':      '> {v}',
    'groups.lvl1':           'Nv.1 Iniciante',
    'groups.lvl2':           'Nv.2 Comprovado',
    'groups.lvl3':           'Nv.3 ✦ VIP',
    'groups.ofN':            '{n} de {total} grupos · {c} filtro{s} ativo{s}',
    'groups.clear':          'Limpar filtros',
    'groups.empty.title':    'Nenhum grupo com esses filtros',
    'groups.empty.sub':      'Tente relaxar os critérios ou abra um novo ciclo.',
    'groups.card.joined':    '✓ No grupo',
    'groups.card.vip':       '✦ VIP',
    'groups.card.nv1':       'Nv.1+',
    'groups.card.cta.view':  'Ver detalhes',
    'groups.card.cta.join':  'Entrar no grupo',
    'groups.card.spots':     '{f}/{t} cotas',
    'cat.pme':       'PME',
    'cat.vip':       '✦ VIP',
    'cat.dev':       'Dev/Profissional',
    'cat.delivery':  'Delivery',
    'cat.estudo':    'Estudo',
    'cat.casa':      'Casa',
    'cat.pessoal':   'Pessoal',
    // wallet
    'wallet.badge':       '◆ Carteira multi-cofre',
    'wallet.title':       'Sua posição na RoundFi',
    'wallet.send':        'Enviar',
    'wallet.receive':     'Receber',
    'wallet.tab.overview':     'Visão geral',
    'wallet.tab.positions':    'Posições NFT',
    'wallet.tab.transactions': 'Transações',
    'wallet.tab.connections':  'Conexões',
    'wallet.total':       'SALDO TOTAL · {c}',
    'wallet.comp':        'COMPOSIÇÃO',
    'wallet.quota':       'Cotas ativas',
    'wallet.yieldVault':  'Yield vault',
    'wallet.collateral':  'Colateral',
    'wallet.free':        'Livre',
    'wallet.kamino':      '◆ Kamino Vault',
    'wallet.yieldAcc':    'Rendimento acumulado · 2 ciclos',
    'wallet.withdraw':    'Sacar rendimento',
    'wallet.positions':   '◆ Cotas NFT em custódia',
    'wallet.positions.c': '{n} posições',
    'wallet.tx.recent':   '◆ Atividade recente',
    'wallet.tx.all':      '◆ Todas as transações',
    'wallet.tx.seeAll':   'Ver tudo →',
    'wallet.sell':        'Vender',
    'wallet.expires':     'expira {d}',
    // connections
    'conn.badge':         '◆ Integrações ativas',
    'conn.count':         '{c} de {t} conectadas',
    'conn.connected':     'conectado',
    'conn.disconnected':  'desconectado',
    'conn.pending':       'pendente',
    'conn.since':         'desde {d}',
    'conn.details':       'Detalhes',
    'conn.perms':         'Permissões concedidas',
    'conn.manage':        'Gerenciar permissões',
    'conn.revoke':        'Desconectar',
    'conn.connect':       'Conectar {n}',
    'conn.connecting':    'Conectando…',
    'conn.reconnect':     'Reconectar',
    'conn.keys.title':    'Suas chaves, seu controle',
    'conn.keys.body':     'Todas as integrações rodam em Solana com permissões granulares. Você revoga a qualquer momento — o RoundFi nunca custodia seus ativos.',
    'conn.soon':          '◆ Em breve',
    'conn.roadmap':       'roadmap',
    'conn.phantom.tag':   'Wallet Solana · custódia self-custodial',
    'conn.solflare.tag':  'Wallet alternativa · Solana',
    'conn.civic.tag':     'Verificação de identidade · passaporte on-chain',
    'conn.kamino.tag':    'Yield vault · USDC · APY 6,8%',
    'conn.pix.tag':       'Depósitos em reais · liquidação D+0',
    'conn.phantom.addr':  'Endereço',
    'conn.phantom.net':   'Rede',
    'conn.phantom.mainnet':'Solana Mainnet Beta',
    'conn.phantom.sigs':  'Assinaturas neste mês',
    'conn.phantom.sigsV': '{n} transações',
    'conn.phantom.p1':    'Assinar transações',
    'conn.phantom.p2':    'Aprovar mints de NFT',
    'conn.phantom.p3':    'Ler saldo da carteira',
    'conn.civic.passId':  'Pass ID',
    'conn.civic.tier':    'Nível de verificação',
    'conn.civic.tierV':   'Tier 2 · KYC + Proof-of-Personhood',
    'conn.civic.exp':     'Expira',
    'conn.civic.p1':      'Ler atributos verificados',
    'conn.civic.p2':      'Assinar atestados SAS',
    'conn.kamino.vault':  'Vault',
    'conn.kamino.alloc':  'Capital alocado',
    'conn.kamino.yield':  'Rendimento acumulado',
    'conn.kamino.p1':     'Depositar no vault',
    'conn.kamino.p2':     'Sacar rendimento',
    'conn.kamino.p3':     'Ler saldo',
    'conn.pix.provider':  'Provedor',
    'conn.pix.notSet':    'Não configurado',
    'conn.pix.req':       'Requisitos',
    'conn.pix.reqV':      'CPF + conta bancária brasileira',
    'conn.pix.p1':        'Converter {c1} → {c2}',
    'conn.pix.p2':        'Converter {c2} → {c1}',
    'conn.soon.marginfi': 'Colateral alternativo',
    'conn.soon.solflare': 'Wallet adicional',
    'conn.soon.jupiter':  'Swap integrado BRL/USDC',
    'conn.soon.openfin':  'Score bancário complementar',
    // footer / misc
    'footer.rightsReserved': 'Suas chaves, seu controle.',
  },

  en: {
    'nav.home':       'Home',
    'nav.groups':     'Groups',
    'nav.score':      'Reputation',
    'nav.wallet':     'Wallet',
    'nav.market':     'Market',
    'nav.insights':   'Insights',
    'top.search':     'Search groups, members, attestations…',
    'top.deposit':    '+ Deposit',
    'top.network':    'Solana Mainnet',
    'home.badge':     '◆ Dashboard',
    'home.greeting':  'Good morning,',
    'home.summary.a': 'You have',
    'home.summary.b': '1 installment',
    'home.summary.c': 'due in 5 days and',
    'home.summary.d': 'of yield accrued.',
    'home.yieldAmt':  '{v} in yield',
    'home.payInstallment': 'Pay installment',
    'home.joinGroup':      'Join a group',
    'home.kpi.balance':    'Protected balance',
    'home.kpi.score':      'Reputation',
    'home.kpi.yield':      'Kamino yield',
    'home.kpi.colat':      'Current collateral',
    'home.kpi.delta.balance': '+2.4% mo',
    'home.kpi.delta.yield':   '6.8% APY',
    'home.kpi.delta.lev':     '{x}x lev.',
    'home.kpi.delta.score':   '+{d} this month',
    'home.yourGroups':     'Your groups',
    'home.seeAll':         'See all →',
    'home.featured':       '◆ Active round · featured',
    'home.meta.prize':     'Prize',
    'home.meta.next':      'Next installment',
    'home.meta.draw':      'Draw',
    'home.drawIn':         '5 days',
    'home.installments':   'shares',
    'home.drawn':          'drawn',
    'home.installment':    'Installment',
    'home.month':          'Month',
    'home.passport':       '◆ SAS Passport',
    'home.shield':         '◆ Triple Shield · active',
    'home.activity':       '◆ Recent activity',
    'level.proven':        'PROVEN Lv.2',
    'level.beginner':      'Beginner',
    'level.provenName':    'Proven',
    'level.veteran':       'Veteran',
    'level.youLabel':      '← YOU',
    'level.ptsToNext':     '{n} pts to Veteran',
    'groups.badge':        '◆ Catalog',
    'groups.title':        'Available groups',
    'groups.subtitle':     '{open} groups with open spots · your current level unlocks {access}',
    'groups.newCycle':     'Start new cycle',
    'groups.search':       'Search by group name…',
    'groups.sort.relevant':  'Relevance',
    'groups.sort.priceLow':  'Prize ↑',
    'groups.sort.priceHigh': 'Prize ↓',
    'groups.sort.spots':     'Spots left',
    'groups.filter.level':   'Level',
    'groups.filter.category':'Category',
    'groups.filter.prize':   'Prize',
    'groups.filter.duration':'Duration',
    'groups.filter.avail':   'Availability',
    'groups.chip.all':       'All',
    'groups.chip.any':       'Any',
    'groups.chip.onlyOpen':  'Only with spots',
    'groups.chip.lt6':       '≤ 6 months',
    'groups.chip.7to12':     '7–12 months',
    'groups.chip.gt12':      '> 12 months',
    'groups.chip.lt15':      '< {v}',
    'groups.chip.15to30':    '{a} – {b}',
    'groups.chip.gt30':      '> {v}',
    'groups.lvl1':           'Lv.1 Beginner',
    'groups.lvl2':           'Lv.2 Proven',
    'groups.lvl3':           'Lv.3 ✦ VIP',
    'groups.ofN':            '{n} of {total} groups · {c} active filter{s}',
    'groups.clear':          'Clear filters',
    'groups.empty.title':    'No groups match these filters',
    'groups.empty.sub':      'Try relaxing the criteria or start a new cycle.',
    'groups.card.joined':    '✓ Joined',
    'groups.card.vip':       '✦ VIP',
    'groups.card.nv1':       'Lv.1+',
    'groups.card.cta.view':  'View details',
    'groups.card.cta.join':  'Join group',
    'groups.card.spots':     '{f}/{t} shares',
    'cat.pme':       'SMB',
    'cat.vip':       '✦ VIP',
    'cat.dev':       'Dev/Professional',
    'cat.delivery':  'Delivery',
    'cat.estudo':    'Study',
    'cat.casa':      'Home',
    'cat.pessoal':   'Personal',
    'wallet.badge':       '◆ Multi-vault wallet',
    'wallet.title':       'Your RoundFi position',
    'wallet.send':        'Send',
    'wallet.receive':     'Receive',
    'wallet.tab.overview':     'Overview',
    'wallet.tab.positions':    'NFT Positions',
    'wallet.tab.transactions': 'Transactions',
    'wallet.tab.connections':  'Connections',
    'wallet.total':       'TOTAL BALANCE · {c}',
    'wallet.comp':        'COMPOSITION',
    'wallet.quota':       'Active shares',
    'wallet.yieldVault':  'Yield vault',
    'wallet.collateral':  'Collateral',
    'wallet.free':        'Free',
    'wallet.kamino':      '◆ Kamino Vault',
    'wallet.yieldAcc':    'Accrued yield · 2 cycles',
    'wallet.withdraw':    'Withdraw yield',
    'wallet.positions':   '◆ NFT shares in escrow',
    'wallet.positions.c': '{n} positions',
    'wallet.tx.recent':   '◆ Recent activity',
    'wallet.tx.all':      '◆ All transactions',
    'wallet.tx.seeAll':   'See all →',
    'wallet.sell':        'Sell',
    'wallet.expires':     'expires {d}',
    'conn.badge':         '◆ Active integrations',
    'conn.count':         '{c} of {t} connected',
    'conn.connected':     'connected',
    'conn.disconnected':  'disconnected',
    'conn.pending':       'pending',
    'conn.since':         'since {d}',
    'conn.details':       'Details',
    'conn.perms':         'Granted permissions',
    'conn.manage':        'Manage permissions',
    'conn.revoke':        'Disconnect',
    'conn.connect':       'Connect {n}',
    'conn.connecting':    'Connecting…',
    'conn.reconnect':     'Reconnect',
    'conn.keys.title':    'Your keys, your control',
    'conn.keys.body':     'All integrations run on Solana with granular permissions. Revoke any time — RoundFi never custodies your assets.',
    'conn.soon':          '◆ Coming soon',
    'conn.roadmap':       'roadmap',
    'conn.phantom.tag':   'Solana wallet · self-custodial',
    'conn.solflare.tag':  'Alternative Solana wallet',
    'conn.civic.tag':     'Identity verification · on-chain passport',
    'conn.kamino.tag':    'Yield vault · USDC · 6.8% APY',
    'conn.pix.tag':       'BRL deposits · T+0 settlement',
    'conn.phantom.addr':  'Address',
    'conn.phantom.net':   'Network',
    'conn.phantom.mainnet':'Solana Mainnet Beta',
    'conn.phantom.sigs':  'Signatures this month',
    'conn.phantom.sigsV': '{n} transactions',
    'conn.phantom.p1':    'Sign transactions',
    'conn.phantom.p2':    'Approve NFT mints',
    'conn.phantom.p3':    'Read wallet balance',
    'conn.civic.passId':  'Pass ID',
    'conn.civic.tier':    'Verification tier',
    'conn.civic.tierV':   'Tier 2 · KYC + Proof-of-Personhood',
    'conn.civic.exp':     'Expires',
    'conn.civic.p1':      'Read verified attributes',
    'conn.civic.p2':      'Sign SAS attestations',
    'conn.kamino.vault':  'Vault',
    'conn.kamino.alloc':  'Allocated capital',
    'conn.kamino.yield':  'Accrued yield',
    'conn.kamino.p1':     'Deposit in vault',
    'conn.kamino.p2':     'Withdraw yield',
    'conn.kamino.p3':     'Read balance',
    'conn.pix.provider':  'Provider',
    'conn.pix.notSet':    'Not configured',
    'conn.pix.req':       'Requirements',
    'conn.pix.reqV':      'CPF + Brazilian bank account',
    'conn.pix.p1':        'Convert {c1} → {c2}',
    'conn.pix.p2':        'Convert {c2} → {c1}',
    'conn.soon.marginfi': 'Alternative collateral',
    'conn.soon.solflare': 'Additional wallet',
    'conn.soon.jupiter':  'Integrated BRL/USDC swap',
    'conn.soon.openfin':  'Complementary bank score',
    'footer.rightsReserved': 'Your keys, your control.',
  },
};

// ── Reactive store (pub/sub, no React dep) ─────────────────
const APP_STATE = {
  lang: 'pt',
  currency: 'BRL',      // 'BRL' | 'USDC'
  connections: {
    civic:    { status: 'connected', since: 'Mar 2026' },
    kamino:   { status: 'connected', since: 'Jan 2026' },
    phantom:  { status: 'connected', since: 'Jan 2026' },
    solflare: { status: 'disconnected' },
    pix:      { status: 'pending' },
  },
  _listeners: new Set(),
};

function subscribe(fn) {
  APP_STATE._listeners.add(fn);
  return () => APP_STATE._listeners.delete(fn);
}
function notify() {
  APP_STATE._listeners.forEach(fn => fn());
}

function setLang(lang) {
  APP_STATE.lang = lang;
  document.documentElement.setAttribute('lang', lang === 'pt' ? 'pt-BR' : 'en');
  notify();
}
function setCurrency(c) {
  APP_STATE.currency = c;
  notify();
}
function setConnection(id, status, extra = {}) {
  APP_STATE.connections[id] = {
    ...(APP_STATE.connections[id] || {}),
    status,
    ...extra,
  };
  notify();
}

// React hook — re-renders on any state change
function useAppState() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => subscribe(() => setTick(t => t + 1)), []);
  return APP_STATE;
}

// ── Translation helper ─────────────────────────────────────
function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] != null ? params[k] : `{${k}}`);
}

function t(key, params) {
  const table = DICT[APP_STATE.lang] || DICT.pt;
  const raw = table[key] ?? DICT.pt[key] ?? key;
  return interpolate(raw, params);
}

function useT() {
  useAppState();   // subscribe
  return t;
}

// ── Currency formatting ────────────────────────────────────
// Input is always in BRL (the underlying data model).
// If APP_STATE.currency === 'USDC', converts at USDC_RATE.
function fmtMoney(brlAmount, opts = {}) {
  const { compact = false, noCents = false, signed = false } = opts;
  const currency = APP_STATE.currency;
  const lang     = APP_STATE.lang;
  const isUSDC   = currency === 'USDC';

  const amount  = isUSDC ? brlAmount / USDC_RATE : brlAmount;
  const locale  = lang === 'pt' ? 'pt-BR' : 'en-US';
  const minDec  = noCents ? 0 : 2;
  const maxDec  = noCents ? 0 : 2;

  let num;
  if (compact && Math.abs(amount) >= 1000) {
    num = amount.toLocaleString(locale, {
      notation: 'compact', compactDisplay: 'short',
      maximumFractionDigits: 1,
    });
  } else {
    num = amount.toLocaleString(locale, {
      minimumFractionDigits: minDec, maximumFractionDigits: maxDec,
    });
  }

  const prefix = signed && brlAmount > 0 ? '+' : '';
  if (isUSDC) return `${prefix}${num} USDC`;
  return `${prefix}R$ ${num}`;
}

// Short symbol for inline headers (e.g. "< R$ 15k" / "< $2.7k")
function moneySymbol() {
  return APP_STATE.currency === 'USDC' ? 'USDC' : 'R$';
}

// Converted-raw value for threshold filters, when comparing
// against user-entered numbers. (Internally we store BRL only,
// so filters just stay in BRL — but labels change.)
function fmtMoneyThreshold(brlValue) {
  if (APP_STATE.currency === 'USDC') {
    const u = (brlValue / USDC_RATE);
    const k = u >= 1000 ? `${(u / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${u.toFixed(0)}`;
    return `${k} USDC`;
  }
  const k = brlValue >= 1000 ? `${(brlValue / 1000).toFixed(0)}k` : `${brlValue}`;
  return `R$ ${k}`;
}

// ── Publish ────────────────────────────────────────────────
Object.assign(window, {
  APP_STATE, DICT, USDC_RATE,
  subscribe, setLang, setCurrency, setConnection,
  useAppState, useT, t,
  fmtMoney, moneySymbol, fmtMoneyThreshold,
});
