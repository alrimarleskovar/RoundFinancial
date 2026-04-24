// RoundFi — Desktop dashboard

function DeskMeta({ label, v }) {
  return (
    <div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                    letterSpacing: '0.12em', color: RFI.muted, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 700,
                    color: RFI.text, letterSpacing: '-0.02em', marginTop: 4 }}>{v}</div>
    </div>
  );
}

function RFISideNav({ screen, setScreen, user, collapsed = false }) {
  const tt = (typeof useT === 'function') ? useT() : (k) => k;
  const items = [
    { id: 'home',    label: tt('nav.home'),     icon: Icons.home },
    { id: 'groups',  label: tt('nav.groups'),   icon: Icons.groups },
    { id: 'score',   label: tt('nav.score'),    icon: Icons.shield },
    { id: 'wallet',  label: tt('nav.wallet'),   icon: Icons.wallet },
    { id: 'market',  label: tt('nav.market'),   icon: Icons.ticket },
    { id: 'insights',label: tt('nav.insights'), icon: Icons.chart },
  ];
  return (
    <div style={{
      width: collapsed ? 72 : 240, flexShrink: 0,
      background: RFI.surface1, borderRight: `1px solid ${RFI.border}`,
      display: 'flex', flexDirection: 'column',
      padding: '24px 14px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 8px 24px',
      }}>
        <RFILogoMark size={28}/>
        {!collapsed && (
          <span style={{
            fontFamily: 'Syne, system-ui', fontWeight: 700, fontSize: 18,
            letterSpacing: '-0.02em', color: RFI.text,
          }}>Round<span style={{ fontWeight: 800 }}>Fi</span></span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => {
          const active = screen === it.id;
          return (
            <button key={it.id} onClick={() => setScreen(it.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: collapsed ? '10px' : '10px 12px', borderRadius: 10,
              background: active ? RFI.fillMed : 'transparent',
              border: 'none', cursor: 'pointer',
              color: active ? RFI.text : RFI.text2,
              fontSize: 13, fontWeight: active ? 600 : 500,
              justifyContent: collapsed ? 'center' : 'flex-start',
              position: 'relative',
            }}>
              {active && !collapsed && <div style={{
                position: 'absolute', left: 0, top: 10, bottom: 10, width: 3,
                background: RFI.green, borderRadius: 2,
              }}/>}
              <it.icon size={18} sw={active ? 2 : 1.6}/>
              {!collapsed && <span>{it.label}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1 }}/>

      {/* Level badge */}
      {!collapsed && (
        <div style={{
          padding: 14, borderRadius: 14,
          background: `linear-gradient(145deg, ${RFI.navyDeep}, ${RFI.surface2})`,
          border: `1px solid ${RFI.border}`, marginBottom: 10,
        }}>
          <MonoLabel color={RFI.green} size={9}>◆ Nv. {user.level} · Comprovado</MonoLabel>
          <div style={{ marginTop: 8, fontSize: 11, color: RFI.text2 }}>
            {user.nextLevel - user.score} pts até Veterano
          </div>
          <div style={{ marginTop: 8, height: 4, background: RFI.fillMed, borderRadius: 999,
                        overflow: 'hidden' }}>
            <div style={{ width: `${(user.score / user.nextLevel) * 100}%`, height: '100%',
                          background: `linear-gradient(90deg, ${RFI.green}, ${RFI.teal})` }}/>
          </div>
        </div>
      )}

      {/* User chip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: 8,
        borderRadius: 12, background: RFI.fillSoft,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
          background: `linear-gradient(135deg, ${RFI.teal}, ${RFI.green})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Syne', fontWeight: 800, fontSize: 12, color: RFI.bgDeep,
        }}>{user.avatar}</div>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.name}
            </div>
            <div style={{ fontSize: 10, color: RFI.muted,
                          fontFamily: 'JetBrains Mono, monospace' }}>{user.walletShort}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DESKTOP HOME
// ─────────────────────────────────────────────────────────────
function DeskHome({ go }) {
  const user = USER;
  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top row: title + quick actions */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <MonoLabel color={RFI.green}>◆ Dashboard</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 32, fontWeight: 800,
                        color: RFI.text, letterSpacing: '-0.03em', marginTop: 4 }}>
            Bom dia, {user.name.split(' ')[0]}
          </div>
          <div style={{ fontSize: 13, color: RFI.text2, marginTop: 4 }}>
            Você tem <span style={{ color: RFI.green, fontWeight: 600 }}>1 parcela</span> vencendo em 5 dias
            e <span style={{ color: RFI.teal, fontWeight: 600 }}>R$ 312 de yield</span> acumulado.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <DeskBtn tone="primary" onClick={() => go('pay')} icon={Icons.send}>Pagar parcela</DeskBtn>
          <DeskBtn onClick={() => go('groups')} icon={Icons.plus}>Entrar em grupo</DeskBtn>
        </div>
      </div>

      {/* Top KPIs row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <DeskKPI label="Saldo protegido" value={fmtBRL(user.balance)} delta="+2,4% mês" tone="g"/>
        <DeskKPI label="Reputação" value={user.score} delta={`+${user.scoreDelta} este mês`} tone="t" sub="/ 850"/>
        <DeskKPI label="Yield Kamino" value={fmtBRL(user.yield)} delta="6,8% APY" tone="p"/>
        <DeskKPI label="Colateral atual" value={`${user.colateralPct}%`} delta={`${user.leverageX}x alav.`} tone="a"/>
      </div>

      {/* Two-column: main + side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16 }}>
        {/* LEFT — active groups */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Featured active group */}
          <DeskFeaturedGroup/>
          {/* Other groups */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          alignItems: 'baseline', marginBottom: 10 }}>
              <MonoLabel color={RFI.green}>◆ Seus grupos</MonoLabel>
              <button onClick={() => go('groups')} style={{ background: 'none', border: 'none',
                      color: RFI.muted, fontSize: 11, cursor: 'pointer' }}>
                Ver tudo →
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ACTIVE_GROUPS.slice(1).map(g => <DeskGroupRow key={g.id} g={g}/>)}
            </div>
          </div>
        </div>

        {/* RIGHT — passport + shield + activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <DeskPassportMini go={go}/>
          <DeskShield/>
          <DeskActivity/>
        </div>
      </div>
    </div>
  );
}

// ── Reusable desktop bits
function DeskBtn({ children, onClick, tone = 'default', icon }) {
  const Ic = icon;
  if (tone === 'primary') {
    return (
      <button onClick={onClick} style={{
        padding: '10px 16px', borderRadius: 11, border: 'none', cursor: 'pointer',
        background: `linear-gradient(135deg, ${RFI.green}, ${RFI.teal})`,
        color: RFI.bgDeep, fontSize: 13, fontWeight: 700,
        display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: '0 6px 18px rgba(20,241,149,0.2)',
      }}>
        {Ic && <Ic size={15} stroke={RFI.bgDeep} sw={2}/>}
        {children}
      </button>
    );
  }
  return (
    <button onClick={onClick} style={{
      padding: '10px 16px', borderRadius: 11, cursor: 'pointer',
      background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
      color: RFI.text, fontSize: 13, fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {Ic && <Ic size={15} stroke={RFI.text} sw={1.8}/>}
      {children}
    </button>
  );
}

function DeskKPI({ label, value, delta, tone, sub }) {
  const toneColor = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[tone];
  return (
    <div style={{
      background: RFI.surface1, border: `1px solid ${RFI.border}`, borderRadius: 16,
      padding: 18, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${toneColor}, transparent 70%)`,
      }}/>
      <MonoLabel size={9}>{label}</MonoLabel>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
        <span style={{ fontFamily: 'Syne', fontSize: 28, fontWeight: 800,
                       color: RFI.text, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</span>
        {sub && <span style={{ fontSize: 12, color: RFI.muted,
                               fontFamily: 'JetBrains Mono, monospace' }}>{sub}</span>}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: toneColor,
                    fontFamily: 'JetBrains Mono, monospace' }}>{delta}</div>
    </div>
  );
}

function DeskFeaturedGroup() {
  const g = ACTIVE_GROUPS[0];
  return (
    <div style={{
      background: `linear-gradient(135deg, ${RFI.navyDeep} 0%, ${RFI.surface1} 70%)`,
      border: `1px solid ${RFI.border}`, borderRadius: 20, padding: 24,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -40, right: -40, width: 240, height: 240,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(20,241,149,0.15), transparent 60%)',
      }}/>
      <div style={{ position: 'relative', display: 'flex', gap: 28, alignItems: 'center' }}>
        {/* Dial */}
        <div style={{ width: 160, height: 160, position: 'relative', flexShrink: 0 }}>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
            <defs>
              <linearGradient id="desk-dial" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={RFI.green}/>
                <stop offset="1" stopColor={RFI.teal}/>
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="42" fill="none" stroke={RFI.fillMed} strokeWidth="5"/>
            <circle cx="50" cy="50" r="42" fill="none" stroke="url(#desk-dial)" strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={`${264 * 0.33} 264`}/>
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i / 12) * Math.PI * 2;
              const x1 = 50 + Math.cos(a) * 49;
              const y1 = 50 + Math.sin(a) * 49;
              const x2 = 50 + Math.cos(a) * 46;
              const y2 = 50 + Math.sin(a) * 46;
              const done = i < 4;
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                           stroke={done ? RFI.green : RFI.fillMed}
                           strokeWidth="1.2" strokeLinecap="round"/>;
            })}
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <MonoLabel size={9}>MÊS</MonoLabel>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 40,
                          color: RFI.text, lineHeight: 1, letterSpacing: '-0.03em' }}>04</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                          color: RFI.green, marginTop: 4 }}>/ 12</div>
          </div>
        </div>
        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MonoLabel color={RFI.green}>◆ Rodada ativa · destaque</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 24, fontWeight: 700,
                        color: RFI.text, letterSpacing: '-0.02em', marginTop: 6 }}>
            {g.name}
          </div>
          <div style={{ marginTop: 12, display: 'grid',
                        gridTemplateColumns: 'repeat(3, auto)', gap: 24 }}>
            <DeskMeta label="Prêmio" v={fmtBRL(g.prize).replace(',00','')}/>
            <DeskMeta label="Próxima parcela" v={fmtBRL(g.installment).replace(',00','')}/>
            <DeskMeta label="Sorteio" v="5 dias"/>
          </div>
          <div style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex' }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{
                  width: 26, height: 26, borderRadius: '50%', marginLeft: i ? -8 : 0,
                  background: i === 5 ? RFI.surface3 : `hsl(${(i*60)%360} 40% 45%)`,
                  border: `2px solid ${RFI.bg}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: RFI.text,
                }}>{i === 5 ? '+7' : ''}</div>
              ))}
            </div>
            <span style={{ fontSize: 11, color: RFI.muted }}>12 cotas · 4 sorteadas</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeskGroupRow({ g }) {
  const tc = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[g.tone];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '40px 1fr auto auto auto',
      gap: 16, alignItems: 'center',
      padding: 14, borderRadius: 14,
      background: RFI.surface1, border: `1px solid ${RFI.border}`,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: `${tc}1A`, border: `1px solid ${tc}4D`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
      }}>{g.emoji}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: RFI.text }}>{g.name}</div>
        <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                      fontFamily: 'JetBrains Mono, monospace' }}>
          Mês {String(g.month).padStart(2,'0')} / {g.total}
          {g.status === 'drawn' && <span style={{ color: RFI.green, marginLeft: 8 }}>✓ sorteado</span>}
        </div>
      </div>
      <div style={{ width: 140, height: 4, background: RFI.fillMed, borderRadius: 999,
                    overflow: 'hidden' }}>
        <div style={{ width: `${g.progress * 100}%`, height: '100%', background: tc }}/>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 10, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
          Parcela
        </div>
        <div style={{ fontFamily: 'Syne', fontSize: 13, fontWeight: 700, color: RFI.text }}>
          {fmtBRL(g.installment).replace(',00','')}
        </div>
      </div>
      <Icons.arrow size={16} stroke={RFI.muted}/>
    </div>
  );
}

function DeskPassportMini({ go }) {
  return (
    <button onClick={() => go('score')} style={{
      width: '100%', padding: 0, background: 'none', border: 'none',
      cursor: 'pointer', textAlign: 'left',
    }}>
      <div style={{
        borderRadius: 18, padding: 20, position: 'relative', overflow: 'hidden',
        background: `linear-gradient(155deg, ${RFI.navy}, ${RFI.bgDeep})`,
        border: `1px solid ${RFI.borderStr}`,
      }}>
        <div style={{
          position: 'absolute', top: -20, right: -20, width: 120, height: 120,
          borderRadius: '50%', border: `16px solid ${RFI.green}1A`,
        }}/>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <MonoLabel color={RFI.green}>◆ SAS Passport</MonoLabel>
            <MonoLabel size={9}>{USER.walletShort}</MonoLabel>
          </div>
          <div style={{ fontFamily: 'Syne', fontSize: 56, fontWeight: 800, color: RFI.text,
                        letterSpacing: '-0.03em', marginTop: 14, lineHeight: 1 }}>
            {USER.score}
            <span style={{ fontSize: 14, color: RFI.green, marginLeft: 10,
                           fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
              +{USER.scoreDelta}
            </span>
          </div>
          <div style={{ marginTop: 10, height: 5, background: RFI.fillMed,
                        borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${(USER.score / 850) * 100}%`, height: '100%',
                          background: `linear-gradient(90deg, ${RFI.green}, ${RFI.teal})` }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8,
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.muted }}>
            <span>300</span>
            <span style={{ color: RFI.teal }}>COMPROVADO Nv.2</span>
            <span>850</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function DeskShield() {
  const items = [
    { n: '01', t: 'Sorteio Semente',   d: '91,6% retido Mês 1',        c: RFI.green },
    { n: '02', t: 'Escrow Adaptativo', d: '65% nunca sai do contrato',  c: RFI.teal },
    { n: '03', t: 'Cofre + Yield',     d: '1% cofre + 6,8% APY Kamino', c: RFI.purple },
  ];
  return (
    <div style={{
      background: RFI.surface1, border: `1px solid ${RFI.border}`,
      borderRadius: 18, padding: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icons.shield size={16} stroke={RFI.green}/>
        <MonoLabel color={RFI.green}>◆ Triplo Escudo · ativo</MonoLabel>
      </div>
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map(i => (
          <div key={i.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: `${i.c}1A`, border: `1px solid ${i.c}4D`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: i.c,
              fontWeight: 600,
            }}>{i.n}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text }}>{i.t}</div>
              <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                            fontFamily: 'JetBrains Mono, monospace' }}>{i.d}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeskActivity() {
  const items = [
    { l: 'Parcela · MEI',     v: -892.40, d: '12 ABR', t: RFI.text },
    { l: 'Yield · Kamino',    v: +52.30,  d: '10 ABR', t: RFI.green },
    { l: 'Venda cota #03',    v: +1890,   d: '05 ABR', t: RFI.teal },
    { l: 'SAS atestado #12',  v: 0,       d: '04 ABR', t: RFI.purple, mono: '+18 pts' },
  ];
  return (
    <div style={{
      background: RFI.surface1, border: `1px solid ${RFI.border}`,
      borderRadius: 18, padding: 18,
    }}>
      <MonoLabel color={RFI.green}>◆ Atividade recente</MonoLabel>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((i, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between',
                                  fontSize: 12, alignItems: 'center' }}>
            <div>
              <div style={{ color: RFI.text, fontWeight: 500 }}>{i.l}</div>
              <div style={{ fontSize: 9, color: RFI.muted, marginTop: 1,
                            fontFamily: 'JetBrains Mono, monospace' }}>{i.d}</div>
            </div>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                           fontWeight: 600, color: i.v > 0 ? RFI.green : i.t }}>
              {i.mono ? i.mono : (i.v > 0 ? '+' : i.v < 0 ? '' : '') + (i.v !== 0 ? fmtBRL(Math.abs(i.v)).replace(',00','') : '')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DESKTOP GROUPS
// ─────────────────────────────────────────────────────────────
// ── Group enrichment (category, normalized fields) ─────────────────────
function categorizeGroup(g) {
  const n = (g.name || '').toLowerCase();
  if (/\bmei\b|pme|capital/.test(n))            return 'pme';
  if (/veteran|vip/.test(n))                     return 'vip';
  if (/dev|rust|curso|freela/.test(n))           return 'dev';
  if (/moto|delivery/.test(n))                   return 'delivery';
  if (/intercâmbio|intercambio|estudo/.test(n))  return 'estudo';
  if (/reforma|casa/.test(n))                    return 'casa';
  if (/enxoval/.test(n))                         return 'casa';
  return 'pessoal';
}
const CATEGORY_LABELS = {
  pme: 'PME', vip: '✦ VIP', dev: 'Dev/Profissional',
  delivery: 'Delivery', estudo: 'Estudo', casa: 'Casa', pessoal: 'Pessoal',
};

function DeskGroups({ go }) {
  const enriched = React.useMemo(() => {
    const active = ACTIVE_GROUPS.map((g, i) => ({
      ...g,
      joined: true,
      category: categorizeGroup(g),
      months: g.total,
      filled: g.members ?? g.total,
      level: g.level ?? 2,
    }));
    const discover = DISCOVER_GROUPS.map(g => ({
      ...g,
      joined: false,
      category: categorizeGroup(g),
    }));
    return [...active, ...discover];
  }, []);

  const [level, setLevel] = React.useState('all');     // all | 1 | 2 | 3
  const [category, setCategory] = React.useState('all');
  const [budget, setBudget] = React.useState('all');   // all | lt15 | 15to30 | gt30
  const [duration, setDuration] = React.useState('all'); // all | short | mid | long
  const [sort, setSort] = React.useState('relevant');  // relevant | prize-low | prize-high | spots
  const [onlyOpen, setOnlyOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    let rows = enriched;
    if (level !== 'all') rows = rows.filter(g => g.level === level);
    if (category !== 'all') rows = rows.filter(g => g.category === category);
    if (budget !== 'all') rows = rows.filter(g => {
      if (budget === 'lt15')  return g.prize < 15000;
      if (budget === '15to30') return g.prize >= 15000 && g.prize < 30000;
      return g.prize >= 30000;
    });
    if (duration !== 'all') rows = rows.filter(g => {
      const m = g.months;
      if (duration === 'short') return m <= 6;
      if (duration === 'mid') return m > 6 && m <= 12;
      return m > 12;
    });
    if (onlyOpen) rows = rows.filter(g => (g.filled || 0) < g.total);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(g => g.name.toLowerCase().includes(q));
    }
    if (sort === 'prize-low')  rows = [...rows].sort((a,b) => a.prize - b.prize);
    if (sort === 'prize-high') rows = [...rows].sort((a,b) => b.prize - a.prize);
    if (sort === 'spots')      rows = [...rows].sort((a,b) => (a.total - a.filled) - (b.total - b.filled));
    return rows;
  }, [enriched, level, category, budget, duration, onlyOpen, query, sort]);

  const totalOpen = enriched.filter(g => (g.filled || 0) < g.total).length;
  const activeCount = [level, category, budget, duration].filter(x => x !== 'all').length
                    + (onlyOpen ? 1 : 0) + (query ? 1 : 0);

  const clearAll = () => {
    setLevel('all'); setCategory('all'); setBudget('all');
    setDuration('all'); setOnlyOpen(false); setQuery('');
  };

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <MonoLabel color={RFI.green}>◆ Catálogo</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 32, fontWeight: 800, color: RFI.text,
                        letterSpacing: '-0.03em', marginTop: 4 }}>
            Grupos disponíveis
          </div>
          <div style={{ fontSize: 13, color: RFI.text2, marginTop: 4 }}>
            {totalOpen} grupos com vagas abertas · seu nível atual dá acesso a {enriched.filter(g => g.level <= USER.level).length}
          </div>
        </div>
        <DeskBtn tone="primary" icon={Icons.plus}>Abrir novo ciclo</DeskBtn>
      </div>

      {/* Filter panel */}
      <div style={{
        marginTop: 20, padding: 18, borderRadius: 16,
        background: RFI.surface1, border: `1px solid ${RFI.border}`,
      }}>
        {/* Search row */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 10,
            background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke={RFI.muted} strokeWidth="2">
              <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Buscar por nome do grupo…" style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: RFI.text, fontSize: 12, fontFamily: 'DM Sans, sans-serif',
            }}/>
            {query && (
              <button onClick={() => setQuery('')} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: RFI.muted, padding: 0, display: 'flex',
              }}><Icons.close size={14}/></button>
            )}
          </div>
          <FilterSelect value={sort} onChange={setSort}
            options={[
              ['relevant','Relevância'],
              ['prize-low','Prêmio ↑'],
              ['prize-high','Prêmio ↓'],
              ['spots','Vagas restantes'],
            ]}/>
        </div>

        {/* Chip groups */}
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FilterRow label="Nível">
            <Chip active={level === 'all'} onClick={() => setLevel('all')}>Todos</Chip>
            <Chip active={level === 1}     onClick={() => setLevel(1)}>Nv.1 Iniciante</Chip>
            <Chip active={level === 2}     onClick={() => setLevel(2)}>Nv.2 Comprovado</Chip>
            <Chip active={level === 3}     onClick={() => setLevel(3)} tone="p">Nv.3 ✦ VIP</Chip>
          </FilterRow>

          <FilterRow label="Categoria">
            <Chip active={category === 'all'} onClick={() => setCategory('all')}>Todas</Chip>
            {Object.entries(CATEGORY_LABELS).map(([k, l]) => (
              <Chip key={k} active={category === k} onClick={() => setCategory(k)}>{l}</Chip>
            ))}
          </FilterRow>

          <FilterRow label="Prêmio">
            <Chip active={budget === 'all'}    onClick={() => setBudget('all')}>Qualquer</Chip>
            <Chip active={budget === 'lt15'}   onClick={() => setBudget('lt15')}>{'< R$ 15k'}</Chip>
            <Chip active={budget === '15to30'} onClick={() => setBudget('15to30')}>R$ 15–30k</Chip>
            <Chip active={budget === 'gt30'}   onClick={() => setBudget('gt30')}>{'> R$ 30k'}</Chip>
          </FilterRow>

          <FilterRow label="Duração">
            <Chip active={duration === 'all'}   onClick={() => setDuration('all')}>Qualquer</Chip>
            <Chip active={duration === 'short'} onClick={() => setDuration('short')}>≤ 6 meses</Chip>
            <Chip active={duration === 'mid'}   onClick={() => setDuration('mid')}>7–12 meses</Chip>
            <Chip active={duration === 'long'}  onClick={() => setDuration('long')}>{'> 12 meses'}</Chip>
          </FilterRow>

          <FilterRow label="Disponibilidade">
            <Chip active={onlyOpen} onClick={() => setOnlyOpen(!onlyOpen)} tone="g">
              {onlyOpen ? '✓ ' : ''}Apenas com vagas
            </Chip>
          </FilterRow>
        </div>

        {/* Active filter summary */}
        {activeCount > 0 && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${RFI.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: RFI.text2,
                           fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ color: RFI.green }}>{filtered.length}</span> de {enriched.length} grupos ·{' '}
              <span style={{ color: RFI.green }}>{activeCount}</span> filtro{activeCount>1?'s':''} ativo{activeCount>1?'s':''}
            </span>
            <button onClick={clearAll} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: RFI.teal, fontSize: 11, fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              display: 'flex', alignItems: 'center', gap: 4,
            }}><Icons.close size={12}/> Limpar filtros</button>
          </div>
        )}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div style={{
          marginTop: 24, padding: 40, borderRadius: 16, textAlign: 'center',
          background: RFI.surface1, border: `1px dashed ${RFI.borderStr}`,
        }}>
          <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 700, color: RFI.text }}>
            Nenhum grupo com esses filtros
          </div>
          <div style={{ fontSize: 12, color: RFI.muted, marginTop: 6 }}>
            Tente relaxar os critérios ou abra um novo ciclo.
          </div>
          <button onClick={clearAll} style={{
            marginTop: 14, padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
            background: RFI.fillSoft, border: `1px solid ${RFI.borderStr}`,
            color: RFI.text, fontSize: 12, fontWeight: 600,
          }}>Limpar filtros</button>
        </div>
      ) : (
        <div style={{ marginTop: 20, display: 'grid',
                      gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {filtered.map(g => (
            <DeskGroupCard key={g.id} g={g} joined={g.joined}/>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 14, alignItems: 'center' }}>
      <MonoLabel size={9}>{label}</MonoLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Chip({ active, tone = 'g', onClick, children }) {
  const toneColor = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[tone] || RFI.green;
  return (
    <button onClick={onClick} style={{
      padding: '7px 13px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
      background: active ? `${toneColor}1A` : RFI.fillSoft,
      border: `1px solid ${active ? `${toneColor}4D` : RFI.border}`,
      color: active ? toneColor : RFI.text2,
      fontWeight: active ? 600 : 500,
      fontFamily: 'DM Sans, sans-serif',
      transition: 'all 120ms ease',
    }}>{children}</button>
  );
}

function FilterSelect({ value, onChange, options }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        appearance: 'none', WebkitAppearance: 'none',
        padding: '10px 32px 10px 14px', borderRadius: 10, cursor: 'pointer',
        background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
        color: RFI.text, fontSize: 12, fontWeight: 600,
        fontFamily: 'DM Sans, sans-serif',
      }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                     pointerEvents: 'none', color: RFI.muted, fontSize: 10 }}>▾</span>
    </div>
  );
}

function DeskGroupCard({ g, joined }) {
  const tc = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[g.tone];
  const months = g.months || g.total;
  const filled = g.filled != null ? g.filled : g.members;
  const total = g.total || months;
  return (
    <div style={{
      background: RFI.surface1, border: `1px solid ${RFI.border}`, borderRadius: 18,
      padding: 18, position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${tc}, transparent)`,
      }}/>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: `${tc}1A`, border: `1px solid ${tc}4D`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        }}>{g.emoji}</div>
        {joined ? <RFIPill tone="g">✓ No grupo</RFIPill>
                : g.level === 3 ? <RFIPill tone="p">✦ VIP</RFIPill>
                : <RFIPill tone="n">Nv.1+</RFIPill>}
      </div>
      <div>
        <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 700, color: RFI.text,
                      letterSpacing: '-0.02em' }}>{g.name}</div>
        <div style={{ fontSize: 11, color: RFI.muted, marginTop: 4,
                      fontFamily: 'JetBrains Mono, monospace' }}>
          {months}m · {filled}/{total} cotas
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <MonoLabel size={9}>Prêmio</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 700, color: RFI.text,
                        marginTop: 4 }}>{fmtBRL(g.prize).replace(',00','')}</div>
        </div>
        <div>
          <MonoLabel size={9}>Parcela</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 700, color: RFI.text,
                        marginTop: 4 }}>{fmtBRL(g.installment).replace(',00','')}</div>
        </div>
      </div>
      <div style={{ height: 4, background: RFI.fillMed, borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${(filled / total) * 100}%`, height: '100%', background: tc }}/>
      </div>
      <button style={{
        padding: '10px 14px', borderRadius: 11, border: `1px solid ${RFI.borderStr}`,
        background: joined ? RFI.fillSoft : `linear-gradient(135deg, ${RFI.green}, ${RFI.teal})`,
        color: joined ? RFI.text : RFI.bgDeep,
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        {joined ? 'Ver detalhes' : 'Entrar no grupo'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DESKTOP SCORE
// ─────────────────────────────────────────────────────────────
function DeskScore({ go }) {
  return (
    <div style={{ padding: 32 }}>
      <MonoLabel color={RFI.green}>◆ SAS Passport</MonoLabel>
      <div style={{ fontFamily: 'Syne', fontSize: 32, fontWeight: 800, color: RFI.text,
                    letterSpacing: '-0.03em', marginTop: 4 }}>Reputação on-chain</div>

      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        {/* Passport big */}
        <div style={{
          borderRadius: 22, padding: 28, position: 'relative', overflow: 'hidden',
          background: `linear-gradient(155deg, ${RFI.navy} 0%, ${RFI.bgDeep} 60%, ${RFI.navyDeep})`,
          border: `1px solid ${RFI.borderStr}`, minHeight: 340,
        }}>
          <div style={{
            position: 'absolute', top: -40, right: -40, width: 240, height: 240,
            borderRadius: '50%', border: `26px solid ${RFI.green}1A`, filter: 'blur(2px)',
          }}/>
          <div style={{
            position: 'absolute', bottom: -60, left: -30, width: 180, height: 180,
            background: `radial-gradient(circle, rgba(0,200,255,0.15), transparent 70%)`,
          }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <RFILogoMark size={36}/>
              <div style={{ textAlign: 'right' }}>
                <MonoLabel>SOLANA · SAS</MonoLabel>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                              color: RFI.text2, marginTop: 4 }}>{USER.walletShort}</div>
              </div>
            </div>
            <div style={{ marginTop: 44 }}>
              <MonoLabel size={10}>REPUTATION SCORE</MonoLabel>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6 }}>
                <span style={{ fontFamily: 'Syne', fontSize: 96, fontWeight: 800, color: RFI.text,
                               letterSpacing: '-0.04em', lineHeight: 1 }}>{USER.score}</span>
                <span style={{ fontSize: 18, color: RFI.green, fontWeight: 600,
                               fontFamily: 'JetBrains Mono, monospace' }}>+{USER.scoreDelta}</span>
              </div>
            </div>
            <div style={{ marginTop: 24, height: 6, background: RFI.fillMed,
                          borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(USER.score/850)*100}%`, height: '100%',
                            background: `linear-gradient(90deg, ${RFI.green}, ${RFI.teal})` }}/>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10,
                          fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: RFI.muted }}>
              <span>BAIXO 300</span>
              <span style={{ color: RFI.teal }}>● COMPROVADO</span>
              <span>VETERANO 850</span>
            </div>
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: RFI.text }}>{USER.name}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                              color: RFI.muted, marginTop: 2 }}>{USER.handle}</div>
              </div>
              <RFIPill tone="g">Nv.2 · Comprovado</RFIPill>
            </div>
          </div>
        </div>

        {/* Levels column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MonoLabel color={RFI.green}>◆ Níveis de reputação</MonoLabel>
          {LEVELS.map(l => {
            const c = l.lv === 1 ? RFI.amber : l.lv === 2 ? RFI.teal : RFI.green;
            return (
              <div key={l.lv} style={{
                padding: 16, borderRadius: 14,
                background: l.current ? `rgba(0,200,255,0.05)` : RFI.surface1,
                border: `1px solid ${l.current ? 'rgba(0,200,255,0.3)' : RFI.border}`,
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: `${c}1A`, border: `1px solid ${c}4D`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Syne', fontSize: 20, fontWeight: 800, color: c,
                }}>{l.lv}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: RFI.text }}>
                    {l.name} {l.vip && <span style={{ color: RFI.green, fontSize: 12 }}>✦ VIP</span>}
                    {l.current && <span style={{ color: RFI.teal, fontSize: 10, marginLeft: 8,
                                                 fontFamily: 'JetBrains Mono, monospace' }}>
                      ← VOCÊ
                    </span>}
                  </div>
                  <div style={{ fontSize: 11, color: RFI.muted, marginTop: 3,
                                fontFamily: 'JetBrains Mono, monospace' }}>
                    {l.colat}% colateral · {l.lev}x alavancagem
                  </div>
                </div>
                {l.unlocked ? <Icons.check size={18} stroke={RFI.green} sw={2}/>
                           : <Icons.lock size={18} stroke={RFI.muted}/>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bonds list */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <MonoLabel color={RFI.green}>◆ Atestados SAS emitidos</MonoLabel>
          <span style={{ fontSize: 11, color: RFI.muted,
                         fontFamily: 'JetBrains Mono, monospace' }}>
            17 parcelas pagas · 4 ciclos
          </span>
        </div>
        <div style={{ marginTop: 12, display: 'grid',
                      gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          {SAS_BONDS.map(b => {
            const c = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[b.tone];
            return (
              <div key={b.id} style={{
                padding: 14, borderRadius: 14, background: RFI.surface1,
                border: `1px solid ${RFI.border}`,
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 12,
                  background: `${c}1A`, border: `1px solid ${c}4D`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><Icons.shield size={20} stroke={c}/></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: RFI.text }}>{b.cycle}</div>
                  <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                                fontFamily: 'JetBrains Mono, monospace' }}>
                    {b.date} · {b.installments} atestados
                  </div>
                </div>
                {b.status === 'active' ? <RFIPill tone={b.tone}>Ativo</RFIPill>
                                       : <RFIPill tone="n">✓ Fechado</RFIPill>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  RFISideNav, DeskHome, DeskGroups, DeskScore,
});
