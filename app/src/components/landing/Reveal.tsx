"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

import { useMotion } from "@/lib/motion";

// Lightweight scroll-reveal wrapper for the landing page.
//
// Each <Reveal> fades + slides its children up by `y` pixels every
// time the element crosses into the viewport — and reverses (fades
// + slides back down) when it leaves. So scrolling back up replays
// the reveal in reverse, creating a "breathing" scrollytelling
// feel. Driven by Framer Motion's `whileInView` (GPU-friendly).
//
// Falls back to no-op (immediate render) when:
//   - the user's MotionProvider mode is "off"
//   - prefers-reduced-motion is set at OS level
//
// `delay` enables stagger when wrapping cards in a grid: pass
// `0`, `0.08`, `0.16`... to ripple them in sequence.
// `once` (default false) makes the reveal one-shot if you want a
// section that doesn't replay on scroll-up.

export function Reveal({
  children,
  delay = 0,
  y = 24,
  once = false,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  once?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { mode } = useMotion();
  const reducedMotion = useReducedMotion();
  const skip = mode === "off" || reducedMotion;

  if (skip) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount: 0.15 }}
      transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1], delay }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
