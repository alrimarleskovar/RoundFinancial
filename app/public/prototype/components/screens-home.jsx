// RoundFi screens — Home, Grupos (Browse), Group detail, Pay, Score passport, Sell NFT

// ─────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────
const USER = {
  name: 'Maria Luísa',
  handle: '@marialuisa.sol',
  avatar: 'ML',
  level: 2,
  levelLabel: 'Comprovado',
  score: 684,
  scoreDelta: +18,
  nextLevel: 750,
  walletShort: '7xG3…k9Fn',
  colateralPct: 30,   // % do prêmio
  leverageX: 3.3,
  balance: 8420.55,
  yield: 312.08,
};

const ACTIVE_GROUPS = [
  {
    id: 'g1', name: 'Renovação MEI · 12m', emoji: '💼', tone: 'g',
    prize: 10000, month: 4, total: 12, status: 'paying', nextDue: 5,
    progress: 0.33, members: 12, draw: 'em 5 dias',
    installment: 892.40,
  },
  {
    id: 'g2', name: 'Casa Própria · 24m', emoji: '🏠', tone: 't',
    prize: 48000, month: 7, total: 24, status: 'drawn', nextDue: 12,
    progress: 0.29, members: 24, draw: 'ganho no mês 6',
    installment: 2140.00,
  },
  {
    id: 'g3', name: 'Dev Setup · 6m', emoji: '💻', tone: 'p',
    prize: 3600, month: 2, total: 6, status: 'paying', nextDue: 18,
    progress: 0.33, members: 6, draw: 'em 18 dias',
    installment: 620.00,
  },
];

const DISCOVER_GROUPS = [
  { id: 'd1', name: 'PME · Capital de Giro', emoji: '📈', tone: 'g', prize: 25000, months: 18, installment: 1520, filled: 14, total: 18, level: 1 },
  { id: 'd2', name: 'Intercâmbio 2026', emoji: '🎓', tone: 't', prize: 18000, months: 12, installment: 1640, filled: 9, total: 12, level: 1 },
  { id: 'd3', name: 'Veteranos VIP', emoji: '✦', tone: 'p', prize: 80000, months: 24, installment: 3660, filled: 19, total: 24, level: 3 },
  { id: 'd4', name: 'Moto Delivery', emoji: '🛵', tone: 'a', prize: 12000, months: 12, installment: 1090, filled: 11, total: 12, level: 1 },
];

const TIMELINE = [
  { m: 1, state: 'paid',    label: 'Janeiro',   v: 892.40, note: 'Colchão +$9.152' },
  { m: 2, state: 'paid',    label: 'Fevereiro', v: 892.40, note: 'Escrow 65%' },
  { m: 3, state: 'paid',    label: 'Março',     v: 892.40, note: 'SAS atestado #3' },
  { m: 4, state: 'current', label: 'Abril',     v: 892.40, note: 'Sorteio em 5 dias' },
  { m: 5, state: 'due',     label: 'Maio',      v: 892.40, note: '—' },
  { m: 6, state: 'due',     label: 'Junho',     v: 892.40, note: '—' },
];

const SAS_BONDS = [
  { id: 'b1', cycle: 'Dev Setup · 6m', date: 'Mar 2026', installments: 3, tone: 'p', status: 'active' },
  { id: 'b2', cycle: 'Renovação MEI',  date: 'Abr 2026', installments: 4, tone: 'g', status: 'active' },
  { id: 'b3', cycle: 'Freela Setup',   date: 'Dez 2025', installments: 6, tone: 't', status: 'completed' },
  { id: 'b4', cycle: 'Curso Rust',     date: 'Set 2025', installments: 4, tone: 'a', status: 'completed' },
];

const LEVELS = [
  { lv: 1, name: 'Iniciante',  colat: 50, lev: 2,   unlocked: true },
  { lv: 2, name: 'Comprovado', colat: 30, lev: 3.3, unlocked: true, current: true },
  { lv: 3, name: 'Veterano',   colat: 10, lev: 10,  unlocked: false, vip: true },
];

// ─────────────────────────────────────────────────────────────
// Atmospheric background (navy → black orb)
// ─────────────────────────────────────────────────────────────
function RFIBackdrop({ intensity = 1 }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(140% 70% at 50% 0%, rgba(20,241,149,${0.06 * intensity}) 0%, rgba(0,0,0,0) 50%),
                     radial-gradient(120% 70% at 100% 100%, rgba(0,200,255,${0.05 * intensity}) 0%, rgba(0,0,0,0) 50%),
                     radial-gradient(80% 60% at 0% 100%, rgba(153,69,255,${0.04 * intensity}) 0%, rgba(0,0,0,0) 60%)`,
      }}/>
      {/* grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.4,
        backgroundImage: `linear-gradient(rgba(20,241,149,.04) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(20,241,149,.04) 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
        maskImage: 'radial-gradient(80% 80% at 50% 40%, #000 30%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(80% 80% at 50% 40%, #000 30%, transparent 100%)',
      }}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Top bar (shared)
// ─────────────────────────────────────────────────────────────
function RFITopBar({ onBell, onProfile, user = USER }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 20px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 12,
          background: `linear-gradient(135deg, ${RFI.teal}, ${RFI.green})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Syne, system-ui', fontWeight: 800, fontSize: 14,
          color: RFI.bgDeep, letterSpacing: '-0.02em',
        }} onClick={onProfile}>{user.avatar}</div>
        <div>
          <div style={{ fontSize: 11, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
            Bom dia,
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: RFI.text }}>
            {user.name.split(' ')[0]} <span style={{ color: RFI.green }}>·</span> Nível {user.level}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={onBell} style={{
          width: 40, height: 40, borderRadius: 12, border: `1px solid ${RFI.border}`,
          background: RFI.fillSoft, color: RFI.text, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <Icons.bell size={18} />
          <span style={{
            position: 'absolute', top: 9, right: 10, width: 7, height: 7,
            borderRadius: '50%', background: RFI.green, boxShadow: `0 0 0 2px ${RFI.bg}`,
          }}/>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Bottom tab bar
// ─────────────────────────────────────────────────────────────
function RFITabBar({ tab, setTab }) {
  const tabs = [
    { id: 'home',   label: 'Início',  icon: Icons.home },
    { id: 'groups', label: 'Grupos',  icon: Icons.groups },
    { id: 'pay',    label: 'Pagar',   icon: Icons.plus, center: true },
    { id: 'score',  label: 'Score',   icon: Icons.score },
    { id: 'wallet', label: 'Carteira',icon: Icons.wallet },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 40,
      padding: '10px 16px 26px',
      background: 'linear-gradient(0deg, rgba(6,9,15,0.96) 40%, rgba(6,9,15,0))',
    }}>
      <div style={{
        background: RFI.surface1, border: `1px solid ${RFI.border}`, borderRadius: 22,
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', alignItems: 'center',
        padding: '8px 6px', backdropFilter: 'blur(12px)',
      }}>
        {tabs.map(t => {
          const active = tab === t.id;
          if (t.center) return (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'center' }}>
              <button onClick={() => setTab(t.id)} style={{
                width: 52, height: 52, borderRadius: 18,
                background: `linear-gradient(135deg, ${RFI.green}, ${RFI.teal})`,
                border: 'none', color: RFI.bgDeep, cursor: 'pointer',
                boxShadow: '0 10px 24px rgba(20,241,149,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginTop: -22,
              }}>
                <t.icon size={24} sw={2.2} />
              </button>
            </div>
          );
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: active ? RFI.text : RFI.muted,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '6px 0',
            }}>
              <t.icon size={20} sw={active ? 2 : 1.6}/>
              <span style={{ fontSize: 10, fontWeight: active ? 600 : 500,
                             fontFamily: 'DM Sans' }}>{t.label}</span>
              {active && <div style={{ width: 4, height: 4, borderRadius: 999,
                                       background: RFI.green, marginTop: -2 }}/>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────
function ScreenHome({ go, hero = 'round' }) {
  const user = USER;
  return (
    <div style={{ padding: '0 0 120px', position: 'relative' }}>
      {/* Hero — Round dial */}
      <div style={{ padding: '4px 20px 0' }}>
        {hero === 'round' && <HomeHeroRound user={user} />}
        {hero === 'ladder' && <HomeHeroLadder user={user} />}
        {hero === 'vault'  && <HomeHeroVault user={user} />}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '20px 20px 4px' }}>
        {[
          { l: 'Pagar',     ic: Icons.send,   tone: 'g', onClick: () => go('pay') },
          { l: 'Entrar',    ic: Icons.plus,   tone: 't', onClick: () => go('groups') },
          { l: 'Vender',    ic: Icons.ticket, tone: 'p', onClick: () => go('sell') },
          { l: 'Yield',     ic: Icons.trend,  tone: 'a' },
        ].map(a => (
          <button key={a.l} onClick={a.onClick} style={{
            background: RFI.surface1, border: `1px solid ${RFI.border}`, borderRadius: 14,
            padding: '14px 6px 10px', cursor: 'pointer', color: RFI.text,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: a.tone === 'g' ? 'rgba(20,241,149,0.1)'
                       : a.tone === 't' ? 'rgba(0,200,255,0.1)'
                       : a.tone === 'p' ? 'rgba(153,69,255,0.1)'
                       : 'rgba(255,181,71,0.1)',
              color: a.tone === 'g' ? RFI.green : a.tone === 't' ? RFI.teal : a.tone === 'p' ? RFI.purple : RFI.amber,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <a.ic size={17} sw={1.8}/>
            </div>
            <span style={{ fontSize: 11, fontWeight: 500 }}>{a.l}</span>
          </button>
        ))}
      </div>

      {/* Active groups list */}
      <div style={{ padding: '24px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <MonoLabel color={RFI.green} size={10}>◆ Seus grupos</MonoLabel>
          <button onClick={() => go('groups')} style={{ background: 'none', border: 'none', color: RFI.muted,
                  fontSize: 11, cursor: 'pointer' }}>
            Ver tudo →
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ACTIVE_GROUPS.map(g => <GroupRow key={g.id} g={g} onClick={() => go('group', g.id)} />)}
        </div>
      </div>

      {/* Score mini card */}
      <div style={{ padding: '20px 20px 0' }}>
        <button onClick={() => go('score')} style={{
          width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        }}>
          <RFICard accent="g" style={{ padding: 16, textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <MonoLabel color={RFI.green}>◆ Reputation bond</MonoLabel>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                  <span style={{
                    fontFamily: 'Syne, system-ui', fontWeight: 800, fontSize: 34,
                    color: RFI.text, letterSpacing: '-0.03em',
                  }}>{user.score}</span>
                  <span style={{ fontSize: 12, color: RFI.green, fontFamily: 'JetBrains Mono, monospace' }}>
                    +{user.scoreDelta} este mês
                  </span>
                </div>
                <div style={{ fontSize: 11, color: RFI.muted, marginTop: 2 }}>
                  {user.nextLevel - user.score} pontos até Nível 3 · Veterano
                </div>
              </div>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: 'rgba(20,241,149,0.08)',
                border: '1px solid rgba(20,241,149,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <Icons.shield size={24} stroke={RFI.green} sw={1.6}/>
              </div>
            </div>
            {/* progress */}
            <div style={{ marginTop: 14 }}>
              <div style={{
                width: '100%', height: 6, background: RFI.fillMed,
                borderRadius: 999, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${(user.score / user.nextLevel) * 100}%`, height: '100%',
                  background: `linear-gradient(90deg, ${RFI.green}, ${RFI.teal})`,
                }}/>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6,
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.muted }}>
                <span>Nv 2 · 500</span>
                <span style={{ color: RFI.text }}>{user.score}</span>
                <span>Nv 3 · 750</span>
              </div>
            </div>
          </RFICard>
        </button>
      </div>

      {/* Triple Shield stat */}
      <div style={{ padding: '16px 20px 0' }}>
        <RFICard style={{ padding: 14, background: 'rgba(20,241,149,0.03)', borderColor: 'rgba(20,241,149,0.18)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icons.shield size={20} stroke={RFI.green} sw={1.6}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text }}>
                Triplo Escudo ativo
              </div>
              <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2 }}>
                Escrow adaptativo · Cofre solidário · Yield Kamino
              </div>
            </div>
            <Icons.arrow size={16} stroke={RFI.muted}/>
          </div>
        </RFICard>
      </div>
    </div>
  );
}

// ── Hero variant: Round dial
function HomeHeroRound({ user }) {
  return (
    <div style={{
      position: 'relative', borderRadius: 24, overflow: 'hidden',
      background: `linear-gradient(160deg, ${RFI.navyDeep} 0%, ${RFI.bg} 70%)`,
      border: `1px solid ${RFI.border}`, padding: 20,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(50% 50% at 80% 30%, rgba(20,241,149,0.18), transparent 60%)',
      }}/>
      <div style={{ position: 'relative', display: 'flex', gap: 14, alignItems: 'center' }}>
        {/* Dial */}
        <div style={{ width: 128, height: 128, position: 'relative', flexShrink: 0 }}>
          <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
            <defs>
              <linearGradient id="dial-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={RFI.green}/>
                <stop offset="1" stopColor={RFI.teal}/>
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="42" fill="none" stroke={RFI.fillMed} strokeWidth="6"/>
            <circle cx="50" cy="50" r="42" fill="none" stroke="url(#dial-g)" strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${264 * 0.38} 264`}/>
            {/* tick marks for months */}
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i / 12) * Math.PI * 2;
              const x1 = 50 + Math.cos(a) * 49;
              const y1 = 50 + Math.sin(a) * 49;
              const x2 = 50 + Math.cos(a) * 46;
              const y2 = 50 + Math.sin(a) * 46;
              const done = i < 4;
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                           stroke={done ? RFI.green : 'rgba(255,255,255,0.15)'}
                           strokeWidth="1.4" strokeLinecap="round"/>;
            })}
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.muted,
                          letterSpacing: '0.15em' }}>MÊS</div>
            <div style={{ fontFamily: 'Syne, system-ui', fontWeight: 800, fontSize: 32,
                          color: RFI.text, lineHeight: 1 }}>04</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.green,
                          marginTop: 2 }}>/ 12</div>
          </div>
        </div>
        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MonoLabel color={RFI.green} size={9}>Rodada ativa</MonoLabel>
          <div style={{
            fontFamily: 'Syne, system-ui', fontWeight: 700, fontSize: 20, color: RFI.text,
            marginTop: 4, letterSpacing: '-0.02em', lineHeight: 1.1,
          }}>Renovação<br/>MEI · 12m</div>
          <div style={{ fontSize: 11, color: RFI.text2, marginTop: 6 }}>
            Sorteio em <span style={{ color: RFI.green, fontWeight: 600 }}>5 dias</span>
          </div>
          <div style={{
            marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(0,0,0,0.4)', border: `1px solid ${RFI.border}`,
          }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.muted }}>PRÊMIO</span>
            <span style={{ fontFamily: 'Syne, system-ui', fontWeight: 700, fontSize: 14, color: RFI.text }}>
              R$ 10.000
            </span>
          </div>
        </div>
      </div>
      {/* member orbit */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex' }}>
          {['AL','BR','CD','EF','GH','+7'].map((n, i) => (
            <div key={i} style={{
              width: 24, height: 24, borderRadius: '50%', marginLeft: i === 0 ? 0 : -8,
              background: i === 5 ? RFI.surface2 : `hsl(${(i * 60) % 360} 40% 40%)`,
              border: `2px solid ${RFI.bg}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 8, fontWeight: 600, color: RFI.text,
              fontFamily: 'JetBrains Mono, monospace',
            }}>{n}</div>
          ))}
        </div>
        <span style={{ fontSize: 10, color: RFI.muted }}>12 membros · 4 sorteados</span>
      </div>
    </div>
  );
}

// ── Hero variant: Ladder
function HomeHeroLadder({ user }) {
  return (
    <div style={{
      position: 'relative', borderRadius: 24, overflow: 'hidden',
      background: `linear-gradient(160deg, ${RFI.navyDeep} 0%, ${RFI.bg} 70%)`,
      border: `1px solid ${RFI.border}`, padding: 20,
    }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flex: 1 }}>
          <MonoLabel color={RFI.green} size={9}>Sua jornada</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 32, fontWeight: 800,
                        color: RFI.text, letterSpacing: '-0.03em', marginTop: 4, lineHeight: 1 }}>
            Nv.2
          </div>
          <div style={{ fontSize: 12, color: RFI.text2, marginTop: 4 }}>Comprovado · 3,3x</div>
          <div style={{ marginTop: 12, fontSize: 11, color: RFI.muted }}>
            Score <span style={{ color: RFI.text, fontWeight: 600 }}>{user.score}</span> /
            <span style={{ color: RFI.green }}> +{user.scoreDelta}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 6, paddingTop: 4 }}>
          {LEVELS.map(l => (
            <div key={l.lv} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 10,
              background: l.current ? 'rgba(20,241,149,0.08)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${l.current ? 'rgba(20,241,149,0.3)' : RFI.border}`,
              opacity: l.unlocked ? 1 : 0.5,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: l.current ? RFI.green : l.unlocked ? RFI.surface2 : 'transparent',
                border: l.unlocked ? 'none' : `1px dashed ${RFI.muted}`,
                color: l.current ? RFI.bgDeep : RFI.text,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
              }}>{l.lv}</div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: RFI.text }}>{l.name}</div>
                <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                  {l.colat}% · {l.lev}x
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Hero variant: Vault
function HomeHeroVault({ user }) {
  return (
    <div style={{
      position: 'relative', borderRadius: 24, overflow: 'hidden',
      background: `linear-gradient(160deg, ${RFI.navyDeep} 0%, ${RFI.bg} 70%)`,
      border: `1px solid ${RFI.border}`, padding: 20,
    }}>
      <MonoLabel color={RFI.green} size={9}>◆ Saldo protegido</MonoLabel>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
        <span style={{ fontFamily: 'Syne', fontSize: 34, fontWeight: 800,
                       color: RFI.text, letterSpacing: '-0.03em' }}>
          {fmtBRL(user.balance)}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 16 }}>
        {[
          { l: 'Escrow',   v: '65%',     c: RFI.green },
          { l: 'Cofre',    v: '1%',      c: RFI.teal },
          { l: 'Yield',    v: '6,8% APY',c: RFI.purple },
        ].map(x => (
          <div key={x.l} style={{
            padding: '10px 8px', borderRadius: 12,
            background: RFI.fillSoft, border: `1px solid ${RFI.border}`,
          }}>
            <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace',
                          letterSpacing: '.1em', textTransform: 'uppercase' }}>{x.l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: x.c,
                          fontFamily: 'Syne, system-ui', marginTop: 2 }}>{x.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Group row card
function GroupRow({ g, onClick }) {
  const toneColor = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[g.tone];
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', background: RFI.surface1,
      border: `1px solid ${RFI.border}`, borderRadius: 16, padding: 14,
      cursor: 'pointer', color: RFI.text, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 3, background: toneColor }}/>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: `${toneColor}1A`, border: `1px solid ${toneColor}4D`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>{g.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: RFI.text }}>{g.name}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: RFI.text,
                          fontFamily: 'Syne, system-ui' }}>{fmtBRL(g.prize).replace(',00','')}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4,
                        fontSize: 10, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace',
                        letterSpacing: '.08em' }}>
            <span>Mês {g.month.toString().padStart(2, '0')} / {g.total}</span>
            <span style={{ color: g.status === 'drawn' ? RFI.green : RFI.text2 }}>
              {g.status === 'drawn' ? '✓ sorteado' : `sort. ${g.draw}`}
            </span>
          </div>
          <div style={{ marginTop: 10, height: 4, background: RFI.fillMed,
                        borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${g.progress * 100}%`, height: '100%',
              background: `linear-gradient(90deg, ${toneColor}, ${toneColor}99)`,
            }}/>
          </div>
        </div>
      </div>
    </button>
  );
}

Object.assign(window, {
  USER, ACTIVE_GROUPS, DISCOVER_GROUPS, TIMELINE, SAS_BONDS, LEVELS,
  RFIBackdrop, RFITopBar, RFITabBar, ScreenHome, GroupRow,
});
