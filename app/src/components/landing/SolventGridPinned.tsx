"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useRef, type ComponentType } from "react";

import { Icons, type IconProps } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useMotion } from "@/lib/motion";

// Layer-B scrollytelling for the "Solvente por Construção" section.
//
// Desktop: the section grows to ~260vh, an inner sticky pane locks
// to the viewport for ~160vh of scroll, and the 6 cards reveal in
// a staggered choreography driven by scrollYProgress (Framer Motion
// useScroll/useTransform).
//
// Mobile / reduced-motion: skips the scroll choreography entirely
// and renders a normal grid where each card uses CSS opacity 1 from
// the start. Sticky/tall-section is gated behind `md:` breakpoints
// so layout doesn't get weird on narrow viewports.

type CardConfig = {
  key: string;
  Icon: ComponentType<IconProps>;
  color: string;
};

const CARDS: readonly CardConfig[] = [
  { key: "semente",  Icon: Icons.lock,   color: "#14F195" },
  { key: "escrow",   Icon: Icons.scales, color: "#4A9EFF" },
  { key: "valve",    Icon: Icons.ticket, color: "#FFD23F" },
  { key: "slashing", Icon: Icons.bolt,   color: "#FF4D4F" },
  { key: "triplo",   Icon: Icons.shield, color: "#9945FF" },
  { key: "silos",    Icon: Icons.cubes,  color: "#E0E0E0" },
] as const;

export function SolventGridPinned() {
  const { mode } = useMotion();
  const reducedMotion = useReducedMotion();
  const skipScroll = mode === "off" || reducedMotion;
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  if (skipScroll) {
    return <SolventGridStatic />;
  }

  return (
    <section
      ref={ref}
      id="security"
      className="relative w-full md:h-[260vh] border-t border-white/[0.06] z-10"
    >
      <div className="md:sticky md:top-0 md:h-screen flex flex-col items-center justify-center px-4 md:px-6 max-w-6xl mx-auto py-20 md:py-0">
        <PinnedHeader scrollYProgress={scrollYProgress} />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {CARDS.map((c, i) => (
            <PinnedCard
              key={c.key}
              card={c}
              index={i}
              scrollYProgress={scrollYProgress}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// Title block animates a touch as the cards take over: opacity stays
// near 1, but it shifts up + scales down slightly so it visually
// "settles" into place when the grid is fully revealed.
function PinnedHeader({
  scrollYProgress,
}: {
  scrollYProgress: MotionValue<number>;
}) {
  const t = useT();
  const y = useTransform(scrollYProgress, [0, 0.6], [0, -16]);
  const scale = useTransform(scrollYProgress, [0, 0.6], [1, 0.96]);
  return (
    <motion.div
      style={{ y, scale }}
      className="text-center mb-12 md:mb-16 will-change-transform"
    >
      <h2 className="text-3xl md:text-5xl font-black mb-4 tracking-tight">
        {t("landing.security.title1")}{" "}
        <span className="text-[#14F195]">{t("landing.security.title2")}</span>
      </h2>
      <p className="text-gray-400 max-w-2xl mx-auto text-base">
        {t("landing.security.body")}
      </p>
    </motion.div>
  );
}

// Each card has its own scroll window. Six cards spread their
// reveal across 0.10 → 0.62 of scroll progress (window width 0.18,
// stride 0.085) so they cascade in but the last one finishes well
// before the pin releases — gives the user breathing room before
// the next section.
function PinnedCard({
  card,
  index,
  scrollYProgress,
}: {
  card: CardConfig;
  index: number;
  scrollYProgress: MotionValue<number>;
}) {
  const t = useT();
  const start = 0.1 + index * 0.085;
  const end = start + 0.18;
  const opacity = useTransform(scrollYProgress, [start, end], [0, 1]);
  const y = useTransform(scrollYProgress, [start, end], [40, 0]);
  const scale = useTransform(scrollYProgress, [start, end], [0.92, 1]);
  return (
    <motion.div
      style={{
        opacity,
        y,
        scale,
        background: `linear-gradient(180deg, ${card.color}0D 0%, rgba(255,255,255,0.02) 60%)`,
        border: `1px solid ${card.color}40`,
        boxShadow: `inset 0 1px 0 ${card.color}1A, 0 0 0 1px ${card.color}10`,
      }}
      className="p-8 rounded-[2rem] will-change-transform"
    >
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center mb-6"
        style={{
          background: `${card.color}1F`,
          border: `1px solid ${card.color}55`,
          color: card.color,
          boxShadow: `0 0 28px ${card.color}33`,
        }}
      >
        <card.Icon size={26} stroke={card.color} sw={1.8} />
      </div>
      <h3 className="text-xl font-bold mb-2">
        {t(`landing.security.card.${card.key}.title`)}
      </h3>
      <p className="text-gray-400 text-sm">
        {t(`landing.security.card.${card.key}.desc`)}
      </p>
    </motion.div>
  );
}

// Fallback for reduced-motion / motion-off: identical to the
// previous static grid (PR #76 + #77 styling), no scroll coupling.
function SolventGridStatic() {
  const t = useT();
  return (
    <section
      id="security"
      className="w-full mx-auto px-4 md:px-6 py-20 md:py-24 max-w-6xl border-t border-white/[0.06] z-10"
    >
      <div className="text-center mb-16">
        <h2 className="text-3xl md:text-5xl font-black mb-4 tracking-tight">
          {t("landing.security.title1")}{" "}
          <span className="text-[#14F195]">{t("landing.security.title2")}</span>
        </h2>
        <p className="text-gray-400 max-w-2xl mx-auto text-base">
          {t("landing.security.body")}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {CARDS.map((c) => (
          <div
            key={c.key}
            className="p-8 rounded-[2rem]"
            style={{
              background: `linear-gradient(180deg, ${c.color}0D 0%, rgba(255,255,255,0.02) 60%)`,
              border: `1px solid ${c.color}40`,
              boxShadow: `inset 0 1px 0 ${c.color}1A, 0 0 0 1px ${c.color}10`,
            }}
          >
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center mb-6"
              style={{
                background: `${c.color}1F`,
                border: `1px solid ${c.color}55`,
                color: c.color,
                boxShadow: `0 0 28px ${c.color}33`,
              }}
            >
              <c.Icon size={26} stroke={c.color} sw={1.8} />
            </div>
            <h3 className="text-xl font-bold mb-2">
              {t(`landing.security.card.${c.key}.title`)}
            </h3>
            <p className="text-gray-400 text-sm">
              {t(`landing.security.card.${c.key}.desc`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
