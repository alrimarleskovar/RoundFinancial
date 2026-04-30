"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

import { useMotion } from "@/lib/motion";

// Lightweight scroll-reveal wrapper for the landing page.
//
// Each <Reveal> fades + slides its children up by `y` pixels when
// the element first crosses into the viewport. Driven by Framer
// Motion's `whileInView` so it stays GPU-friendly.
//
// Falls back to no-op (immediate render) when:
//   - the user's MotionProvider mode is "off"
//   - prefers-reduced-motion is set at OS level
//
// `delay` enables stagger when wrapping cards in a grid: pass
// `0`, `0.08`, `0.16`... to ripple them in sequence.

export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
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
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1], delay }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
