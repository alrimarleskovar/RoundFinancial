// RoundFi — remaining screens: Groups, Group detail, Pay, Score, Sell NFT, Notifications

// ─────────────────────────────────────────────────────────────
// GROUPS (Browse + active)
// ─────────────────────────────────────────────────────────────
function ScreenGroups({ go }) {
  const [tab, setTab] = React.useState('active');
  return (
    <div style={{ padding: '0 0 120px' }}>
      <div style={{ padding: '4px 20px 8px' }}>
        <div style={{ fontFamily: 'Syne', fontSize: 26, fontWeight: 800,
                      color: RFI.text, letterSpacing: '-0.03em' }}>Grupos</div>
        <div style={{ fontSize: 12, color: RFI.muted, marginTop: 4 }}>
          Escolha um consórcio do seu nível ou abra um novo ciclo.
        </div>
      </div>
      {/* segmented */}
      <div style={{ padding: '14px 20px 8px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
          background: RFI.surface1, borderRadius: 12, padding: 4,
          border: `1px solid ${RFI.border}`,
        }}>
          {['active','discover'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: tab === t ? RFI.surface2 : 'transparent',
              color: tab === t ? RFI.text : RFI.muted,
              fontSize: 12, fontWeight: 600,
            }}>{t === 'active' ? 'Meus grupos' : 'Descobrir'}</button>
          ))}
        </div>
      </div>

      {tab === 'active' && (
        <div style={{ padding: '8px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ACTIVE_GROUPS.map(g => <GroupRow key={g.id} g={g} onClick={() => go('group', g.id)}/>)}
        </div>
      )}

      {tab === 'discover' && (
        <div style={{ padding: '8px 20px' }}>
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, overflow: 'auto', paddingBottom: 12 }}>
            {['Todos','Nv.1','Nv.2','Nv.3 ✦','< R$ 20k','PME','Pessoal'].map((c, i) => (
              <span key={c} style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 11,
                whiteSpace: 'nowrap',
                background: i === 0 ? 'rgba(20,241,149,0.08)' : 'rgba(255,255,255,0.02)',
                color: i === 0 ? RFI.green : RFI.text2,
                border: `1px solid ${i === 0 ? 'rgba(20,241,149,0.3)' : RFI.border}`,
              }}>{c}</span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {DISCOVER_GROUPS.map(g => <DiscoverRow key={g.id} g={g} onClick={() => go('join', g.id)}/>)}
          </div>
          {/* Create CTA */}
          <button style={{
            marginTop: 14, width: '100%', padding: 14, borderRadius: 16,
            background: RFI.fillSoft,
            border: `1px dashed ${RFI.borderStr}`, color: RFI.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}>
            <Icons.plus size={16}/> Criar novo ciclo
          </button>
        </div>
      )}
    </div>
  );
}

function DiscoverRow({ g, onClick }) {
  const toneColor = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[g.tone];
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', background: RFI.surface1,
      border: `1px solid ${RFI.border}`, borderRadius: 16, padding: 14,
      cursor: 'pointer', color: RFI.text,
    }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: `${toneColor}1A`, border: `1px solid ${toneColor}4D`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>{g.emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
            {g.level === 3 && <RFIPill tone="p">✦ VIP</RFIPill>}
            {g.level === 1 && <RFIPill tone="n">Nv.1+</RFIPill>}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
            <Meta label="Prêmio" v={fmtBRL(g.prize).replace(',00','')}/>
            <Meta label="Parcela" v={fmtBRL(g.installment).replace(',00','')}/>
            <Meta label="Prazo" v={`${g.months}m`}/>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 4, background: RFI.fillMed,
                          borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(g.filled / g.total) * 100}%`, height: '100%',
                            background: toneColor }}/>
            </div>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: RFI.muted }}>
              {g.filled}/{g.total}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function Meta({ label, v }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace',
                    textTransform: 'uppercase', letterSpacing: '.1em' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text, marginTop: 2,
                    fontFamily: 'Syne, system-ui' }}>{v}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// GROUP DETAIL
// ─────────────────────────────────────────────────────────────
function ScreenGroup({ go }) {
  const g = ACTIVE_GROUPS[0]; // Renovação MEI
  return (
    <div style={{ padding: '0 0 140px' }}>
      <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => go('home')} style={{
          width: 36, height: 36, borderRadius: 11, border: `1px solid ${RFI.border}`,
          background: RFI.fillSoft, color: RFI.text, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icons.back size={18}/></button>
        <div style={{ flex: 1 }}>
          <MonoLabel color={RFI.green} size={9}>Grupo ativo</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 700,
                        color: RFI.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {g.name}
          </div>
        </div>
      </div>

      {/* Prize + draw countdown */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{
          borderRadius: 20, padding: 18, position: 'relative', overflow: 'hidden',
          background: `linear-gradient(135deg, ${RFI.navyDeep}, ${RFI.bg})`,
          border: `1px solid ${RFI.border}`,
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(60% 60% at 100% 0%, rgba(20,241,149,0.15), transparent)',
          }}/>
          <div style={{ position: 'relative' }}>
            <MonoLabel color={RFI.green} size={9}>Prêmio do mês</MonoLabel>
            <div style={{ fontFamily: 'Syne', fontSize: 38, fontWeight: 800,
                          color: RFI.text, letterSpacing: '-0.03em', marginTop: 4, lineHeight: 1 }}>
              {fmtBRL(g.prize).replace(',00','')}
            </div>
            <div style={{ fontSize: 12, color: RFI.text2, marginTop: 6 }}>
              Próximo sorteio em <span style={{ color: RFI.green, fontWeight: 600 }}>5 dias</span> · 12 cotas
            </div>
            {/* Countdown pills */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginTop: 16 }}>
              {[['05','DIAS'],['12','HRS'],['47','MIN'],['22','SEG']].map(([v, l]) => (
                <div key={l} style={{
                  padding: '8px 4px', textAlign: 'center', borderRadius: 10,
                  background: 'rgba(0,0,0,0.4)', border: `1px solid ${RFI.border}`,
                }}>
                  <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 800, color: RFI.text }}>{v}</div>
                  <div style={{ fontSize: 8, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace',
                                letterSpacing: '.15em' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ padding: '20px 20px 0' }}>
        <MonoLabel color={RFI.green} size={10}>◆ Linha do tempo · 12 parcelas</MonoLabel>
        <div style={{ marginTop: 12, display: 'flex', gap: 6, overflow: 'auto', paddingBottom: 8 }}>
          {Array.from({ length: 12 }).map((_, i) => {
            const month = i + 1;
            const state = month < 4 ? 'paid' : month === 4 ? 'current' : 'due';
            const c = state === 'paid' ? RFI.green : state === 'current' ? RFI.teal : RFI.muted;
            return (
              <div key={i} style={{
                minWidth: 44, padding: '10px 6px', borderRadius: 10, textAlign: 'center',
                background: state === 'current' ? 'rgba(0,200,255,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${state === 'current' ? 'rgba(0,200,255,0.3)' : RFI.border}`,
              }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: c,
                              letterSpacing: '.1em' }}>M{String(month).padStart(2,'0')}</div>
                <div style={{ marginTop: 6, width: 8, height: 8, borderRadius: '50%',
                              background: state === 'paid' ? RFI.green
                                       : state === 'current' ? RFI.teal
                                       : 'rgba(255,255,255,0.1)',
                              margin: '6px auto 0' }}/>
              </div>
            );
          })}
        </div>
      </div>

      {/* Escrow matrix */}
      <div style={{ padding: '20px 20px 0' }}>
        <RFICard accent="g">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <MonoLabel color={RFI.green}>◆ Matriz de escrow</MonoLabel>
              <div style={{ fontSize: 13, fontWeight: 600, color: RFI.text, marginTop: 4 }}>
                65% protegido no contrato
              </div>
            </div>
            <div style={{
              padding: '4px 10px', borderRadius: 999,
              background: 'rgba(20,241,149,0.1)', border: '1px solid rgba(20,241,149,0.3)',
              color: RFI.green, fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
              fontWeight: 600,
            }}>ATIVO</div>
          </div>
          {/* split bar */}
          <div style={{ marginTop: 14, display: 'flex', height: 10, borderRadius: 6,
                        overflow: 'hidden', gap: 2 }}>
            <div style={{ flex: 65, background: RFI.green }}/>
            <div style={{ flex: 30, background: RFI.teal }}/>
            <div style={{ flex: 5,  background: RFI.purple }}/>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10,
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
            <div><span style={{ color: RFI.green }}>■ </span><span style={{ color: RFI.text2 }}>Retido 65%</span></div>
            <div><span style={{ color: RFI.teal }}>■ </span><span style={{ color: RFI.text2 }}>Livre 30%</span></div>
            <div><span style={{ color: RFI.purple }}>■ </span><span style={{ color: RFI.text2 }}>Cofre 5%</span></div>
          </div>
        </RFICard>
      </div>

      {/* members */}
      <div style={{ padding: '20px 20px 0' }}>
        <MonoLabel color={RFI.green} size={10}>◆ 12 cotistas</MonoLabel>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
          {Array.from({ length: 12 }).map((_, i) => {
            const sorted = i < 4;
            const me = i === 7;
            return (
              <div key={i} style={{
                aspectRatio: 1, borderRadius: 12, position: 'relative',
                background: me ? 'rgba(20,241,149,0.1)' : RFI.surface1,
                border: `1.5px solid ${me ? RFI.green : sorted ? 'rgba(0,200,255,0.3)' : RFI.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 600, color: me ? RFI.green : RFI.text,
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {me ? 'EU' : `#${String(i+1).padStart(2,'0')}`}
                {sorted && (
                  <div style={{
                    position: 'absolute', top: -4, right: -4, width: 14, height: 14,
                    borderRadius: '50%', background: RFI.teal, border: `2px solid ${RFI.bg}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}><Icons.check size={8} stroke={RFI.bgDeep} sw={3}/></div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pay CTA */}
      <div style={{ padding: '22px 20px 0' }}>
        <button onClick={() => go('pay')} style={{
          width: '100%', padding: '16px', borderRadius: 16,
          background: `linear-gradient(135deg, ${RFI.green}, ${RFI.teal})`,
          border: 'none', color: RFI.bgDeep, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 10px 28px rgba(20,241,149,0.25)',
        }}>
          Pagar parcela · {fmtBRL(g.installment).replace(',00','')}
          <Icons.arrow size={16} stroke={RFI.bgDeep} sw={2.2}/>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PAY FLOW
// ─────────────────────────────────────────────────────────────
function ScreenPay({ go }) {
  const [step, setStep] = React.useState('review'); // review → auth → success
  const [authing, setAuthing] = React.useState(false);
  const g = ACTIVE_GROUPS[0];

  const breakdown = [
    { l: 'Parcela base', v: 750.00, c: RFI.text },
    { l: 'Escrow (65%)', v: 487.50, c: RFI.green, sub: 'retido no contrato' },
    { l: 'Cofre solidário (1%)', v: 7.50, c: RFI.teal },
    { l: 'Taxa protocolo', v: 12.40, c: RFI.muted },
  ];

  React.useEffect(() => {
    if (step === 'auth') {
      const t = setTimeout(() => setStep('success'), 1800);
      return () => clearTimeout(t);
    }
  }, [step]);

  if (step === 'success') return <PaySuccess go={go} g={g}/>;

  return (
    <div style={{ padding: '0 0 120px' }}>
      <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => go('home')} style={{
          width: 36, height: 36, borderRadius: 11, border: `1px solid ${RFI.border}`,
          background: RFI.fillSoft, color: RFI.text, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icons.close size={18}/></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 700, color: RFI.text,
                        letterSpacing: '-0.02em' }}>Pagar parcela</div>
          <div style={{ fontSize: 11, color: RFI.muted, marginTop: 2 }}>{g.name} · M04</div>
        </div>
      </div>

      {/* Amount big */}
      <div style={{ padding: '24px 20px 0', textAlign: 'center' }}>
        <MonoLabel color={RFI.green}>◆ Total a pagar</MonoLabel>
        <div style={{ fontFamily: 'Syne', fontSize: 52, fontWeight: 800,
                      color: RFI.text, letterSpacing: '-0.04em', marginTop: 8, lineHeight: 1 }}>
          {fmtBRL(g.installment)}
        </div>
        <div style={{ fontSize: 11, color: RFI.muted, marginTop: 8,
                      fontFamily: 'JetBrains Mono, monospace' }}>
          VENCE EM 5 DIAS · 15/MAI/2026
        </div>
      </div>

      {/* Breakdown */}
      <div style={{ padding: '28px 20px 0' }}>
        <RFICard>
          <MonoLabel>◆ Detalhamento</MonoLabel>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {breakdown.map(b => (
              <div key={b.l} style={{ display: 'flex', justifyContent: 'space-between',
                                      alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 12, color: RFI.text }}>{b.l}</div>
                  {b.sub && <div style={{ fontSize: 10, color: RFI.muted, marginTop: 1 }}>{b.sub}</div>}
                </div>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: b.c }}>
                  {fmtBRL(b.v)}
                </span>
              </div>
            ))}
            <div style={{ height: 1, background: RFI.border, marginTop: 4 }}/>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: RFI.text }}>Total</span>
              <span style={{ fontFamily: 'Syne', fontSize: 16, fontWeight: 800, color: RFI.text }}>
                {fmtBRL(g.installment)}
              </span>
            </div>
          </div>
        </RFICard>
      </div>

      {/* Source */}
      <div style={{ padding: '14px 20px 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 14, borderRadius: 16, background: RFI.surface1,
          border: `1px solid ${RFI.border}`,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: `linear-gradient(135deg, ${RFI.purple}, ${RFI.teal})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#fff',
            fontFamily: 'JetBrains Mono, monospace',
          }}>SOL</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text }}>Pagar via Blink · X</div>
            <div style={{ fontSize: 10, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
              {USER.walletShort} · 4,2 SOL
            </div>
          </div>
          <Icons.refresh size={16} stroke={RFI.muted}/>
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '22px 20px 0' }}>
        <button onClick={() => { setAuthing(true); setStep('auth'); }} style={{
          width: '100%', padding: '16px', borderRadius: 16,
          background: `linear-gradient(135deg, ${RFI.green}, ${RFI.teal})`,
          border: 'none', color: RFI.bgDeep, fontSize: 14, fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 10px 28px rgba(20,241,149,0.25)',
        }}>
          {step === 'auth' ? 'Autenticando Face ID…' : 'Confirmar com Face ID'}
        </button>
        <div style={{ marginTop: 10, textAlign: 'center', fontSize: 10, color: RFI.muted,
                      fontFamily: 'JetBrains Mono, monospace' }}>
          → Emite Reputation Bond SAS #04 ao confirmar
        </div>
      </div>
    </div>
  );
}

function PaySuccess({ go, g }) {
  return (
    <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', textAlign: 'center', minHeight: '80%' }}>
      {/* check burst */}
      <div style={{
        width: 120, height: 120, borderRadius: '50%', position: 'relative',
        background: 'radial-gradient(circle, rgba(20,241,149,0.2), transparent 70%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 20,
      }}>
        <div style={{
          width: 70, height: 70, borderRadius: '50%',
          background: `linear-gradient(135deg, ${RFI.green}, ${RFI.teal})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 20px 40px rgba(20,241,149,0.35)',
        }}>
          <Icons.check size={34} stroke={RFI.bgDeep} sw={3}/>
        </div>
      </div>
      <div style={{ fontFamily: 'Syne', fontSize: 28, fontWeight: 800, color: RFI.text,
                    letterSpacing: '-0.03em', marginTop: 28, lineHeight: 1.1 }}>
        Pagamento confirmado
      </div>
      <div style={{ fontSize: 13, color: RFI.text2, marginTop: 10, maxWidth: 260 }}>
        Seu Reputation Bond foi cunhado na Solana Attestation Service.
      </div>

      <RFICard accent="g" style={{ width: '100%', marginTop: 26, textAlign: 'left' }}>
        <MonoLabel color={RFI.green}>◆ Reputation bond #04</MonoLabel>
        <div style={{ fontFamily: 'Syne', fontSize: 15, fontWeight: 700, color: RFI.text, marginTop: 6 }}>
          {g.name}
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between',
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
          <span style={{ color: RFI.muted }}>TX</span>
          <span style={{ color: RFI.text }}>5jN…k9Fn ↗</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between',
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
          <span style={{ color: RFI.muted }}>SCORE</span>
          <span style={{ color: RFI.green }}>+6 pts → {USER.score + 6}</span>
        </div>
      </RFICard>

      <button onClick={() => go('home')} style={{
        marginTop: 24, width: '100%', padding: 14, borderRadius: 14,
        background: RFI.fillSoft, border: `1px solid ${RFI.borderStr}`,
        color: RFI.text, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      }}>Voltar ao início</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCORE / REPUTATION PASSPORT
// ─────────────────────────────────────────────────────────────
function ScreenScore({ go }) {
  return (
    <div style={{ padding: '0 0 120px' }}>
      <div style={{ padding: '4px 20px 0' }}>
        <MonoLabel color={RFI.green}>◆ SAS Passport</MonoLabel>
        <div style={{ fontFamily: 'Syne', fontSize: 26, fontWeight: 800,
                      color: RFI.text, letterSpacing: '-0.03em', marginTop: 4 }}>
          Reputação on-chain
        </div>
      </div>

      {/* Passport card */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{
          borderRadius: 24, padding: 20, position: 'relative', overflow: 'hidden',
          background: `linear-gradient(155deg, ${RFI.navy} 0%, ${RFI.bgDeep} 60%, ${RFI.navyDeep})`,
          border: `1px solid ${RFI.borderStr}`,
        }}>
          {/* watermark ring */}
          <div style={{
            position: 'absolute', top: -30, right: -30, width: 160, height: 160,
            borderRadius: '50%', border: `20px solid ${RFI.green}1A`,
            filter: 'blur(1px)',
          }}/>
          <div style={{
            position: 'absolute', bottom: -40, left: -20, width: 120, height: 120,
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,200,255,0.15), transparent 70%)',
          }}/>

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <RFILogoMark size={32}/>
              <div style={{ textAlign: 'right' }}>
                <MonoLabel size={9}>SOLANA · SAS</MonoLabel>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                              color: RFI.text2, marginTop: 2 }}>
                  {USER.walletShort}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 28 }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                            color: RFI.muted, letterSpacing: '.15em' }}>
                REPUTATION SCORE
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                <span style={{ fontFamily: 'Syne', fontSize: 72, fontWeight: 800, color: RFI.text,
                               letterSpacing: '-0.04em', lineHeight: 1 }}>{USER.score}</span>
                <span style={{ fontSize: 13, color: RFI.green, fontWeight: 600,
                               fontFamily: 'JetBrains Mono, monospace' }}>
                  +{USER.scoreDelta}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 16, height: 6, background: RFI.fillMed,
                          borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${(USER.score / 850) * 100}%`, height: '100%',
                            background: `linear-gradient(90deg, ${RFI.green}, ${RFI.teal})` }}/>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8,
                          fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RFI.muted }}>
              <span>BAIXO · 300</span>
              <span style={{ color: RFI.teal }}>COMPROVADO</span>
              <span>VETERANO · 850</span>
            </div>

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: RFI.text2 }}>{USER.name}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                              color: RFI.muted, marginTop: 2 }}>{USER.handle}</div>
              </div>
              <RFIPill tone="g">Nv.2 · Comprovado</RFIPill>
            </div>
          </div>
        </div>
      </div>

      {/* Level benefits */}
      <div style={{ padding: '22px 20px 0' }}>
        <MonoLabel color={RFI.green}>◆ Níveis de reputação</MonoLabel>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LEVELS.map(l => {
            const c = l.lv === 1 ? RFI.amber : l.lv === 2 ? RFI.teal : RFI.green;
            return (
              <div key={l.lv} style={{
                padding: 14, borderRadius: 14,
                background: l.current ? `rgba(0,200,255,0.05)` : RFI.surface1,
                border: `1px solid ${l.current ? 'rgba(0,200,255,0.3)' : RFI.border}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: `${c}1A`, border: `1px solid ${c}4D`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Syne', fontSize: 16, fontWeight: 800, color: c,
                }}>{l.lv}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: RFI.text }}>
                    {l.name} {l.vip && <span style={{ color: RFI.green, fontSize: 11 }}>✦ VIP</span>}
                    {l.current && <span style={{ color: RFI.teal, fontSize: 10,
                                                 marginLeft: 6, fontFamily: 'JetBrains Mono, monospace' }}>
                      ← VOCÊ
                    </span>}
                  </div>
                  <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                                fontFamily: 'JetBrains Mono, monospace' }}>
                    {l.colat}% colateral · {l.lev}x alavancagem
                  </div>
                </div>
                {!l.unlocked && <Icons.lock size={16} stroke={RFI.muted}/>}
                {l.unlocked && <Icons.check size={16} stroke={RFI.green} sw={2}/>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bonds list */}
      <div style={{ padding: '22px 20px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <MonoLabel color={RFI.green}>◆ Atestados SAS ({SAS_BONDS.length})</MonoLabel>
          <span style={{ fontSize: 10, color: RFI.muted,
                         fontFamily: 'JetBrains Mono, monospace' }}>17 parcelas pagas</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SAS_BONDS.map(b => {
            const c = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber }[b.tone];
            return (
              <div key={b.id} style={{
                padding: 12, borderRadius: 12, background: RFI.surface1,
                border: `1px solid ${RFI.border}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10,
                  background: `${c}1A`, border: `1px solid ${c}4D`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icons.shield size={16} stroke={c}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: RFI.text }}>{b.cycle}</div>
                  <div style={{ fontSize: 10, color: RFI.muted, marginTop: 2,
                                fontFamily: 'JetBrains Mono, monospace' }}>
                    {b.date} · {b.installments} atestados
                  </div>
                </div>
                {b.status === 'active' ? (
                  <RFIPill tone={b.tone}>Ativo</RFIPill>
                ) : (
                  <RFIPill tone="n">✓ Fechado</RFIPill>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SELL NFT (Escape valve)
// ─────────────────────────────────────────────────────────────
function ScreenSell({ go }) {
  const [price, setPrice] = React.useState(6000);
  const invested = 7496;
  const market = 6300;
  const floor = 5200;
  return (
    <div style={{ padding: '0 0 140px' }}>
      <div style={{ padding: '4px 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => go('home')} style={{
          width: 36, height: 36, borderRadius: 11, border: `1px solid ${RFI.border}`,
          background: RFI.fillSoft, color: RFI.text, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icons.back size={18}/></button>
        <div style={{ flex: 1 }}>
          <MonoLabel color={RFI.amber} size={9}>◆ Válvula de escape</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 700, color: RFI.text,
                        letterSpacing: '-0.02em' }}>Vender cota NFT</div>
        </div>
      </div>

      {/* NFT preview */}
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{
          borderRadius: 22, overflow: 'hidden', position: 'relative',
          background: `linear-gradient(135deg, ${RFI.surface2}, ${RFI.bgDeep})`,
          border: `1px solid ${RFI.borderStr}`, padding: 20, minHeight: 180,
        }}>
          <div style={{
            position: 'absolute', top: 0, right: 0, width: 200, height: 200,
            background: `radial-gradient(circle, rgba(153,69,255,0.2), transparent 60%)`,
          }}/>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <MonoLabel size={9}>COTA #07 · RENOVAÇÃO MEI</MonoLabel>
              <RFIPill tone="g">3 parcelas pagas</RFIPill>
            </div>
            <div style={{ marginTop: 28 }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                            color: RFI.muted, letterSpacing: '.15em' }}>CAPITAL INJETADO</div>
              <div style={{ fontFamily: 'Syne', fontSize: 34, fontWeight: 800, color: RFI.text,
                            letterSpacing: '-0.03em', marginTop: 4 }}>
                {fmtBRL(invested).replace(',00','')}
              </div>
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                  SCORE HERDADO
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: RFI.green,
                              fontFamily: 'Syne, system-ui', marginTop: 2 }}>+52 pts</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                  RESTAM
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: RFI.text,
                              fontFamily: 'Syne, system-ui', marginTop: 2 }}>9 parcelas</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                  CHANCE SORTEIO
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: RFI.teal,
                              fontFamily: 'Syne, system-ui', marginTop: 2 }}>+34%</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Price slider */}
      <div style={{ padding: '22px 20px 0' }}>
        <RFICard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <MonoLabel>◆ Preço de venda</MonoLabel>
            <span style={{ fontSize: 10, color: RFI.green,
                           fontFamily: 'JetBrains Mono, monospace' }}>
              {((price - floor) / (invested - floor) * 100).toFixed(0)}% do investido
            </span>
          </div>
          <div style={{ fontFamily: 'Syne', fontSize: 40, fontWeight: 800, color: RFI.text,
                        letterSpacing: '-0.03em', marginTop: 10, lineHeight: 1 }}>
            {fmtBRL(price).replace(',00','')}
          </div>
          <input type="range" min={floor} max={invested} step={100} value={price}
                 onChange={e => setPrice(+e.target.value)}
                 style={{ width: '100%', marginTop: 16, accentColor: RFI.green }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4,
                        fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace' }}>
            <span>Piso {fmtBRL(floor).replace(',00','')}</span>
            <span style={{ color: RFI.teal }}>Mercado {fmtBRL(market).replace(',00','')}</span>
            <span>Teto {fmtBRL(invested).replace(',00','')}</span>
          </div>
        </RFICard>
      </div>

      {/* Outcome */}
      <div style={{ padding: '14px 20px 0' }}>
        <RFICard style={{ background: 'rgba(20,241,149,0.04)', borderColor: 'rgba(20,241,149,0.2)' }}>
          <MonoLabel color={RFI.green}>◆ O que acontece</MonoLabel>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['Dívida restante quitada', RFI.green, '✓'],
              ['Reputação SAS mantida',   RFI.green, '✓'],
              ['Liquidez recebida',        RFI.text, fmtBRL(price - 2800).replace(',00','')],
              ['Comprador herda score',   RFI.teal,  '+52 pts'],
            ].map(([l, c, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: RFI.text2 }}>{l}</span>
                <span style={{ color: c, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{v}</span>
              </div>
            ))}
          </div>
        </RFICard>
      </div>

      <div style={{ padding: '22px 20px 0' }}>
        <button style={{
          width: '100%', padding: 16, borderRadius: 16,
          background: `linear-gradient(135deg, ${RFI.amber}, ${RFI.green})`,
          border: 'none', color: RFI.bgDeep, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', boxShadow: '0 10px 28px rgba(255,181,71,0.25)',
        }}>Listar no mercado secundário</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// WALLET — quick stub so the 5th tab has content
// ─────────────────────────────────────────────────────────────
function ScreenWallet({ go }) {
  return (
    <div style={{ padding: '0 0 120px' }}>
      <div style={{ padding: '4px 20px 0' }}>
        <MonoLabel color={RFI.green}>◆ Carteira</MonoLabel>
        <div style={{ fontFamily: 'Syne', fontSize: 26, fontWeight: 800,
                      color: RFI.text, letterSpacing: '-0.03em' }}>Saldo & yield</div>
      </div>
      <div style={{ padding: '18px 20px 0' }}>
        <div style={{
          borderRadius: 22, padding: 20,
          background: `linear-gradient(135deg, ${RFI.navyDeep}, ${RFI.bg})`,
          border: `1px solid ${RFI.border}`,
        }}>
          <MonoLabel>◆ Saldo disponível</MonoLabel>
          <div style={{ fontFamily: 'Syne', fontSize: 44, fontWeight: 800, color: RFI.text,
                        letterSpacing: '-0.04em', marginTop: 6, lineHeight: 1 }}>
            {fmtBRL(USER.balance)}
          </div>
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 12, background: RFI.fillSoft,
                          border: `1px solid ${RFI.border}` }}>
              <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace',
                            letterSpacing: '.1em' }}>YIELD · KAMINO</div>
              <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 700, color: RFI.purple,
                            marginTop: 4 }}>+{fmtBRL(USER.yield).replace(',00','')}</div>
              <div style={{ fontSize: 9, color: RFI.muted, marginTop: 2,
                            fontFamily: 'JetBrains Mono, monospace' }}>6,8% APY</div>
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: RFI.fillSoft,
                          border: `1px solid ${RFI.border}` }}>
              <div style={{ fontSize: 9, color: RFI.muted, fontFamily: 'JetBrains Mono, monospace',
                            letterSpacing: '.1em' }}>LOCKED · ESCROW</div>
              <div style={{ fontFamily: 'Syne', fontSize: 18, fontWeight: 700, color: RFI.green,
                            marginTop: 4 }}>{fmtBRL(19500).replace(',00','')}</div>
              <div style={{ fontSize: 9, color: RFI.muted, marginTop: 2,
                            fontFamily: 'JetBrains Mono, monospace' }}>3 grupos ativos</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '22px 20px 0' }}>
        <MonoLabel color={RFI.green}>◆ Últimas transações</MonoLabel>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            ['Parcela · MEI',     -892.40, RFI.text,  '12 ABR'],
            ['Yield · Kamino',    +52.30,  RFI.green, '10 ABR'],
            ['Parcela · Casa',    -2140.00, RFI.text, '08 ABR'],
            ['Venda cota #03',    +1890.00, RFI.teal,  '05 ABR'],
            ['Stake · Dev Setup', -620.00, RFI.text,  '01 ABR'],
          ].map(([l, v, c, d], i) => (
            <div key={i} style={{
              padding: '12px 14px', borderRadius: 12, background: RFI.surface1,
              border: `1px solid ${RFI.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: RFI.text }}>{l}</div>
                <div style={{ fontSize: 9, color: RFI.muted, marginTop: 2,
                              fontFamily: 'JetBrains Mono, monospace' }}>{d} · on-chain</div>
              </div>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                             fontWeight: 600, color: v > 0 ? RFI.green : c }}>
                {v > 0 ? '+' : ''}{fmtBRL(Math.abs(v)).replace(',00','')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  ScreenGroups, ScreenGroup, ScreenPay, ScreenScore, ScreenSell, ScreenWallet,
});
