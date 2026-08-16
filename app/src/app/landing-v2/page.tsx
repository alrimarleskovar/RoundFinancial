// /landing-v2 — CANDIDATA. Landing do handoff do Caio (02/08/2026),
// publicada numa rota própria para revisão antes de substituir `/`.
//
// Mesmo padrão que o `/grupos` atual seguiu (graduou do `/grupos-v2`):
// a candidata vive ao lado da atual, itera-se nela, e só então troca.
//
// O que difere do pacote original, e por quê:
//   - importa RFIOfficialMark / RFIOfficialLockup em vez de
//     RFILogoMark / RFILogoLockup. Os originais têm 5+ consumidores fora
//     da landing (TopBar, SideNav, MobileHome, loading, admin/ops), então
//     trocar a implementação deles levaria a marca oficial para o app
//     inteiro junto com a landing — decisão de escopo, não efeito
//     colateral. Na graduação isso vira uma troca só, em brand.tsx.
//
// O CSS vive em globals.css sob o bloco "Landing v2", todo prefixado
// `.rfi-`, sem tocar body/html/*/:root — por isso a rota não afeta nada.

"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";

import { RFIOfficialLockup, RFIOfficialMark } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";

const LINKS = {
  docs: "https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/spec/MASTER-SPEC.md",
  devnet: "https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/devnet-deployment.md",
  github: "https://github.com/alrimarleskovar/RoundFinancial",
  security: "https://github.com/alrimarleskovar/RoundFinancial/tree/main/docs/security",
};

type Language = "pt" | "en";

const copy = {
  pt: {
    nav: [
      "Como funciona",
      "Benefícios",
      "Passport",
      "Comparativo",
      "Simulador",
      "Segurança",
      "Docs",
    ],
    devnet: "Ambiente de teste — esta versão utiliza somente fundos fictícios.",
    environment: "Entenda o ambiente",
    explore: "Explorar grupos",
    heroEyebrow: "Grupos financeiros colaborativos na Solana",
    heroTitle: ["Contribua em grupo.", "Realize objetivos.", "Construa reputação."],
    heroBody:
      "A RoundFi organiza grupos financeiros colaborativos em que participantes contribuem em ciclos, recebem conforme as regras do grupo e constroem um histórico financeiro verificável.",
    exploreDevnet: "Explorar grupos na Devnet",
    understand: "Entender como funciona",
    proofs: ["Regras verificáveis", "Código aberto", "Histórico on-chain"],
    howEyebrow: "Como funciona",
    howTitle: "Um ciclo simples, com regras transparentes",
    howBody:
      "Do primeiro grupo ao histórico verificável, toda a jornada acontece em três etapas claras.",
    steps: [
      {
        title: "Escolha um grupo",
        body: "Encontre uma opção compatível com seu objetivo, parcela e duração.",
      },
      {
        title: "Contribua e acompanhe",
        body: "Faça os pagamentos e acompanhe cada ciclo diretamente pela plataforma.",
      },
      {
        title: "Receba e construa histórico",
        body: "Receba conforme a modalidade e transforme comportamento em reputação.",
      },
    ],
    howNote: "As regras de recebimento, garantias e duração variam de acordo com cada grupo.",
    benefitsEyebrow: "Benefícios dos grupos",
    benefitsTitle: "Valor antes, durante e depois do ciclo",
    benefitsBody:
      "Uma estrutura prática para organizar objetivos, acompanhar cada etapa e preservar o valor do seu histórico.",
    benefits: [
      {
        title: "Organize um objetivo maior",
        body: "Transforme uma meta em contribuições menores, previsíveis e recorrentes.",
      },
      {
        title: "Acompanhe regras e movimentações",
        body: "Veja pagamentos, ciclos e eventos com clareza durante toda a jornada.",
      },
      {
        title: "Leve seu histórico com você",
        body: "Seus compromissos fortalecem seu SAS Passport mesmo após o grupo.",
      },
    ],
    compare: "Comparar com modelos tradicionais",
    group: {
      eyebrow: "Exemplo de grupo",
      name: "Sorteio na Hora",
      objective: "Objetivo",
      objectiveValue: "Capital de giro",
      installment: "Parcela",
      installmentValue: "R$ 5,50",
      duration: "Duração",
      durationValue: "6 ciclos",
      prize: "Recebimento",
      prizeValue: "R$ 33,00",
      progress: "Progresso do grupo",
      cycle: "Ciclo 1 de 6",
    },
    passportEyebrow: "SAS Digital Passport",
    passportTitle: "O grupo termina. Seu histórico continua.",
    passportBody:
      "O SAS Passport reúne evidências do seu comportamento financeiro, como pontualidade, ciclos concluídos, atrasos e regularizações.",
    passportPoints: ["Verificável", "Vinculado ao participante", "Evolui com o comportamento"],
    today: "Hoje, o Passport melhora sua experiência e o acesso a grupos dentro da RoundFi.",
    roadmap: "Visão futura: ajudar a comprovar confiança em outros produtos e comunidades.",
    knowPassport: "Conhecer o SAS Passport",
    trusted: "Confiável",
    punctuality: "Pontualidade",
    groups: "Grupos concluídos",
    attestations: "Atestados",
    evolution: "Evolução",
    trustEyebrow: "Confiança",
    trustTitle: "Construído para ser verificado",
    trustBody:
      "Transparência não é uma promessa visual. É a possibilidade de conferir como o protocolo funciona.",
    trustItems: [
      {
        title: "Regras públicas",
        body: "A lógica dos grupos é executada por programas na Solana.",
      },
      {
        title: "Recursos organizados por grupo",
        body: "Cada ciclo segue estruturas próprias de contabilidade e recursos.",
      },
      {
        title: "Desenvolvimento transparente",
        body: "Código, documentação, testes e status podem ser consultados.",
      },
    ],
    seeSecurity: "Ver segurança",
    seeDocs: "Ver documentação",
    seeGithub: "Ver GitHub",
    finalTitle: "Participe do próximo ciclo de validação da RoundFi",
    finalBody:
      "Explore a plataforma em Devnet, utilize fundos fictícios e ajude a validar a experiência antes da mainnet.",
    nextCanary: "Participar do próximo canário",
    noMoney: "Nenhum dinheiro real será movimentado.",
    faqTitle: "Perguntas essenciais",
    faqs: [
      {
        q: "O que é a RoundFi?",
        a: "Uma plataforma experimental de grupos financeiros colaborativos com regras verificáveis e histórico reputacional.",
      },
      {
        q: "Quando o participante recebe?",
        a: "Depende da modalidade e das regras apresentadas antes da entrada em cada grupo.",
      },
      {
        q: "Preciso oferecer alguma garantia?",
        a: "As garantias variam conforme o grupo e são informadas antes da participação.",
      },
      {
        q: "O que significa estar na Devnet?",
        a: "É um ambiente público de testes da Solana. Os fundos usados são fictícios e não têm valor real.",
      },
    ],
    footer: "Infraestrutura experimental para grupos financeiros e reputação verificável.",
    product: "Produto",
    protocol: "Protocolo",
    community: "Comunidade",
    legal: "Legal",
    devnetFooter: "Devnet · somente fundos de teste",
  },
  en: {
    nav: ["How it works", "Benefits", "Passport", "Comparison", "Simulator", "Security", "Docs"],
    devnet: "Test environment — this version only uses fictional funds.",
    environment: "Understand the environment",
    explore: "Explore groups",
    heroEyebrow: "Collaborative financial groups on Solana",
    heroTitle: ["Contribute together.", "Reach your goals.", "Build reputation."],
    heroBody:
      "RoundFi organizes collaborative financial groups where participants contribute in cycles, receive according to group rules and build a verifiable financial history.",
    exploreDevnet: "Explore groups on Devnet",
    understand: "See how it works",
    proofs: ["Verifiable rules", "Open source", "On-chain history"],
    howEyebrow: "How it works",
    howTitle: "A simple cycle with transparent rules",
    howBody:
      "From your first group to a verifiable history, the journey happens in three clear steps.",
    steps: [
      {
        title: "Choose a group",
        body: "Find an option that matches your goal, installment and duration.",
      },
      {
        title: "Contribute and follow",
        body: "Make payments and follow every cycle directly in the platform.",
      },
      {
        title: "Receive and build history",
        body: "Receive by the rules and turn behavior into reputation.",
      },
    ],
    howNote: "Distribution, collateral and duration rules vary according to each group.",
    benefitsEyebrow: "Group benefits",
    benefitsTitle: "Value before, during and after the cycle",
    benefitsBody:
      "A practical structure to organize goals, follow every stage and preserve the value of your history.",
    benefits: [
      {
        title: "Organize a larger goal",
        body: "Turn a goal into smaller, predictable recurring contributions.",
      },
      {
        title: "Follow rules and activity",
        body: "See payments, cycles and events clearly throughout the journey.",
      },
      {
        title: "Take your history with you",
        body: "Your commitments strengthen your SAS Passport after the group.",
      },
    ],
    compare: "Compare with traditional models",
    group: {
      eyebrow: "Group example",
      name: "Instant Draw",
      objective: "Goal",
      objectiveValue: "Working capital",
      installment: "Installment",
      installmentValue: "R$ 5.50",
      duration: "Duration",
      durationValue: "6 cycles",
      prize: "Distribution",
      prizeValue: "R$ 33.00",
      progress: "Group progress",
      cycle: "Cycle 1 of 6",
    },
    passportEyebrow: "SAS Digital Passport",
    passportTitle: "The group ends. Your history continues.",
    passportBody:
      "SAS Passport brings together evidence of your financial behavior, such as punctuality, completed cycles, delays and regularizations.",
    passportPoints: ["Verifiable", "Linked to the participant", "Evolves with behavior"],
    today: "Today, Passport improves your experience and group access within RoundFi.",
    roadmap: "Future vision: help prove trust in other products and communities.",
    knowPassport: "Discover SAS Passport",
    trusted: "Trusted",
    punctuality: "Punctuality",
    groups: "Completed groups",
    attestations: "Attestations",
    evolution: "Evolution",
    trustEyebrow: "Trust",
    trustTitle: "Built to be verified",
    trustBody:
      "Transparency is not a visual promise. It is the ability to inspect how the protocol works.",
    trustItems: [
      {
        title: "Public rules",
        body: "Group logic is executed by programs on Solana.",
      },
      {
        title: "Group-organized resources",
        body: "Each cycle follows its own accounting and resource structures.",
      },
      {
        title: "Transparent development",
        body: "Code, documentation, tests and status can be inspected.",
      },
    ],
    seeSecurity: "View security",
    seeDocs: "View documentation",
    seeGithub: "View GitHub",
    finalTitle: "Join RoundFi’s next validation cycle",
    finalBody:
      "Explore the Devnet platform, use fictional funds and help validate the experience before mainnet.",
    nextCanary: "Join the next canary",
    noMoney: "No real money will be moved.",
    faqTitle: "Essential questions",
    faqs: [
      {
        q: "What is RoundFi?",
        a: "An experimental platform for collaborative financial groups with verifiable rules and reputation history.",
      },
      {
        q: "When does a participant receive?",
        a: "It depends on the modality and rules presented before joining each group.",
      },
      {
        q: "Do I need to provide collateral?",
        a: "Collateral varies by group and is disclosed before participation.",
      },
      {
        q: "What does Devnet mean?",
        a: "It is Solana’s public test environment. The funds used are fictional and have no real value.",
      },
    ],
    footer: "Experimental infrastructure for financial groups and verifiable reputation.",
    product: "Product",
    protocol: "Protocol",
    community: "Community",
    legal: "Legal",
    devnetFooter: "Devnet · test funds only",
  },
} as const;

function ArrowIcon({ size = 18 }: { size?: number }) {
  return <Icons.arrow size={size} stroke="currentColor" sw={1.8} />;
}

function Button({
  href,
  children,
  secondary = false,
  external = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  secondary?: boolean;
  external?: boolean;
  className?: string;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={`group inline-flex min-h-12 items-center justify-center gap-3 rounded-xl px-5 text-sm font-bold transition duration-300 ${
        secondary
          ? "border border-white/12 bg-white/[0.025] text-white hover:border-white/25 hover:bg-white/[0.055]"
          : // `rfi-btn-glow-green` drives the breathing halo (globals.css). It
            // goes on the anchor itself rather than a wrapper element: the
            // header CTA toggles its own visibility with `hidden sm:inline-flex`,
            // so a wrapper would keep painting a haloed empty box on mobile.
            // The static shadow below stays as the reduced-motion fallback —
            // the media query kills the animation and this takes over.
            "rfi-btn-glow-green bg-[#14F195] text-[#02120c] shadow-[0_0_24px_rgba(20,241,149,0.24)] hover:-translate-y-0.5 hover:bg-[#42f6ac]"
      } ${className}`}
    >
      {children}
      <span className="transition-transform duration-300 group-hover:translate-x-1">
        <ArrowIcon size={17} />
      </span>
    </a>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#14F195]/25 bg-[#14F195]/[0.055] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#54f5b5]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#14F195] shadow-[0_0_10px_#14F195]" />
      {children}
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="max-w-2xl font-[var(--font-syne)] text-3xl font-bold leading-[1.08] tracking-[-0.045em] text-white md:text-5xl">
        {title}
      </h2>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-400 md:text-base">{body}</p>
    </div>
  );
}

function IconBadge({ name, tone = "green" }: { name: string; tone?: "green" | "cyan" | "purple" }) {
  const Icon = Icons[name] ?? Icons.spark;
  const colors = {
    green: ["#14F195", "rgba(20,241,149,.09)", "rgba(20,241,149,.24)"],
    cyan: ["#23D9FF", "rgba(35,217,255,.08)", "rgba(35,217,255,.23)"],
    purple: ["#9A68FF", "rgba(154,104,255,.09)", "rgba(154,104,255,.25)"],
  } as const;
  const [color, background, border] = colors[tone];
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
      style={{ color, background, borderColor: border }}
    >
      <Icon size={21} stroke="currentColor" sw={1.65} />
    </span>
  );
}

function HeroOrbit({ lang }: { lang: Language }) {
  const labels =
    lang === "pt"
      ? ["Objetivo", "Grupo", "Ciclos", "Passport"]
      : ["Goal", "Group", "Cycles", "Passport"];
  return (
    <div className="relative mx-auto aspect-[1.08/1] w-full max-w-[580px]">
      <div className="absolute inset-[8%] rounded-full border border-[#23D9FF]/15" />
      <div className="absolute inset-[18%] rounded-full border border-[#8A5CFF]/20" />
      <div className="absolute inset-[29%] rounded-full border border-[#14F195]/25" />
      <div className="absolute inset-[36%] flex items-center justify-center rounded-full border border-[#14F195]/35 bg-[#08141a]/85 shadow-[0_0_70px_rgba(20,241,149,.15)] backdrop-blur-xl">
        <div className="text-center">
          <RFIOfficialLockup size={27} />
          <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-slate-500">flow</p>
        </div>
      </div>
      {[
        ["left-[4%] top-[22%]", "groups", "green"],
        ["right-[1%] top-[27%]", "wallet", "cyan"],
        ["bottom-[8%] right-[13%]", "refresh", "purple"],
        ["bottom-[13%] left-[8%]", "score", "green"],
      ].map(([position, icon, tone], index) => (
        <div
          key={labels[index]}
          className={`absolute ${position} flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#090e17]/80 p-2.5 pr-4 shadow-2xl backdrop-blur-xl`}
        >
          <IconBadge name={icon} tone={tone as "green" | "cyan" | "purple"} />
          <div>
            <p className="text-[9px] uppercase tracking-[0.12em] text-slate-600">0{index + 1}</p>
            <p className="mt-0.5 text-xs font-semibold text-white">{labels[index]}</p>
          </div>
        </div>
      ))}
      <div className="absolute left-[16%] top-[44%] h-px w-[20%] rotate-[18deg] bg-gradient-to-r from-[#14F195]/60 to-transparent" />
      <div className="absolute right-[16%] top-[47%] h-px w-[20%] -rotate-[15deg] bg-gradient-to-l from-[#23D9FF]/60 to-transparent" />
      <div className="absolute bottom-[25%] right-[28%] h-[18%] w-px rotate-[32deg] bg-gradient-to-b from-[#8A5CFF]/60 to-transparent" />
    </div>
  );
}

export default function LandingPage() {
  const [lang, setLang] = useState<Language>("pt");
  const [menuOpen, setMenuOpen] = useState(false);
  const [simGoal, setSimGoal] = useState(20000);
  const [simParticipants, setSimParticipants] = useState(10);
  const [simReceiptCycle, setSimReceiptCycle] = useState(5);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistJoined, setWaitlistJoined] = useState(false);
  const c = copy[lang];

  const navHrefs = [
    "#como-funciona",
    "#beneficios",
    "#passport",
    "#comparativo",
    "#simulador",
    "#seguranca",
    LINKS.docs,
  ];
  const safeReceiptCycle = Math.min(simReceiptCycle, simParticipants);
  const contributionPerCycle = simGoal / simParticipants;
  const contributedAtReceipt = contributionPerCycle * safeReceiptCycle;
  const remainingCycles = simParticipants - safeReceiptCycle;
  const money = useMemo(
    () =>
      new Intl.NumberFormat(lang === "pt" ? "pt-BR" : "en-US", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }),
    [lang],
  );

  function handleWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!waitlistEmail.trim()) return;
    setWaitlistJoined(true);
  }

  return (
    <main className="rfi-landing min-h-screen bg-[#050810] text-slate-100 selection:bg-[#14F195]/25">
      <div aria-hidden className="rfi-page-grid fixed inset-0 pointer-events-none opacity-25" />

      {/* Bloco 1 — Devnet + header */}
      <div className="relative z-50 px-3 pt-3">
        <div className="rfi-chroma-frame mx-auto max-w-7xl rounded-xl">
          <div className="grid min-h-10 grid-cols-1 items-center gap-3 px-4 py-2 text-[10px] sm:grid-cols-[1fr_auto_1fr] md:px-6">
            <div className="hidden sm:block" />
            <div className="flex items-center gap-2 text-slate-400 sm:justify-self-center">
              <Icons.info size={14} stroke="#43eeb5" sw={1.8} />
              <span className="sm:hidden">
                {lang === "pt"
                  ? "Ambiente de teste · fundos fictícios"
                  : "Test environment · fictional funds"}
              </span>
              <span className="hidden sm:inline">{c.devnet}</span>
            </div>
            <div className="hidden items-center justify-self-end gap-4 sm:flex">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#14F195]/25 bg-[#14F195]/[0.06] px-2.5 py-1 font-bold text-[#43eeb5]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#14F195]" />
                Devnet
              </span>
              <a
                href={LINKS.devnet}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#9d7cff] transition hover:text-white"
              >
                {c.environment} ↗
              </a>
            </div>
          </div>
        </div>

        <header className="rfi-chroma-frame mx-auto mt-3 flex min-h-[84px] max-w-7xl items-center justify-between gap-6 rounded-[1.45rem] px-5 md:px-7">
          <a href="#" aria-label="RoundFi — início">
            <RFIOfficialLockup size={39} />
          </a>
          <nav className="hidden items-center gap-4 lg:flex xl:gap-6">
            {c.nav.map((label, index) => (
              <a
                key={label}
                href={navHrefs[index]}
                target={navHrefs[index].startsWith("http") ? "_blank" : undefined}
                rel={navHrefs[index].startsWith("http") ? "noopener noreferrer" : undefined}
                className="relative text-[11px] font-medium text-slate-400 transition after:absolute after:-bottom-2 after:left-0 after:h-px after:w-0 after:bg-gradient-to-r after:from-[#14F195] after:to-[#8A5CFF] after:transition-all hover:text-white hover:after:w-full"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === "pt" ? "en" : "pt")}
              className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-[11px] font-bold text-slate-300 transition hover:border-white/20"
              aria-label="Alternar idioma"
            >
              <span className="text-[#14F195]">{lang.toUpperCase()}</span>
              <span className="text-slate-600"> / {lang === "pt" ? "EN" : "PT"}</span>
            </button>
            <Button href="/grupos" className="hidden min-h-10 px-4 sm:inline-flex">
              {c.explore}
            </Button>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 lg:hidden"
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <Icons.close size={19} stroke="currentColor" />
              ) : (
                <span className="space-y-1">
                  <span className="block h-px w-4 bg-white" />
                  <span className="block h-px w-4 bg-white" />
                  <span className="block h-px w-4 bg-white" />
                </span>
              )}
            </button>
          </div>
        </header>
        {menuOpen && (
          <nav className="rfi-chroma-frame mx-auto mt-2 max-w-7xl rounded-xl px-4 py-4 lg:hidden">
            {c.nav.map((label, index) => (
              <a
                key={label}
                href={navHrefs[index]}
                onClick={() => setMenuOpen(false)}
                className="block border-b border-white/[0.05] py-3 text-sm text-slate-300"
              >
                {label}
              </a>
            ))}
          </nav>
        )}
      </div>

      {/* Bloco 2 — Hero */}
      <section className="relative min-h-[calc(100vh-152px)] overflow-hidden">
        <div aria-hidden className="rfi-space-scene absolute inset-0" />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,8,16,.95)_0%,rgba(3,8,16,.72)_43%,rgba(3,8,16,.08)_76%,transparent_100%)]"
        />
        <div className="relative mx-auto grid min-h-[calc(100vh-152px)] max-w-7xl items-center px-4 py-16 md:px-8 lg:py-12">
          <div className="relative z-10">
            <Eyebrow>{c.heroEyebrow}</Eyebrow>
            <h1 className="max-w-[720px] font-[var(--font-syne)] text-[clamp(2.75rem,5.2vw,5.25rem)] font-bold leading-[.98] tracking-[-0.06em] text-white">
              <span className="block">{c.heroTitle[0]}</span>
              <span className="mt-2 block">{c.heroTitle[1]}</span>
              <span className="rfi-gradient-text rfi-gradient-flow mt-2 block pb-2">
                {c.heroTitle[2]}
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-7 text-slate-400 md:text-base">
              {c.heroBody}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/grupos">{c.exploreDevnet}</Button>
              <Button href="#como-funciona" secondary>
                {c.understand}
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
              {c.proofs.map((proof) => (
                <span
                  key={proof}
                  className="inline-flex items-center gap-2 text-[11px] font-medium text-slate-400"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[#14F195]/20 bg-[#14F195]/[0.06] text-[#14F195]">
                    <Icons.check size={11} stroke="currentColor" sw={2} />
                  </span>
                  {proof}
                </span>
              ))}
            </div>
          </div>
          <div className="absolute right-8 top-1/2 hidden w-[310px] -translate-y-1/2 lg:block">
            <div className="absolute bottom-9 left-7 top-9 w-px bg-gradient-to-b from-[#14F195]/70 via-[#23D9FF]/55 to-[#8A5CFF]/70" />
            {[
              [
                "01",
                lang === "pt" ? "Escolha o grupo" : "Choose the group",
                lang === "pt" ? "Objetivo e regras claras" : "Clear goal and rules",
                "groups",
                "green",
              ],
              [
                "02",
                lang === "pt" ? "Complete os ciclos" : "Complete the cycles",
                lang === "pt" ? "Contribua e acompanhe" : "Contribute and follow",
                "refresh",
                "cyan",
              ],
              [
                "03",
                lang === "pt" ? "Evolua o Passport" : "Evolve your Passport",
                lang === "pt" ? "Histórico que permanece" : "History that remains",
                "score",
                "purple",
              ],
            ].map(([number, title, text, icon, tone], index) => (
              <div
                key={number}
                className="rfi-floating-panel relative mb-4 flex items-center gap-4 rounded-2xl p-3.5"
                style={{ marginLeft: index * 12 }}
              >
                <IconBadge name={icon} tone={tone as "green" | "cyan" | "purple"} />
                <div>
                  <p className="font-[var(--font-jetbrains-mono)] text-[8px] tracking-[0.16em] text-slate-600">
                    {number}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bloco 3 — Como funciona */}
      <section
        id="como-funciona"
        className="rfi-section-luxe relative overflow-hidden border-y border-white/[0.055]"
      >
        <div
          aria-hidden
          className="rfi-section-orbit absolute -right-52 -top-64 h-[680px] w-[680px] rounded-full"
        />
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">
          <SectionHeading eyebrow={c.howEyebrow} title={c.howTitle} body={c.howBody} />
          <div className="relative mt-14 grid gap-4 md:grid-cols-3">
            <div className="absolute left-[16%] right-[16%] top-[31px] hidden h-px bg-gradient-to-r from-[#14F195]/60 via-[#23D9FF]/60 to-[#8A5CFF]/60 md:block" />
            {c.steps.map((step, index) => {
              const StepIcon = [Icons.groups, Icons.wallet, Icons.score][index];
              const accent = ["#14F195", "#23D9FF", "#A77DFF"][index];

              return (
                <article
                  key={step.title}
                  className="rfi-luxe-card group relative flex gap-4 rounded-2xl p-5 md:block md:min-h-[250px] md:p-6"
                >
                  <div
                    className="relative z-10 flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border bg-[#070b13] transition duration-300 group-hover:-translate-y-1 group-hover:scale-[1.03]"
                    style={{
                      color: accent,
                      borderColor: `${accent}66`,
                      background: `radial-gradient(circle at 35% 25%, ${accent}20, transparent 58%), #070b13`,
                      boxShadow: `0 0 30px ${accent}18, inset 0 1px 0 rgba(255,255,255,.05)`,
                    }}
                  >
                    <StepIcon size={29} stroke="currentColor" sw={1.55} />
                    <span
                      className="absolute -bottom-2 -right-2 flex h-7 min-w-7 items-center justify-center rounded-full border bg-[#050810] px-1 font-[var(--font-jetbrains-mono)] text-[9px] font-bold"
                      style={{ borderColor: `${accent}70`, color: accent }}
                    >
                      0{index + 1}
                    </span>
                  </div>
                  <div className="pt-1 md:mt-8 md:pt-0">
                    <h3 className="font-[var(--font-syne)] text-lg font-bold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-xs text-sm leading-6 text-slate-400">{step.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="rfi-info-strip mt-8 flex items-start gap-3 rounded-xl px-4 py-3 text-xs leading-5 text-slate-400">
            <Icons.info size={16} stroke="#23D9FF" />
            {c.howNote}
          </div>
        </div>
      </section>

      {/* Bloco 4 — Benefícios */}
      <section
        id="beneficios"
        className="relative overflow-hidden bg-[radial-gradient(circle_at_0%_50%,rgba(20,241,149,.045),transparent_32%),#050810]"
      >
        <div
          aria-hidden
          className="absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-[#14F195]/[0.045] blur-[100px]"
        />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[1fr_.9fr] lg:items-center">
          <div>
            <SectionHeading
              eyebrow={c.benefitsEyebrow}
              title={c.benefitsTitle}
              body={c.benefitsBody}
            />
            <div className="mt-10 space-y-3">
              {c.benefits.map((benefit, index) => (
                <article
                  key={benefit.title}
                  className="rfi-benefit-row group flex gap-4 rounded-2xl p-4 transition hover:translate-x-1"
                >
                  <IconBadge
                    name={["groups", "eye", "score"][index]}
                    tone={["green", "cyan", "purple"][index] as "green" | "cyan" | "purple"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 font-[var(--font-jetbrains-mono)] text-[8px] tracking-[0.18em] text-slate-600">
                      0{index + 1}
                    </p>
                    <h3 className="text-base font-semibold text-white">{benefit.title}</h3>
                    <p className="mt-1.5 max-w-md text-sm leading-6 text-slate-400">
                      {benefit.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
            <a
              href="/comparativo"
              className="mt-9 inline-flex items-center gap-2 text-xs font-semibold text-[#52ddb9] transition hover:text-white"
            >
              {c.compare} <span>→</span>
            </a>
          </div>

          <div className="relative mx-auto w-full max-w-[510px]">
            <div className="absolute -inset-8 rounded-full bg-[radial-gradient(circle,rgba(35,217,255,.08),transparent_68%)] blur-xl" />
            <div className="rfi-product-card relative overflow-hidden rounded-[1.75rem] p-5 shadow-[0_35px_100px_rgba(0,0,0,.5)] md:p-7">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#14F195] via-[#23D9FF] to-[#8A5CFF]" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#14F195]">
                    {c.group.eyebrow}
                  </p>
                  <h3 className="mt-3 font-[var(--font-syne)] text-2xl font-bold text-white">
                    {c.group.name}
                  </h3>
                </div>
                <IconBadge name="groups" tone="green" />
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3">
                {[
                  [c.group.objective, c.group.objectiveValue],
                  [c.group.installment, c.group.installmentValue],
                  [c.group.duration, c.group.durationValue],
                  [c.group.prize, c.group.prizeValue],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/[0.065] bg-white/[0.025] p-3.5"
                  >
                    <p className="text-[9px] uppercase tracking-[0.12em] text-slate-600">{label}</p>
                    <p className="mt-1.5 text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">{c.group.progress}</span>
                  <span className="font-semibold text-white">{c.group.cycle}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.065]">
                  <div className="h-full w-1/6 rounded-full bg-gradient-to-r from-[#14F195] to-[#23D9FF] shadow-[0_0_14px_rgba(20,241,149,.55)]" />
                </div>
              </div>
              <div className="mt-7 flex items-center justify-between border-t border-white/[0.065] pt-5">
                <div className="flex -space-x-2">
                  {[0, 1, 2, 3, 4, 5].map((item) => (
                    <span
                      key={item}
                      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#090e17] bg-gradient-to-br from-slate-700 to-slate-900 text-[8px] text-slate-300"
                    >
                      {item + 1}
                    </span>
                  ))}
                </div>
                <span className="inline-flex items-center gap-2 text-[10px] font-medium text-[#14F195]">
                  <Icons.shield size={15} stroke="currentColor" /> Regras verificáveis
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bloco 5 — SAS Passport */}
      <section
        id="passport"
        className="rfi-passport-section relative overflow-hidden border-y border-white/[0.055]"
      >
        <div
          aria-hidden
          className="absolute right-[-12rem] top-[-10rem] h-[620px] w-[620px] rounded-full bg-[#8A5CFF]/[0.085] blur-[130px]"
        />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
          <div>
            <SectionHeading
              eyebrow={c.passportEyebrow}
              title={c.passportTitle}
              body={c.passportBody}
            />
            <div className="mt-7 flex flex-wrap gap-2">
              {c.passportPoints.map((point) => (
                <span
                  key={point}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[10px] text-slate-300"
                >
                  <Icons.check size={12} stroke="#14F195" sw={2} />
                  {point}
                </span>
              ))}
            </div>
            <div className="mt-7 space-y-3 text-xs leading-6">
              <p className="border-l-2 border-[#14F195] pl-4 text-slate-300">{c.today}</p>
              <p className="border-l-2 border-[#8A5CFF] pl-4 text-slate-500">
                <span className="font-bold uppercase tracking-wider text-[#aa88ff]">Roadmap</span> ·{" "}
                {c.roadmap}
              </p>
            </div>
            <Button href="/reputacao" secondary className="mt-8">
              {c.knowPassport}
            </Button>
          </div>

          <div className="relative mx-auto w-full max-w-[600px]">
            <div className="absolute -inset-6 rounded-[3rem] bg-[conic-gradient(from_190deg,rgba(20,241,149,.12),rgba(35,217,255,.07),rgba(138,92,255,.17),transparent_70%)] blur-2xl" />
            <div className="rfi-passport-card relative overflow-hidden rounded-[2rem] p-5 shadow-[0_35px_110px_rgba(0,0,0,.55)] md:p-8">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#14F195] via-[#23D9FF] to-[#8A5CFF]" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RFIOfficialMark size={42} />
                  <div>
                    <p className="font-[var(--font-syne)] text-sm font-bold text-white">
                      SAS DIGITAL PASSPORT
                    </p>
                    <p className="mt-1 font-[var(--font-jetbrains-mono)] text-[8px] tracking-[0.16em] text-slate-600">
                      ID · G8ZX...PEZF
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-[#14F195]/25 bg-[#14F195]/[0.07] px-3 py-1.5 text-[9px] font-bold text-[#14F195]">
                  TIER 2
                </span>
              </div>

              <div className="mt-8 grid gap-6 sm:grid-cols-[.8fr_1.2fr]">
                <div className="relative flex min-h-[210px] items-center justify-center rounded-2xl border border-white/[0.07] bg-black/20">
                  <div className="absolute h-40 w-40 rounded-full bg-[conic-gradient(#14F195_0_72%,rgba(255,255,255,.06)_72%_100%)] p-[7px] shadow-[0_0_40px_rgba(20,241,149,.12)]">
                    <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#090d17]">
                      <span className="font-[var(--font-syne)] text-5xl font-bold tracking-[-0.06em] text-white">
                        72
                      </span>
                      <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#14F195]">
                        {c.trusted}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    [c.punctuality, "100%", "check", "green"],
                    [c.groups, "5", "groups", "cyan"],
                    [c.attestations, "8", "shield", "purple"],
                    [c.evolution, "+12", "trend", "green"],
                  ].map(([label, value, icon, tone]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-white/[0.065] bg-white/[0.025] p-3.5"
                    >
                      <IconBadge name={icon} tone={tone as "green" | "cyan" | "purple"} />
                      <p className="mt-4 text-[9px] leading-4 text-slate-500">{label}</p>
                      <p className="mt-1 font-[var(--font-syne)] text-xl font-bold text-white">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
                  Score
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-[#14F195] via-[#23D9FF] to-[#8A5CFF]" />
                </div>
                <span className="font-[var(--font-jetbrains-mono)] text-[9px] text-white">
                  72 / 100
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comparativo */}
      <section id="comparativo" className="rfi-comparison-section relative overflow-hidden">
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-px w-[70%] -translate-x-1/2 bg-gradient-to-r from-transparent via-[#8A5CFF]/45 to-transparent"
        />
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>
              {lang === "pt" ? "Comparativo transparente" : "Transparent comparison"}
            </Eyebrow>
            <h2 className="font-[var(--font-syne)] text-3xl font-bold leading-[1.08] tracking-[-0.045em] text-white md:text-5xl">
              {lang === "pt" ? (
                <>
                  Onde a RoundFi cria uma{" "}
                  <span className="rfi-gradient-text">nova alternativa</span>
                </>
              ) : (
                <>
                  Where RoundFi creates a <span className="rfi-gradient-text">new alternative</span>
                </>
              )}
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-slate-400 md:text-base">
              {lang === "pt"
                ? "Não é uma promessa de superioridade universal. É uma comparação direta entre propostas, estruturas e o valor que permanece com o participante."
                : "This is not a claim of universal superiority. It is a direct comparison of purpose, structure and the value that remains with the participant."}
            </p>
          </div>

          <div className="rfi-comparison-shell mt-12 overflow-x-auto rounded-[1.75rem]">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[1.05fr_1fr_1fr_1.08fr] border-b border-white/[0.07] text-[9px] font-bold uppercase tracking-[0.16em]">
                <div className="p-5 text-slate-500">{lang === "pt" ? "Critério" : "Criteria"}</div>
                <div className="border-l border-white/[0.06] bg-[#ff5a6b]/[0.025] p-5 text-[#ff8894]">
                  {lang === "pt" ? "Consórcio tradicional" : "Traditional consortium"}
                </div>
                <div className="border-l border-white/[0.06] bg-[#23D9FF]/[0.025] p-5 text-[#69dff5]">
                  {lang === "pt" ? "Protocolos financeiros" : "Financial protocols"}
                </div>
                <div className="border-l-2 border-[#14F195] bg-[#14F195]/[0.055] p-5 text-[#14F195]">
                  RoundFi
                </div>
              </div>
              {[
                [
                  lang === "pt" ? "Objetivo principal" : "Primary purpose",
                  lang === "pt"
                    ? "Aquisição planejada por carta"
                    : "Planned acquisition through a credit letter",
                  lang === "pt" ? "Crédito, liquidez ou rendimento" : "Credit, liquidity or yield",
                  lang === "pt"
                    ? "Objetivos colaborativos + reputação"
                    : "Collaborative goals + reputation",
                ],
                [
                  lang === "pt" ? "Organização" : "Organization",
                  lang === "pt" ? "Administradora central" : "Central administrator",
                  lang === "pt" ? "Pools e regras do protocolo" : "Pools and protocol rules",
                  lang === "pt" ? "Grupos com regras verificáveis" : "Groups with verifiable rules",
                ],
                [
                  lang === "pt" ? "Forma de recebimento" : "Distribution",
                  lang === "pt" ? "Sorteio ou lance" : "Draw or bid",
                  lang === "pt"
                    ? "Depende da posição financeira"
                    : "Depends on the financial position",
                  lang === "pt"
                    ? "Modalidade definida antes da entrada"
                    : "Modality disclosed before joining",
                ],
                [
                  lang === "pt" ? "Histórico do participante" : "Participant history",
                  lang === "pt" ? "Permanece na instituição" : "Remains with the institution",
                  lang === "pt"
                    ? "Atividade fragmentada por carteira"
                    : "Wallet activity is fragmented",
                  lang === "pt" ? "SAS Passport evolutivo" : "Evolving SAS Passport",
                ],
                [
                  lang === "pt" ? "Transparência" : "Transparency",
                  lang === "pt"
                    ? "Contrato e extratos do operador"
                    : "Operator contracts and statements",
                  lang === "pt" ? "Transações públicas on-chain" : "Public on-chain transactions",
                  lang === "pt"
                    ? "Pagamentos, ciclos e eventos verificáveis"
                    : "Verifiable payments, cycles and events",
                ],
                [
                  lang === "pt" ? "Custos e condições" : "Costs and terms",
                  lang === "pt" ? "Variam por administradora" : "Vary by administrator",
                  lang === "pt" ? "Variam por protocolo e mercado" : "Vary by protocol and market",
                  lang === "pt"
                    ? "Exibidos por grupo e nível antes da entrada"
                    : "Shown by group and tier before joining",
                ],
              ].map(([criterion, consortium, protocols, roundfi]) => (
                <div
                  key={criterion}
                  className="grid grid-cols-[1.05fr_1fr_1fr_1.08fr] border-b border-white/[0.055] text-xs last:border-b-0"
                >
                  <div className="flex items-center p-5 font-semibold text-slate-300">
                    {criterion}
                  </div>
                  <div className="flex items-center gap-2 border-l border-white/[0.055] bg-[#ff5a6b]/[0.018] p-5 text-slate-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff7180]/70" />
                    {consortium}
                  </div>
                  <div className="flex items-center gap-2 border-l border-white/[0.055] bg-[#23D9FF]/[0.018] p-5 text-slate-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#23D9FF]/70" />
                    {protocols}
                  </div>
                  <div className="flex items-center gap-2 border-l-2 border-[#14F195] bg-[#14F195]/[0.045] p-5 font-semibold text-white">
                    <Icons.check size={14} stroke="#14F195" sw={2} />
                    {roundfi}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-center text-[10px] leading-5 text-slate-600">
            {lang === "pt"
              ? "Comparação conceitual. Taxas, riscos, garantias e condições variam entre produtos e devem ser avaliados antes da participação."
              : "Conceptual comparison. Fees, risks, collateral and terms vary by product and must be assessed before participation."}
          </p>
        </div>
      </section>

      {/* Simulador */}
      <section
        id="simulador"
        className="rfi-simulator-section relative overflow-hidden border-y border-white/[0.055]"
      >
        <div
          aria-hidden
          className="absolute -left-52 top-20 h-[560px] w-[560px] rounded-full bg-[#14F195]/[0.065] blur-[130px]"
        />
        <div
          aria-hidden
          className="absolute -right-52 bottom-0 h-[600px] w-[600px] rounded-full bg-[#8A5CFF]/[0.08] blur-[140px]"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">
          <SectionHeading
            eyebrow={lang === "pt" ? "Simule sua jornada" : "Simulate your journey"}
            title={
              lang === "pt"
                ? "Transforme um objetivo em um ciclo possível"
                : "Turn a goal into a possible cycle"
            }
            body={
              lang === "pt"
                ? "Ajuste o objetivo, o tamanho do grupo e um ciclo ilustrativo de recebimento para entender a dinâmica básica."
                : "Adjust the goal, group size and an illustrative distribution cycle to understand the basic dynamics."
            }
          />

          <div className="mt-12 grid gap-5 lg:grid-cols-[.88fr_1.12fr]">
            <div className="rfi-sim-control rounded-[1.75rem] p-5 md:p-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#14F195]">
                    {lang === "pt" ? "Configuração do cenário" : "Scenario setup"}
                  </p>
                  <h3 className="mt-2 font-[var(--font-syne)] text-xl font-bold text-white">
                    {lang === "pt" ? "Seu grupo ilustrativo" : "Your illustrative group"}
                  </h3>
                </div>
                <IconBadge name="scales" tone="green" />
              </div>

              <label className="mt-8 block">
                <span className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {lang === "pt" ? "Objetivo financeiro" : "Financial goal"}
                  </span>
                  <strong className="font-[var(--font-syne)] text-lg text-white">
                    {money.format(simGoal)}
                  </strong>
                </span>
                <input
                  aria-label={lang === "pt" ? "Objetivo financeiro" : "Financial goal"}
                  className="rfi-range mt-4 w-full"
                  type="range"
                  min="6000"
                  max="100000"
                  step="1000"
                  value={simGoal}
                  onChange={(event) => setSimGoal(Number(event.target.value))}
                />
                <span className="mt-2 flex justify-between text-[9px] text-slate-600">
                  <span>R$ 6 mil</span>
                  <span>R$ 100 mil</span>
                </span>
              </label>

              <label className="mt-7 block border-t border-white/[0.06] pt-6">
                <span className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {lang === "pt" ? "Participantes e ciclos" : "Participants and cycles"}
                  </span>
                  <strong className="text-base text-white">{simParticipants}</strong>
                </span>
                <input
                  aria-label={lang === "pt" ? "Participantes e ciclos" : "Participants and cycles"}
                  className="rfi-range rfi-range-cyan mt-4 w-full"
                  type="range"
                  min="6"
                  max="24"
                  step="1"
                  value={simParticipants}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setSimParticipants(next);
                    setSimReceiptCycle((current) => Math.min(current, next));
                  }}
                />
                <span className="mt-2 flex justify-between text-[9px] text-slate-600">
                  <span>6</span>
                  <span>24</span>
                </span>
              </label>

              <label className="mt-7 block border-t border-white/[0.06] pt-6">
                <span className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {lang === "pt"
                      ? "Ciclo ilustrativo de recebimento"
                      : "Illustrative distribution cycle"}
                  </span>
                  <strong className="text-base text-[#aa82ff]">{safeReceiptCycle}</strong>
                </span>
                <input
                  aria-label={
                    lang === "pt"
                      ? "Ciclo ilustrativo de recebimento"
                      : "Illustrative distribution cycle"
                  }
                  className="rfi-range rfi-range-purple mt-4 w-full"
                  type="range"
                  min="1"
                  max={simParticipants}
                  step="1"
                  value={safeReceiptCycle}
                  onChange={(event) => setSimReceiptCycle(Number(event.target.value))}
                />
              </label>
            </div>

            <div className="rfi-sim-result relative overflow-hidden rounded-[1.75rem] p-5 md:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#23D9FF]">
                    {lang === "pt" ? "Projeção resumida" : "Projection summary"}
                  </p>
                  <p className="mt-3 text-xs text-slate-500">
                    {lang === "pt"
                      ? "Contribuição estimada por ciclo"
                      : "Estimated contribution per cycle"}
                  </p>
                  <p className="rfi-gradient-text mt-1 font-[var(--font-syne)] text-4xl font-bold tracking-[-0.05em] md:text-5xl">
                    {money.format(contributionPerCycle)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#14F195]/20 bg-[#14F195]/[0.06] px-3 py-2 text-[9px] font-bold text-[#14F195]">
                  <Icons.shield size={14} stroke="currentColor" />
                  {lang === "pt" ? "Cenário educativo" : "Educational scenario"}
                </span>
              </div>

              <div className="mt-7 grid grid-cols-2 gap-3">
                {[
                  [
                    lang === "pt" ? "Montante do objetivo" : "Goal amount",
                    money.format(simGoal),
                    "wallet",
                    "green",
                  ],
                  [
                    lang === "pt" ? "Acumulado até o ciclo" : "Accumulated by cycle",
                    money.format(contributedAtReceipt),
                    "chart",
                    "cyan",
                  ],
                  [
                    lang === "pt" ? "Ciclos restantes" : "Remaining cycles",
                    String(remainingCycles),
                    "refresh",
                    "purple",
                  ],
                  [
                    lang === "pt" ? "Histórico gerado" : "History generated",
                    lang === "pt" ? "Passport" : "Passport",
                    "score",
                    "green",
                  ],
                ].map(([label, value, icon, tone]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/[0.065] bg-black/20 p-3.5"
                  >
                    <div className="flex items-center gap-2">
                      <IconBadge name={icon} tone={tone as "green" | "cyan" | "purple"} />
                      <div>
                        <p className="text-[9px] leading-4 text-slate-500">{label}</p>
                        <p className="mt-1 font-[var(--font-syne)] text-base font-bold text-white">
                          {value}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="flex items-center justify-between text-[9px] text-slate-500">
                  <span>{lang === "pt" ? "Início" : "Start"}</span>
                  <span>
                    {lang === "pt"
                      ? `Recebimento ilustrativo · ciclo ${safeReceiptCycle}`
                      : `Illustrative distribution · cycle ${safeReceiptCycle}`}
                  </span>
                  <span>{lang === "pt" ? "Encerramento" : "Completion"}</span>
                </div>
                <svg className="mt-2 h-32 w-full" viewBox="0 0 600 150" aria-hidden>
                  <defs>
                    <linearGradient id="simLine" x1="35" y1="130" x2="565" y2="25">
                      <stop stopColor="#14F195" />
                      <stop offset=".52" stopColor="#23D9FF" />
                      <stop offset="1" stopColor="#8A5CFF" />
                    </linearGradient>
                    <linearGradient id="simArea" x1="0" y1="0" x2="0" y2="1">
                      <stop stopColor="#23D9FF" stopOpacity=".18" />
                      <stop offset="1" stopColor="#23D9FF" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M35 128 C180 110 315 73 565 25 L565 140 L35 140 Z"
                    fill="url(#simArea)"
                  />
                  <path
                    d="M35 128 C180 110 315 73 565 25"
                    fill="none"
                    stroke="url(#simLine)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <line
                    x1={35 + (safeReceiptCycle / simParticipants) * 530}
                    x2={35 + (safeReceiptCycle / simParticipants) * 530}
                    y1="18"
                    y2="140"
                    stroke="#8A5CFF"
                    strokeOpacity=".45"
                    strokeDasharray="4 5"
                  />
                  <circle
                    cx={35 + (safeReceiptCycle / simParticipants) * 530}
                    cy={128 - (safeReceiptCycle / simParticipants) * 103}
                    r="7"
                    fill="#090D17"
                    stroke="#A87CFF"
                    strokeWidth="4"
                  />
                </svg>
              </div>

              <p className="mt-4 flex items-start gap-2 text-[9px] leading-5 text-slate-600">
                <Icons.info size={14} stroke="#23D9FF" />
                {lang === "pt"
                  ? "Simulação educativa. Não inclui taxas, garantias, rendimento ou risco. O recebimento real depende da modalidade e das regras do grupo."
                  : "Educational simulation. It excludes fees, collateral, yield and risk. Actual distribution depends on the group modality and rules."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Confiança + FAQ */}
      <section id="seguranca" className="rfi-trust-section relative overflow-hidden">
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-[#23D9FF]/[0.035] blur-[120px]"
        />
        <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">
          <SectionHeading eyebrow={c.trustEyebrow} title={c.trustTitle} body={c.trustBody} />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {c.trustItems.map((item, index) => (
              <article
                key={item.title}
                className="rfi-trust-card group rounded-2xl p-5 transition hover:-translate-y-1"
              >
                <IconBadge
                  name={["scales", "layers", "cubes"][index]}
                  tone={["green", "cyan", "purple"][index] as "green" | "cyan" | "purple"}
                />
                <h3 className="mt-5 font-[var(--font-syne)] text-base font-bold text-white">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{item.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-5 text-xs font-semibold">
            <a
              className="text-[#52ddb9] hover:text-white"
              href={LINKS.security}
              target="_blank"
              rel="noopener noreferrer"
            >
              {c.seeSecurity} ↗
            </a>
            <a
              className="text-[#52cce5] hover:text-white"
              href={LINKS.docs}
              target="_blank"
              rel="noopener noreferrer"
            >
              {c.seeDocs} ↗
            </a>
            <a
              className="text-[#a98cff] hover:text-white"
              href={LINKS.github}
              target="_blank"
              rel="noopener noreferrer"
            >
              {c.seeGithub} ↗
            </a>
          </div>

          <div className="mx-auto mt-16 max-w-4xl">
            <h3 className="text-center font-[var(--font-syne)] text-xl font-bold text-white">
              {c.faqTitle}
            </h3>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {c.faqs.map((faq) => (
                <details key={faq.q} className="rfi-faq-card group rounded-xl">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-white">
                    {faq.q}
                    <span className="text-lg text-[#14F195] transition group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="border-t border-white/[0.055] px-4 py-4 text-xs leading-6 text-slate-400">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="waitlist"
        className="rfi-prefooter relative overflow-hidden border-t border-white/[0.055]"
      >
        <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-20">
          <div className="rfi-waitlist-card relative overflow-hidden rounded-[2rem] p-6 md:p-10">
            <div
              aria-hidden
              className="absolute inset-x-[8%] -top-20 h-36 bg-gradient-to-r from-[#14F195]/25 via-[#23D9FF]/18 to-[#8A5CFF]/30 blur-[60px]"
            />
            <div className="relative grid items-center gap-8 lg:grid-cols-[.95fr_1.05fr]">
              <div>
                <p className="inline-flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#14F195]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#14F195] shadow-[0_0_10px_#14F195]" />
                  {lang === "pt" ? "Lista de espera ativa" : "Active waitlist"}
                </p>
                <h2 className="mt-4 font-[var(--font-syne)] text-3xl font-bold tracking-[-0.045em] text-white md:text-4xl">
                  {lang === "pt" ? "Seja o primeiro a testar." : "Be among the first to test."}
                </h2>
                <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">
                  {lang === "pt"
                    ? "Entre na lista e acompanhe os próximos ciclos de validação da RoundFi."
                    : "Join the list and follow RoundFi’s next validation cycles."}
                </p>
                <p className="mt-3 inline-flex items-center gap-2 text-[10px] text-slate-600">
                  <Icons.info size={14} stroke="#14F195" />
                  {c.noMoney}
                </p>
              </div>

              {waitlistJoined ? (
                <div className="flex min-h-20 items-center gap-4 rounded-2xl border border-[#14F195]/25 bg-[#14F195]/[0.06] px-5 py-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#14F195]/10 text-[#14F195]">
                    <Icons.check size={20} stroke="currentColor" sw={2} />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-white">
                      {lang === "pt"
                        ? "Interesse registrado no preview"
                        : "Interest saved in the preview"}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {lang === "pt"
                        ? "A integração com a lista oficial será conectada na implementação."
                        : "The official waitlist integration will be connected during implementation."}
                    </p>
                  </div>
                </div>
              ) : (
                <form
                  className="rfi-waitlist-form flex flex-col gap-3 rounded-2xl p-2.5 sm:flex-row"
                  onSubmit={handleWaitlist}
                >
                  <label className="sr-only" htmlFor="waitlist-email">
                    Email
                  </label>
                  <input
                    id="waitlist-email"
                    type="email"
                    required
                    value={waitlistEmail}
                    onChange={(event) => setWaitlistEmail(event.target.value)}
                    placeholder={lang === "pt" ? "seu@email.com" : "you@email.com"}
                    className="min-h-12 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-slate-600"
                  />
                  <button
                    type="submit"
                    className="group inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-[#14F195] px-6 text-sm font-bold text-[#03130D] shadow-[0_0_30px_rgba(20,241,149,.28)] transition hover:bg-[#42f6ac]"
                  >
                    {lang === "pt" ? "Inscrever-se" : "Join waitlist"}
                    <span className="transition group-hover:translate-x-1">→</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="relative overflow-hidden border-t border-white/[0.06] bg-[#03060b]">
        <div
          aria-hidden
          className="absolute left-1/2 top-0 h-px w-[82%] -translate-x-1/2 bg-gradient-to-r from-transparent via-[#23D9FF]/30 to-transparent"
        />
        <div className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-16">
          <div className="grid gap-12 lg:grid-cols-[1.45fr_repeat(4,.72fr)]">
            <div>
              <RFIOfficialLockup size={42} />
              <p className="mt-5 max-w-sm text-xs leading-6 text-slate-500">{c.footer}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                {["SOLANA", "SAS", "KAMINO", "SEC3"].map((partner, index) => (
                  <span
                    key={partner}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/[0.065] bg-white/[0.02] px-3 py-2 font-[var(--font-jetbrains-mono)] text-[8px] tracking-[0.12em] text-slate-500"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        background: ["#14F195", "#23D9FF", "#8A5CFF", "#14F195"][index],
                      }}
                    />
                    {partner}
                  </span>
                ))}
              </div>
            </div>
            {[
              [
                c.product,
                [
                  ["Grupos", "/grupos"],
                  ["Passport", "/reputacao"],
                  [lang === "pt" ? "Simulador" : "Simulator", "#simulador"],
                ],
              ],
              [
                c.protocol,
                [
                  [lang === "pt" ? "Segurança" : "Security", LINKS.security],
                  ["Docs", LINKS.docs],
                  ["Devnet", LINKS.devnet],
                ],
              ],
              [
                c.community,
                [
                  ["GitHub", LINKS.github],
                  ["X / Twitter", "https://x.com/roundfinancesol"],
                  ["Superteam", "https://superteam.fun/"],
                ],
              ],
              [
                c.legal,
                [
                  ["Status", LINKS.devnet],
                  [lang === "pt" ? "Riscos" : "Risks", LINKS.security],
                  [lang === "pt" ? "Código aberto" : "Open source", LINKS.github],
                ],
              ],
            ].map(([title, items]) => (
              <div key={title as string}>
                <p className="text-xs font-bold text-white">{title as string}</p>
                <ul className="mt-5 space-y-3.5">
                  {(items as string[][]).map(([label, href]) => (
                    <li key={label}>
                      <a
                        href={href}
                        className="text-xs text-slate-500 transition hover:text-[#72e6c3]"
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-white/[0.05]">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 text-[9px] uppercase tracking-[0.12em] text-slate-700 sm:flex-row md:px-8">
            <span>© 2026 RoundFi Protocol</span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#14F195] shadow-[0_0_9px_#14F195]" />
              {c.devnetFooter}
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
