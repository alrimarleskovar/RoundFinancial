// RoundFi brand primitives — tokens, logo, icons, shared bits

const RFI = {
  // surface
  bg:        '#06090F',
  bgDeep:    '#02050B',
  surface1:  '#0C1018',
  surface2:  '#111828',
  surface3:  '#18202F',
  // accents (from pitch)
  green:     '#14F195',
  teal:      '#00C8FF',
  purple:    '#9945FF',
  amber:     '#FFB547',
  red:       '#FF5656',
  // brand blue (from logo bg)
  navy:      '#0A2748',
  navyDeep:  '#071A32',
  // text
  text:      '#EEF0F8',
  text2:     'rgba(238,240,248,0.65)',
  muted:     '#4E5870',
  border:    'rgba(255,255,255,0.08)',
  borderStr: 'rgba(255,255,255,0.14)',
  fillSoft:  'rgba(255,255,255,0.03)',
  fillMed:   'rgba(255,255,255,0.08)',
};

// ── Logo mark (ring + curl) — redrawn from the RoundFi glyph
function RFILogoMark({ size = 28, style = {} }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={style} fill="none">
      <defs>
        <linearGradient id={`rfi-g-${size}`} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#27D67B"/>
          <stop offset=".45" stopColor="#3BC6D9"/>
          <stop offset="1" stopColor="#1E90C9"/>
        </linearGradient>
      </defs>
      {/* open ring */}
      <path
        d="M32 6
           a26 26 0 1 1 -22.2 12.5"
        stroke={`url(#rfi-g-${size})`}
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* inner curl drop */}
      <path
        d="M38 14
           c10 4 16 14 14 26
           c-1.6 9 -8 15 -15 18
           c7 -10 5 -24 -6 -34
           c2 -5 4 -8 7 -10 z"
        fill={`url(#rfi-g-${size})`}
        opacity=".9"
      />
    </svg>
  );
}

function RFILogoLockup({ size = 28, subline = false, color = '#fff' }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32 }}>
      <RFILogoMark size={size} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 2 }}>
        <span style={{
          fontFamily: 'Syne, system-ui', fontWeight: 700, letterSpacing: '-0.02em',
          fontSize: size * 0.78, color,
        }}>Round<span style={{ fontWeight: 800 }}>Fi</span></span>
        {subline && <span style={{
          fontFamily: 'DM Sans, system-ui', fontWeight: 400,
          fontSize: size * 0.28, color: 'rgba(255,255,255,0.55)',
          letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2,
        }}>Collaborative Finance</span>}
      </div>
    </div>
  );
}

// ── Icon set (stroke-based, 24px grid)
const Icon = ({ d, size = 22, stroke = 'currentColor', sw = 1.6, fill = 'none', children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {d ? <path d={d}/> : children}
  </svg>
);

const Icons = {
  home:     (p) => <Icon {...p}><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></Icon>,
  groups:   (p) => <Icon {...p}><circle cx="8" cy="9" r="3"/><circle cx="17" cy="8" r="2.2"/><path d="M2 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M14 19c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5"/></Icon>,
  score:    (p) => <Icon {...p}><path d="M12 3l2.4 5.2 5.6.8-4 4 1 5.6L12 16l-5 2.6 1-5.6-4-4 5.6-.8z"/></Icon>,
  wallet:   (p) => <Icon {...p}><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none"/></Icon>,
  bell:     (p) => <Icon {...p}><path d="M6 10a6 6 0 1 1 12 0v4l2 3H4l2-3z"/><path d="M10 20a2 2 0 0 0 4 0"/></Icon>,
  arrow:    (p) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6"/></Icon>,
  back:     (p) => <Icon {...p}><path d="M19 12H5M11 6l-6 6 6 6"/></Icon>,
  plus:     (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  check:    (p) => <Icon {...p}><path d="M4 12l5 5L20 6"/></Icon>,
  lock:     (p) => <Icon {...p}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></Icon>,
  shield:   (p) => <Icon {...p}><path d="M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z"/></Icon>,
  spark:    (p) => <Icon {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></Icon>,
  dot:      (p) => <Icon {...p}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></Icon>,
  refresh:  (p) => <Icon {...p}><path d="M3 12a9 9 0 0 1 15.5-6.3L21 3M21 12a9 9 0 0 1-15.5 6.3L3 21"/><path d="M21 3v6h-6M3 21v-6h6"/></Icon>,
  trend:    (p) => <Icon {...p}><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></Icon>,
  ticket:   (p) => <Icon {...p}><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M10 6v12" strokeDasharray="2 2"/></Icon>,
  send:     (p) => <Icon {...p}><path d="M4 12L20 4l-3 16-5-7z"/><path d="M12 13l5-9"/></Icon>,
  chart:    (p) => <Icon {...p}><path d="M4 20V8M10 20V4M16 20v-8M22 20H2"/></Icon>,
  user:     (p) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></Icon>,
  info:     (p) => <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/></Icon>,
  close:    (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>,
  eye:      (p) => <Icon {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></Icon>,
  copy:     (p) => <Icon {...p}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></Icon>,
};

// ── Reusable bits
function RFIPill({ tone = 'n', children, style = {} }) {
  const tones = {
    g: { c: RFI.green,  b: 'rgba(20,241,149,.12)', br: 'rgba(20,241,149,.3)' },
    t: { c: RFI.teal,   b: 'rgba(0,200,255,.1)',   br: 'rgba(0,200,255,.3)' },
    p: { c: RFI.purple, b: 'rgba(153,69,255,.1)',  br: 'rgba(153,69,255,.3)' },
    a: { c: RFI.amber,  b: 'rgba(255,181,71,.1)',  br: 'rgba(255,181,71,.3)' },
    r: { c: RFI.red,    b: 'rgba(255,86,86,.1)',   br: 'rgba(255,86,86,.3)' },
    n: { c: RFI.text2,  b: 'rgba(255,255,255,.04)',br: RFI.border },
  };
  const tt = tones[tone] || tones.n;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 999,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 500,
      letterSpacing: '.06em', textTransform: 'uppercase',
      background: tt.b, color: tt.c, border: `1px solid ${tt.br}`,
      whiteSpace: 'nowrap', ...style,
    }}>{children}</span>
  );
}

function RFICard({ children, accent, style = {}, ...rest }) {
  const accents = { g: RFI.green, t: RFI.teal, p: RFI.purple, a: RFI.amber };
  return (
    <div {...rest} style={{
      background: RFI.surface1,
      border: `1px solid ${RFI.border}`,
      borderRadius: 18,
      padding: 16,
      position: 'relative',
      overflow: 'hidden',
      ...style,
    }}>
      {accent && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${accents[accent]}, transparent 70%)`,
        }}/>
      )}
      {children}
    </div>
  );
}

// a handy mono label
const MonoLabel = ({ children, color, size = 10, style = {} }) => (
  <span style={{
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: size, letterSpacing: '.16em', textTransform: 'uppercase',
    color: color || RFI.muted, ...style,
  }}>{children}</span>
);

// currency formatter (R$)
const fmtBRL = (n) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n) => n.toLocaleString('pt-BR');

Object.assign(window, {
  RFI, RFILogoMark, RFILogoLockup, Icons, Icon, RFIPill, RFICard, MonoLabel, fmtBRL, fmtInt,
});
