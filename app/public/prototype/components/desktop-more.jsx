// RoundFi — Desktop screens: Wallet, Mercado (secondary market), Insights

// ─────────────────────────────────────────────────────────────
// WALLET
// ─────────────────────────────────────────────────────────────
function DeskWallet({ go }) {
  const t = useT();
  const state = useAppState();
  const connectedCount = Object.values(state.connections).filter(c => c.status === 'connected').length;
  const totalCount = Object.keys(state.connections).length;
  const [tab, setTab] = React.useState('overview');
  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <MonoLabel color={RFI.green}>{t('wallet.badge')}</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 32, fontWeight: 800, color: RFI.text,
                        letterSpacing: '-0.03em', marginTop: 4 }}>{t('wallet.title')}</div>
          <div style={{ fontSize: 13, color: RFI.text2, marginTop: 4 }}>
            {t('conn.keys.body').split('.')[0]}.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnSoft()}>{t('wallet.receive')}</button>
          <button style={btnPrimary()}>{t('wallet.send')}</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ marginTop: 24, display: 'flex', gap: 2, borderBottom: `1px solid ${RFI.border}` }}>
        {[
          ['overview', t('wallet.tab.overview')],
          ['positions', t('wallet.tab.positions')],
          ['transactions', t('wallet.tab.transactions')],
          ['connections', t('wallet.tab.connections')],
        ].map(([id, label]) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '12px 18px', background: 'none', border: 'none', cursor: 'pointer',
              color: active ? RFI.text : RFI.text2,
              fontSize: 13, fontWeight: active ? 600 : 500,
              fontFamily: 'DM Sans, sans-serif',
              borderBottom: `2px solid ${active ? RFI.green : 'transparent'}`,
              marginBottom: -1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {label}
              {id === 'connections' && (
                <span style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 999,
                  background: `${RFI.green}22`, color: RFI.green,
                  fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                }}>{connectedCount}/{totalCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <WalletOverview/>}
      {tab === 'positions' && <WalletPositions/>}
      {tab === 'transactions' && <WalletTransactions/>}
      {tab === 'connections' && <WalletConnections/>}
    </div>
  );
}

function WalletOverview() {
  const t = useT();
  useAppState();
  return (
    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div style={{
          padding: 28, borderRadius: 20, position: 'relative', overflow: 'hidden',
          background: `linear-gradient(145deg, ${RFI.navy} 0%, ${RFI.surface1} 80%)`,
          border: `1px solid ${RFI.border}`,
        }}>
          <div style={{
            position: 'absolute', top: -80, right: -60, width: 300, height: 300,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${RFI.green}22, transparent 65%)`,
          }}/>
          <div style={{ position: 'relative' }}>
            <MonoLabel>{t('wallet.total', { c: APP_STATE.currency })}</MonoLabel>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontFamily: 'Syne', fontSize: 64, fontWeight: 800, color: RFI.text,
                             letterSpacing: '-0.04em', lineHeight: 1 }}>
                {fmtMoney(USER.balance)}
              </span>
            </div>
            <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12,
                          fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ color: RFI.green }}>{fmtMoney(248.12, { signed: true })} · 24h</span>
              <span style={{ color: RFI.text2 }}>{t('home.kpi.delta.balance')}</span>
            </div>

            {/* composition bar */}
            <div style={{ marginTop: 28 }}>
              <MonoLabel size={9}>{t('wallet.comp')}</MonoLabel>
              <div style={{ marginTop: 10, display: 'flex', height: 10, borderRadius: 6,
                            overflow: 'hidden' }}>
                <div style={{ flex: 5.2, background: RFI.green }}/>
                <div style={{ flex: 2.8, background: RFI.teal }}/>
                <div style={{ flex: 1.4, background: RFI.purple }}/>
                <div style={{ flex: 0.6, background: RFI.amber }}/>
              </div>
              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                {[
                  { c: RFI.green,  l: t('wallet.quota'),      brl: 4380, pct: '52%' },
                  { c: RFI.teal,   l: t('wallet.yieldVault'), brl: 2360, pct: '28%' },
                  { c: RFI.purple, l: t('wallet.collateral'), brl: 1180, pct: '14%' },
                  { c: RFI.amber,  l: t('wallet.free'),       brl: 500,  pct: '6%' },
                ].map(x => (
                  <div key={x.l}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 2, background: x.c }}/>
                      <span style={{ fontSize: 10, color: RFI.muted,
                                     fontFamily: 'JetBrains Mono, monospace' }}>{x.pct}</span>
                    </div>
                    <div style={{ fontSize: 11, color: RFI.text2, marginTop: 3 }}>{x.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: RFI.text, marginTop: 2 }}>
                      {fmtMoney(x.brl, { noCents: true })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Vault card */}
        <div style={{
          padding: 22, borderRadius: 20, position: 'relative', overflow: 'hidden',
          background: RFI.surface1, border: `1px solid ${RFI.border}`,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <MonoLabel color={RFI.teal}>{t('wallet.kamino')}</MonoLabel>
            <RFIPill tone="t">APY 6,8%</RFIPill>
          </div>
          <div style={{ fontFamily: 'Syne', fontSize: 36, fontWeight: 800, color: RFI.text,
                        letterSpacing: '-0.03em', marginTop: 14 }}>
            {fmtMoney(USER.yield)}
          </div>
          <div style={{ fontSize: 11, color: RFI.muted, marginTop: 4,
                        fontFamily: 'JetBrains Mono, monospace' }}>
            {t('wallet.yieldAcc')}
          </div>

          <div style={{ marginTop: 18, flex: 1 }}>
            {/* mini sparkline */}
            <svg viewBox="0 0 200 60" style={{ width: '100%', height: 80 }}>
              <defs>
                <linearGradient id="spark-g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={RFI.teal} stopOpacity="0.4"/>
                  <stop offset="1" stopColor={RFI.teal} stopOpacity="0"/>
                </linearGradient>
              </defs>
              <path d="M0,50 L20,48 L40,42 L60,44 L80,36 L100,32 L120,34 L140,24 L160,20 L180,14 L200,10 L200,60 L0,60 Z"
                    fill="url(#spark-g)"/>
              <path d="M0,50 L20,48 L40,42 L60,44 L80,36 L100,32 L120,34 L140,24 L160,20 L180,14 L200,10"
                    fill="none" stroke={RFI.teal} strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <button style={{
            marginTop: 8, width: '100%', padding: 11, borderRadius: 11,
            background: RFI.fillSoft, border: `1px solid ${RFI.borderStr}`,
            color: RFI.text, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>{t('wallet.withdraw')}</button>
        </div>
      </div>

      {/* Quick preview: 2 positions + 3 recent tx */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <WalletPositionsList limit={2}/>
        <WalletTransactionsList limit={3}/>
      </div>
    </div>
  );
}

// ── Positions tab (full list) ───────────────────────────────
function WalletPositions() {
  return (
    <div style={{ marginTop: 20 }}>
      <WalletPositionsList/>
    </div>
  );
}

function WalletPositionsList({ limit }) {
  const t = useT();
  useAppState();
  const rows = limit ? NFT_POSITIONS.slice(0, limit) : NFT_POSITIONS;
  return (
    <div style={{
      padding: 20, borderRadius: 18,
      background: RFI.surface1, border: `1px solid ${RFI.border}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <MonoLabel color={RFI.green}>{t('wallet.positions')}</MonoLabel>
        <span style={{ fontSize: 11, color: RFI.muted,
                       fontFamily: 'JetBrains Mono, monospace' }}>
          {t('wallet.positions.c', { n: NFT_POSITIONS.length })}
        </span>
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(n => {
          const c = { g: RFI.green, t: RFI.teal, p: RFI.purple }[n.tone];
          return (
            <div key={n.id} style={{
              display: 'grid', gridTemplateColumns: '52px 1fr auto auto', gap: 14,
              padding: 12, borderRadius: 12,
              background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
              alignItems: 'center',
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: 10,
                background: `linear-gradient(135deg, ${c}33, ${c}11)`,
                border: `1px solid ${c}4D`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'Syne', fontWeight: 800, fontSize: 14, color: c,
                flexDirection: 'column',
              }}>
                <span style={{ fontSize: 8, opacity: 0.7,
                               fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 }}>#</span>
                {n.num}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: RFI.text }}>{n.group}</div>
                <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                              fontFamily: 'JetBrains Mono, monospace' }}>
                  {t('home.month')} {n.month}/{n.total} · {t('wallet.expires', { d: n.exp })}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'Syne', fontSize: 15, fontWeight: 700, color: RFI.text }}>
                  {fmtMoney(n.value, { noCents: true })}
                </div>
                <div style={{ fontSize: 10, color: RFI.green, marginTop: 2,
                              fontFamily: 'JetBrains Mono, monospace' }}>+{n.yieldPct}%</div>
              </div>
              {!limit && (
                <button style={{
                  padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', border: `1px solid ${RFI.borderStr}`,
                  color: RFI.text, fontSize: 11, fontWeight: 600,
                }}>{t('wallet.sell')}</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Transactions tab ─────────────────────────────────────
function WalletTransactions() {
  return (
    <div style={{ marginTop: 20 }}>
      <WalletTransactionsList/>
    </div>
  );
}

function WalletTransactionsList({ limit }) {
  const t = useT();
  useAppState();
  const rows = limit ? TX_LIST.slice(0, limit) : TX_LIST;
  return (
    <div style={{
      padding: 20, borderRadius: 18,
      background: RFI.surface1, border: `1px solid ${RFI.border}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <MonoLabel color={RFI.green}>{limit ? t('wallet.tx.recent') : t('wallet.tx.all')}</MonoLabel>
        {limit && <span style={{ fontSize: 11, color: RFI.muted, cursor: 'pointer',
                       fontFamily: 'JetBrains Mono, monospace' }}>{t('wallet.tx.seeAll')}</span>}
      </div>
      <div style={{ marginTop: 12 }}>
        {rows.map((tx, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '28px 1fr auto auto', gap: 12,
            padding: '12px 0',
            borderBottom: i < rows.length - 1 ? `1px solid ${RFI.border}` : 'none',
            alignItems: 'center',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: RFI.fillSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: tx.amount > 0 ? RFI.green : RFI.text2,
            }}>
              {tx.amount > 0 ? <Icons.arrow size={12} sw={2}/> : <Icons.send size={12} sw={1.8}/>}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text }}>{tx.label}</div>
              <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                            fontFamily: 'JetBrains Mono, monospace' }}>{tx.addr}</div>
            </div>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 600,
                           color: tx.amount > 0 ? RFI.green : RFI.text }}>
              {fmtMoney(tx.amount, { noCents: true, signed: true })}
            </span>
            <span style={{ fontSize: 10, color: RFI.muted,
                           fontFamily: 'JetBrains Mono, monospace' }}>{tx.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const NFT_POSITIONS = [
  { id: 'n1', num: '03', group: 'Renovação MEI · 12m', tone: 'g', month: 4, total: 12, exp: 'dez/26', value: 1890, yieldPct: 6.8 },
  { id: 'n2', num: '07', group: 'Dev Setup · 6m', tone: 'p', month: 3, total: 6, exp: 'jul/26', value: 1420, yieldPct: 5.2 },
  { id: 'n3', num: '01', group: 'Intercâmbio 2026', tone: 't', month: 2, total: 12, exp: 'fev/27', value: 1070, yieldPct: 4.1 },
];

const TX_LIST = [
  { label: 'Parcela · Renovação MEI',   addr: '7xG3…k9Fn → escrow', amount: -892.40, date: '12 ABR' },
  { label: 'Yield · Kamino vault',       addr: 'kamino.usdc.pool',   amount: +52.30,  date: '10 ABR' },
  { label: 'Venda cota #03 · secundário',addr: 'Pedro S. · @petrus', amount: +1890,   date: '05 ABR' },
  { label: 'Depósito PIX',               addr: 'via Solflare',       amount: +500,    date: '03 ABR' },
  { label: 'Parcela · Dev Setup',        addr: '7xG3…k9Fn → escrow', amount: -460,    date: '01 ABR' },
];

// ─────────────────────────────────────────────────────────────
// SECONDARY MARKET
// ─────────────────────────────────────────────────────────────
function DeskMarket({ go }) {
  const [tab, setTab] = React.useState('buy');
  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <MonoLabel color={RFI.green}>◆ Mercado secundário</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 32, fontWeight: 800, color: RFI.text,
                        letterSpacing: '-0.03em', marginTop: 4 }}>
            Compre posições com desconto
          </div>
          <div style={{ fontSize: 13, color: RFI.text2, marginTop: 4 }}>
            A "válvula de escape" — provedores de liquidez ganham yield, tomadores saem antes.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 11,
                      background: RFI.fillSoft, border: `1px solid ${RFI.border}` }}>
          {[['buy','Comprar cotas'], ['sell','Vender minhas']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer', border: 'none',
              background: tab === id ? RFI.surface2 : 'transparent',
              color: tab === id ? RFI.text : RFI.text2,
              fontSize: 12, fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        <DeskMiniStat l="Volume 24h" v="R$ 48.2k" d="+12%" c={RFI.green}/>
        <DeskMiniStat l="Cotas abertas" v="27" d="3 novas" c={RFI.teal}/>
        <DeskMiniStat l="Desconto médio" v="−11,4%" d="vs. face" c={RFI.amber}/>
        <DeskMiniStat l="APY médio LP" v="7,2%" d="rolling 30d" c={RFI.purple}/>
      </div>

      {tab === 'buy' ? (
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
          {/* Order book */}
          <div style={{
            padding: 20, borderRadius: 18,
            background: RFI.surface1, border: `1px solid ${RFI.border}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <MonoLabel color={RFI.green}>◆ Ofertas abertas</MonoLabel>
              <span style={{ fontSize: 11, color: RFI.muted,
                             fontFamily: 'JetBrains Mono, monospace' }}>
                ordenado por desconto
              </span>
            </div>
            {/* header */}
            <div style={{
              marginTop: 14, display: 'grid',
              gridTemplateColumns: '60px 1.3fr 1fr 1fr 1fr auto', gap: 12,
              padding: '0 12px 8px', borderBottom: `1px solid ${RFI.border}`,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.muted,
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              <span>Cota</span><span>Grupo</span><span>Face</span><span>Preço</span><span>Desc.</span><span/>
            </div>
            {MARKET_OFFERS.map((o, i) => (
              <div key={o.id} style={{
                display: 'grid', gridTemplateColumns: '60px 1.3fr 1fr 1fr 1fr auto', gap: 12,
                padding: '12px', alignItems: 'center',
                borderBottom: i < MARKET_OFFERS.length - 1 ? `1px solid ${RFI.border}` : 'none',
              }}>
                <div style={{
                  fontFamily: 'Syne', fontSize: 15, fontWeight: 800, color: RFI.text,
                  display: 'flex', alignItems: 'baseline', gap: 2,
                }}>
                  <span style={{ fontSize: 10, color: RFI.muted,
                                 fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 }}>#</span>
                  {o.num}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text }}>{o.group}</div>
                  <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                                fontFamily: 'JetBrains Mono, monospace' }}>
                    Mês {o.month}/{o.total}
                  </div>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                              color: RFI.text2 }}>
                  R$ {o.face.toLocaleString('pt-BR')}
                </div>
                <div style={{ fontFamily: 'Syne', fontSize: 14, fontWeight: 700, color: RFI.text }}>
                  R$ {o.price.toLocaleString('pt-BR')}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                              color: RFI.green, fontWeight: 600 }}>
                  −{o.disc}%
                </div>
                <button style={{
                  padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: RFI.fillSoft, color: RFI.text, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${RFI.borderStr}`,
                }}>Comprar</button>
              </div>
            ))}
          </div>

          {/* Sidebar — featured */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              padding: 22, borderRadius: 18, position: 'relative', overflow: 'hidden',
              background: `linear-gradient(145deg, ${RFI.purple}22, ${RFI.surface1} 70%)`,
              border: `1px solid ${RFI.purple}33`,
            }}>
              <MonoLabel color={RFI.purple}>◆ Destaque do dia</MonoLabel>
              <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 700, color: RFI.text,
                            marginTop: 10, letterSpacing: '-0.02em' }}>
                Dev Setup · cota #04
              </div>
              <div style={{ fontSize: 12, color: RFI.text2, marginTop: 4 }}>
                4 meses restantes · score do vendedor 712
              </div>
              <div style={{ marginTop: 18, padding: 14, borderRadius: 12,
                            background: RFI.fillSoft, border: `1px solid ${RFI.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <MonoLabel size={9}>FACE</MonoLabel>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                                 color: RFI.text2 }}>R$ 1.840</span>
                </div>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <MonoLabel size={9} color={RFI.green}>SEU PREÇO</MonoLabel>
                  <span style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 800, color: RFI.text,
                                 letterSpacing: '-0.02em' }}>R$ 1.620</span>
                </div>
                <div style={{ marginTop: 10, height: 3, background: RFI.fillMed, borderRadius: 999 }}>
                  <div style={{ width: '88%', height: '100%',
                                background: `linear-gradient(90deg, ${RFI.purple}, ${RFI.teal})`,
                                borderRadius: 999 }}/>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8,
                              fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                              color: RFI.muted }}>
                  <span>desconto efetivo</span>
                  <span style={{ color: RFI.green }}>−12% → 7,8% APY</span>
                </div>
              </div>
              <button style={{
                marginTop: 12, width: '100%', padding: 11, borderRadius: 11,
                background: `linear-gradient(135deg, ${RFI.purple}, ${RFI.teal})`,
                color: '#fff', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}>Comprar agora</button>
            </div>
            <div style={{
              padding: 18, borderRadius: 16,
              background: RFI.surface1, border: `1px solid ${RFI.border}`,
            }}>
              <MonoLabel color={RFI.green}>◆ Como funciona</MonoLabel>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['01', 'Tomador vende sua cota com desconto'],
                  ['02', 'Você recebe o NFT com rendimento fixado'],
                  ['03', 'Escrow continua pagando normalmente'],
                  ['04', 'Ganha no sorteio ou resgata no fim'],
                ].map(([n, t]) => (
                  <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                      color: RFI.green, fontWeight: 600, flexShrink: 0, marginTop: 1,
                    }}>{n}</span>
                    <span style={{ fontSize: 11, color: RFI.text2 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          marginTop: 24, padding: 40, borderRadius: 18, textAlign: 'center',
          background: RFI.surface1, border: `1px dashed ${RFI.borderStr}`,
        }}>
          <MonoLabel color={RFI.amber}>◆ Vender cota</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 700, color: RFI.text,
                        marginTop: 8 }}>
            Listar uma posição NFT no mercado
          </div>
          <div style={{ fontSize: 12, color: RFI.text2, marginTop: 6, maxWidth: 420, margin: '6px auto 0' }}>
            Disponível direto do fluxo "Vender cota" no app mobile. Selecione a posição e defina desconto.
          </div>
        </div>
      )}
    </div>
  );
}

const MARKET_OFFERS = [
  { id: 'm1', num: '02', group: 'Intercâmbio 2026',     month: 2,  total: 12, face: 1640, price: 1440, disc: 12.2 },
  { id: 'm2', num: '05', group: 'Renovação MEI',        month: 4,  total: 12, face: 892,  price: 812,  disc: 9.0 },
  { id: 'm3', num: '11', group: 'PME · Capital de Giro',month: 7,  total: 18, face: 1520, price: 1320, disc: 13.2 },
  { id: 'm4', num: '04', group: 'Dev Setup · 6m',       month: 3,  total: 6,  face: 1840, price: 1620, disc: 12.0 },
  { id: 'm5', num: '08', group: 'Reforma Casa',         month: 5,  total: 24, face: 1200, price: 1092, disc: 9.0 },
  { id: 'm6', num: '14', group: 'Enxoval · 6m',         month: 4,  total: 6,  face: 740,  price: 680,  disc: 8.1 },
];

function DeskMiniStat({ l, v, d, c }) {
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: RFI.surface1, border: `1px solid ${RFI.border}`,
    }}>
      <MonoLabel size={9}>{l}</MonoLabel>
      <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 700, color: RFI.text,
                    marginTop: 6, letterSpacing: '-0.02em' }}>{v}</div>
      <div style={{ fontSize: 10, color: c, marginTop: 2,
                    fontFamily: 'JetBrains Mono, monospace' }}>{d}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// INSIGHTS
// ─────────────────────────────────────────────────────────────
function DeskInsights({ go }) {
  return (
    <div style={{ padding: 32 }}>
      <MonoLabel color={RFI.green}>◆ Insights</MonoLabel>
      <div style={{ fontFamily: 'Syne', fontSize: 32, fontWeight: 800, color: RFI.text,
                    letterSpacing: '-0.03em', marginTop: 4 }}>
        Seu comportamento financeiro
      </div>
      <div style={{ fontSize: 13, color: RFI.text2, marginTop: 4 }}>
        Sinais on-chain que moldam sua reputação SAS.
      </div>

      {/* Score evolution */}
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        <div style={{
          padding: 24, borderRadius: 18,
          background: RFI.surface1, border: `1px solid ${RFI.border}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <MonoLabel color={RFI.green}>◆ Evolução do score</MonoLabel>
              <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 700,
                            color: RFI.text, marginTop: 6 }}>
                {USER.score} <span style={{ fontSize: 12, color: RFI.green,
                    fontFamily: 'JetBrains Mono, monospace' }}>+{USER.scoreDelta} mês</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 8,
                          background: RFI.fillSoft, border: `1px solid ${RFI.border}` }}>
              {['1M','3M','6M','12M'].map((p, i) => (
                <button key={p} style={{
                  padding: '5px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: i === 2 ? RFI.surface2 : 'transparent',
                  color: i === 2 ? RFI.text : RFI.text2,
                  fontSize: 10, fontWeight: 600,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>{p}</button>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div style={{ marginTop: 20, position: 'relative', height: 220 }}>
            <svg viewBox="0 0 600 220" style={{ width: '100%', height: '100%' }}
                 preserveAspectRatio="none">
              <defs>
                <linearGradient id="ins-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={RFI.green} stopOpacity="0.25"/>
                  <stop offset="1" stopColor={RFI.green} stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* grid */}
              {[40, 90, 140, 190].map(y => (
                <line key={y} x1="0" y1={y} x2="600" y2={y}
                      stroke={RFI.border} strokeDasharray="2 4"/>
              ))}
              {/* area */}
              <path d="M0,190 L50,180 L100,170 L150,150 L200,160 L250,130 L300,120 L350,110 L400,90 L450,85 L500,70 L550,60 L600,50 L600,220 L0,220 Z"
                    fill="url(#ins-fill)"/>
              <path d="M0,190 L50,180 L100,170 L150,150 L200,160 L250,130 L300,120 L350,110 L400,90 L450,85 L500,70 L550,60 L600,50"
                    fill="none" stroke={RFI.green} strokeWidth="2" strokeLinecap="round"/>
              {/* level thresholds */}
              <line x1="0" y1="140" x2="600" y2="140" stroke={RFI.teal} strokeDasharray="4 4" strokeWidth="1"/>
              <line x1="0" y1="70" x2="600" y2="70" stroke={RFI.purple} strokeDasharray="4 4" strokeWidth="1"/>
              {/* current point */}
              <circle cx="550" cy="60" r="4" fill={RFI.green}/>
              <circle cx="550" cy="60" r="8" fill={RFI.green} opacity="0.2"/>
            </svg>
            {/* threshold labels */}
            <div style={{ position: 'absolute', left: 0, top: '23%',
                          fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                          color: RFI.purple, background: RFI.surface1, padding: '2px 6px',
                          borderRadius: 4 }}>Nv.3 VIP · 750</div>
            <div style={{ position: 'absolute', left: 0, top: '55%',
                          fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                          color: RFI.teal, background: RFI.surface1, padding: '2px 6px',
                          borderRadius: 4 }}>Nv.2 · 500</div>
          </div>

          {/* x axis */}
          <div style={{
            marginTop: 8, display: 'flex', justifyContent: 'space-between',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.muted,
          }}>
            {['Out','Nov','Dez','Jan','Fev','Mar','Abr'].map(m => <span key={m}>{m}</span>)}
          </div>
        </div>

        {/* Behavior breakdown */}
        <div style={{
          padding: 22, borderRadius: 18,
          background: RFI.surface1, border: `1px solid ${RFI.border}`,
        }}>
          <MonoLabel color={RFI.green}>◆ Fatores</MonoLabel>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { l: 'Pontualidade', v: 96, c: RFI.green,  d: '17/17 parcelas' },
              { l: 'Antecipações', v: 78, c: RFI.teal,   d: '3 pagamentos early' },
              { l: 'Consistência', v: 64, c: RFI.purple, d: '4 ciclos ativos' },
              { l: 'Engajamento',  v: 52, c: RFI.amber,  d: 'participa sem faltar' },
              { l: 'Diversidade',  v: 40, c: RFI.red,    d: '2 tipos de grupo' },
            ].map(f => (
              <div key={f.l}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, color: RFI.text, fontWeight: 500 }}>{f.l}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                                 color: f.c, fontWeight: 600 }}>{f.v}</span>
                </div>
                <div style={{ marginTop: 6, height: 4, background: RFI.fillMed, borderRadius: 999,
                              overflow: 'hidden' }}>
                  <div style={{ width: `${f.v}%`, height: '100%', background: f.c,
                                borderRadius: 999 }}/>
                </div>
                <div style={{ fontSize: 10, color: RFI.muted, marginTop: 4,
                              fontFamily: 'JetBrains Mono, monospace' }}>{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div style={{ marginTop: 20 }}>
        <MonoLabel color={RFI.green}>◆ Próximos passos para Nv.3</MonoLabel>
        <div style={{ marginTop: 12, display: 'grid',
                      gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[
            { n: '+24 pts', l: 'Pague 3 parcelas em antecipação',     d: 'no próximo ciclo',    c: RFI.green },
            { n: '+18 pts', l: 'Entre num grupo PME (diversidade)',    d: 'expande perfil',      c: RFI.teal  },
            { n: '+42 pts', l: 'Complete Renovação MEI sem atraso',    d: '8 parcelas restam',   c: RFI.purple},
          ].map(r => (
            <div key={r.n} style={{
              padding: 18, borderRadius: 14,
              background: RFI.surface1, border: `1px solid ${RFI.border}`,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                background: r.c,
              }}/>
              <div style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 800, color: r.c,
                            letterSpacing: '-0.02em' }}>{r.n}</div>
              <div style={{ fontSize: 13, color: RFI.text, fontWeight: 500, marginTop: 8 }}>{r.l}</div>
              <div style={{ fontSize: 11, color: RFI.muted, marginTop: 4,
                            fontFamily: 'JetBrains Mono, monospace' }}>{r.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CONNECTIONS — integrations tab
// ─────────────────────────────────────────────────────────────
// Static spec (non-reactive bits). Runtime status comes from APP_STATE.connections.
function getConnectionsSpec(t) {
  return [
    {
      id: 'phantom', name: 'Phantom',
      tone: 'p', tagline: t('conn.phantom.tag'),
      meta: [
        { l: t('conn.phantom.addr'), v: '7xG3kPQT7aFN1Fb8mJ…k9Fn', mono: true },
        { l: t('conn.phantom.net'),  v: t('conn.phantom.mainnet') },
        { l: t('conn.phantom.sigs'), v: t('conn.phantom.sigsV', { n: 14 }) },
      ],
      perms: [t('conn.phantom.p1'), t('conn.phantom.p2'), t('conn.phantom.p3')],
      glyph: 'phantom',
      featured: true,
    },
    {
      id: 'civic', name: 'Civic Pass',
      tone: 'g', tagline: t('conn.civic.tag'),
      meta: [
        { l: t('conn.civic.passId'), v: 'civic:pass:7xG3…k9Fn', mono: true },
        { l: t('conn.civic.tier'),   v: t('conn.civic.tierV') },
        { l: t('conn.civic.exp'),    v: '14 Mar 2027' },
      ],
      perms: [t('conn.civic.p1'), t('conn.civic.p2')],
      glyph: 'civic',
    },
    {
      id: 'kamino', name: 'Kamino Finance',
      tone: 't', tagline: t('conn.kamino.tag'),
      meta: [
        { l: t('conn.kamino.vault'), v: 'roundfi/escrow-usdc-v2', mono: true },
        { l: t('conn.kamino.alloc'), v: fmtMoney(2360) },
        { l: t('conn.kamino.yield'), v: `${fmtMoney(312.08)} (+6,8% APY)` },
      ],
      perms: [t('conn.kamino.p1'), t('conn.kamino.p2'), t('conn.kamino.p3')],
      glyph: 'kamino',
    },
    {
      id: 'solflare', name: 'Solflare',
      tone: 't', tagline: t('conn.solflare.tag'),
      meta: [
        { l: t('conn.phantom.addr'), v: '—', mono: true },
        { l: t('conn.phantom.net'),  v: t('conn.phantom.mainnet') },
      ],
      perms: [t('conn.phantom.p1'), t('conn.phantom.p3')],
      glyph: 'solflare',
    },
    {
      id: 'pix', name: 'Pix · BRL on-ramp',
      tone: 'a', tagline: t('conn.pix.tag'),
      meta: [
        { l: t('conn.pix.provider'), v: t('conn.pix.notSet') },
        { l: t('conn.pix.req'),      v: t('conn.pix.reqV') },
      ],
      perms: [
        t('conn.pix.p1', { c1: 'BRL', c2: 'USDC' }),
        t('conn.pix.p2', { c1: 'BRL', c2: 'USDC' }),
      ],
      glyph: 'pix',
    },
  ];
}

function WalletConnections() {
  const state = useAppState();
  const t = useT();
  const CONNS = getConnectionsSpec(t);
  const connected = CONNS.filter(c => (state.connections[c.id]?.status) === 'connected').length;
  const [expanded, setExpanded] = React.useState('phantom');

  return (
    <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
      {/* Connection cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <MonoLabel color={RFI.green}>{t('conn.badge')}</MonoLabel>
          <span style={{ fontSize: 11, color: RFI.muted,
                         fontFamily: 'JetBrains Mono, monospace' }}>
            {t('conn.count', { c: connected, t: CONNS.length })}
          </span>
        </div>

        {CONNS.map(c => (
          <ConnectionCard
            key={c.id} c={c}
            runtime={state.connections[c.id] || { status: 'disconnected' }}
            open={expanded === c.id}
            onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
          />
        ))}
      </div>

      {/* Side — security explainer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          padding: 22, borderRadius: 18, position: 'relative', overflow: 'hidden',
          background: `linear-gradient(145deg, ${RFI.navy}, ${RFI.surface1} 80%)`,
          border: `1px solid ${RFI.border}`,
        }}>
          <div style={{
            position: 'absolute', top: -30, right: -30, width: 140, height: 140,
            borderRadius: '50%', border: `20px solid ${RFI.green}1A`,
          }}/>
          <div style={{ position: 'relative' }}>
            <Icons.shield size={22} stroke={RFI.green}/>
            <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 700, color: RFI.text,
                          marginTop: 12, letterSpacing: '-0.02em' }}>
              {t('conn.keys.title')}
            </div>
            <div style={{ fontSize: 12, color: RFI.text2, marginTop: 8, lineHeight: 1.5 }}>
              {t('conn.keys.body')}
            </div>
          </div>
        </div>

        <div style={{
          padding: 18, borderRadius: 14,
          background: RFI.surface1, border: `1px solid ${RFI.border}`,
        }}>
          <MonoLabel color={RFI.teal}>{t('conn.soon')}</MonoLabel>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['Marginfi',        t('conn.soon.marginfi')],
              ['Jupiter',         t('conn.soon.jupiter')],
              ['Open Finance BR', t('conn.soon.openfin')],
            ].map(([n, d]) => (
              <div key={n} style={{ display: 'flex', justifyContent: 'space-between',
                                    alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: RFI.text, fontWeight: 500 }}>{n}</div>
                  <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2 }}>{d}</div>
                </div>
                <span style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 999,
                  background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
                  color: RFI.muted, fontFamily: 'JetBrains Mono, monospace',
                }}>{t('conn.roadmap')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({ c, runtime, open, onToggle }) {
  const t = useT();
  const tc = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[c.tone];
  const status = runtime.status;
  const isConnected = status === 'connected';
  const isPending   = status === 'pending';
  const [isConnecting, setConnecting] = React.useState(false);

  const doConnect = (e) => {
    e.stopPropagation();
    setConnecting(true);
    // Simulate wallet approval flow
    setTimeout(() => {
      setConnecting(false);
      const now = new Date();
      const month = now.toLocaleDateString(APP_STATE.lang === 'pt' ? 'pt-BR' : 'en-US',
                                          { month: 'short', year: 'numeric' });
      setConnection(c.id, 'connected', { since: month });
    }, 900);
  };

  const doDisconnect = (e) => {
    e.stopPropagation();
    setConnection(c.id, 'disconnected');
  };

  return (
    <div style={{
      borderRadius: 16,
      background: RFI.surface1,
      border: `1px solid ${open ? `${tc}4D` : (isConnected ? RFI.border : RFI.border)}`,
      overflow: 'hidden', transition: 'all 180ms ease',
      opacity: (!isConnected && !isPending) ? 0.82 : 1,
    }}>
      <button onClick={onToggle} style={{
        width: '100%', padding: 18, background: 'none', border: 'none',
        cursor: 'pointer', textAlign: 'left',
        display: 'grid', gridTemplateColumns: '48px 1fr auto auto', gap: 14,
        alignItems: 'center',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, flexShrink: 0,
          background: `linear-gradient(135deg, ${tc}22, ${tc}0A)`,
          border: `1px solid ${tc}4D`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          filter: !isConnected && !isPending ? 'grayscale(0.4)' : 'none',
        }}><ConnectionGlyph kind={c.glyph} color={tc} size={22}/></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: RFI.text,
                        display: 'flex', alignItems: 'center', gap: 8 }}>
            {c.name}
            {isConnected && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                             fontSize: 10, color: RFI.green, fontWeight: 500,
                             fontFamily: 'JetBrains Mono, monospace' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: RFI.green,
                               boxShadow: `0 0 6px ${RFI.green}` }}/>
                {t('conn.connected')}
              </span>
            )}
            {!isConnected && !isPending && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                             fontSize: 10, color: RFI.muted, fontWeight: 500,
                             fontFamily: 'JetBrains Mono, monospace' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: RFI.muted }}/>
                {t('conn.disconnected')}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: RFI.text2, marginTop: 3 }}>{c.tagline}</div>
        </div>
        {isConnected ? (
          <span style={{ fontSize: 10, color: RFI.muted,
                         fontFamily: 'JetBrains Mono, monospace' }}>
            {t('conn.since', { d: runtime.since || '—' })}
          </span>
        ) : isPending ? (
          <RFIPill tone="a">{t('conn.pending')}</RFIPill>
        ) : (
          <button onClick={doConnect} disabled={isConnecting} style={{
            padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
            border: 'none', background: `linear-gradient(135deg, ${tc}, ${RFI.teal})`,
            color: '#fff', fontSize: 11, fontWeight: 700,
            opacity: isConnecting ? 0.7 : 1,
          }}>
            {isConnecting ? t('conn.connecting') : t('conn.reconnect')}
          </button>
        )}
        <span style={{ color: RFI.muted, fontSize: 12,
                       transform: open ? 'rotate(90deg)' : 'rotate(0)',
                       transition: 'transform 180ms ease' }}>›</span>
      </button>

      {open && (
        <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${RFI.border}` }}>
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <MonoLabel size={9}>{t('conn.details')}</MonoLabel>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {c.meta.map(m => (
                  <div key={m.l} style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 10, color: RFI.muted,
                                   fontFamily: 'JetBrains Mono, monospace' }}>{m.l}</span>
                    <span style={{
                      fontSize: m.mono ? 11 : 12,
                      fontFamily: m.mono ? 'JetBrains Mono, monospace' : 'DM Sans, sans-serif',
                      color: RFI.text, fontWeight: 500, marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{m.v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <MonoLabel size={9}>{t('conn.perms')}</MonoLabel>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {c.perms.map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 8,
                                        fontSize: 11, color: RFI.text2 }}>
                    <Icons.check size={12} stroke={isConnected ? tc : RFI.muted} sw={2}/>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            {isConnected ? (
              <>
                <button style={{
                  padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
                  background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
                  color: RFI.text, fontSize: 11, fontWeight: 600,
                }}>{t('conn.manage')}</button>
                <button onClick={doDisconnect} style={{
                  padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
                  background: 'transparent', border: `1px solid ${RFI.red}4D`,
                  color: RFI.red, fontSize: 11, fontWeight: 600,
                }}>{t('conn.revoke')}</button>
              </>
            ) : (
              <button onClick={doConnect} disabled={isConnecting} style={{
                padding: '10px 18px', borderRadius: 10, cursor: 'pointer', border: 'none',
                background: `linear-gradient(135deg, ${tc}, ${RFI.teal})`,
                color: '#fff', fontSize: 12, fontWeight: 700,
                opacity: isConnecting ? 0.7 : 1,
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                {isConnecting && (
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff', animation: 'spin 0.7s linear infinite',
                    display: 'inline-block',
                  }}/>
                )}
                {isConnecting ? t('conn.connecting') : t('conn.connect', { n: c.name })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Brand glyphs for each integration
function ConnectionGlyph({ kind, color, size = 20 }) {
  const s = { width: size, height: size };
  switch (kind) {
    case 'phantom':
      // Phantom ghost silhouette
      return (
        <svg viewBox="0 0 24 24" style={s} fill={color}>
          <path d="M12 2.5c-5 0-9 3.8-9 9.3v8a1.3 1.3 0 0 0 2.2.9l1.4-1.4a1 1 0 0 1 1.4 0l1.1 1a1.1 1.1 0 0 0 1.6 0l1.1-1a1 1 0 0 1 1.4 0l1.1 1a1.1 1.1 0 0 0 1.6 0l1.1-1a1 1 0 0 1 1.4 0l1.4 1.4a1.3 1.3 0 0 0 2.2-.9v-8c0-5.5-4-9.3-9-9.3zm-3.5 10a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm7 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/>
        </svg>
      );
    case 'civic':
      return (
        <svg viewBox="0 0 24 24" style={s} fill="none" stroke={color} strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z"/>
          <path d="M8.5 12.5l2.5 2.5 4.5-5"/>
        </svg>
      );
    case 'kamino':
      return (
        <svg viewBox="0 0 24 24" style={s} fill="none" stroke={color} strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 18 Q 8 10 12 14 Q 16 18 20 10"/>
          <circle cx="4" cy="18" r="1.4" fill={color}/>
          <circle cx="20" cy="10" r="1.4" fill={color}/>
        </svg>
      );
    case 'solflare':
      return (
        <svg viewBox="0 0 24 24" style={s} fill="none" stroke={color} strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
        </svg>
      );
    case 'pix':
      return (
        <svg viewBox="0 0 24 24" style={s} fill="none" stroke={color} strokeWidth="1.8"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l4 4-4 4-4-4z"/>
          <path d="M12 13l4 4-4 4-4-4z"/>
          <path d="M3 12l4-4 4 4-4 4z"/>
          <path d="M13 12l4-4 4 4-4 4z"/>
        </svg>
      );
    default:
      return <div style={s}/>;
  }
}

// helpers
function btnSoft() {
  return {
    padding: '10px 16px', borderRadius: 11, cursor: 'pointer',
    background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
    color: RFI.text, fontSize: 13, fontWeight: 500,
  };
}
function btnPrimary() {
  return {
    padding: '10px 16px', borderRadius: 11, border: 'none', cursor: 'pointer',
    background: `linear-gradient(135deg, ${RFI.green}, ${RFI.teal})`,
    color: RFI.bgDeep, fontSize: 13, fontWeight: 700,
    boxShadow: '0 6px 18px rgba(20,241,149,0.2)',
  };
}

Object.assign(window, { DeskWallet, DeskMarket, DeskInsights,
  WalletOverview, WalletPositions, WalletTransactions, WalletConnections });
