"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useMotion, type MotionMode } from "@/lib/motion";

// Animates children in/out when the route changes. Three modes:
//   - off   — no animation (instant swap)
//   - fade  — opacity 0 -> 1 over 220ms (subtle)
//   - slide — opacity + 16px horizontal slide over 260ms (more "dApp")
//
// Mode is driven by useMotion() (Tweaks panel toggle).

const VARIANTS: Record<
  MotionMode,
  {
    initial: Record<string, number>;
    animate: Record<string, number>;
    exit: Record<string, number>;
    transition: { duration: number; ease: [number, number, number, number] };
  }
> = {
  off: {
    initial: { opacity: 1 },
    animate: { opacity: 1 },
    exit: { opacity: 1 },
    transition: { duration: 0, ease: [0, 0, 1, 1] },
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
  },
  slide: {
    initial: { opacity: 0, x: 16 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -16 },
    transition: { duration: 0.26, ease: [0.4, 0, 0.2, 1] },
  },
};

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { mode } = useMotion();
  const v = VARIANTS[mode];

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={v.initial}
        animate={v.animate}
        exit={v.exit}
        transition={v.transition}
        style={{ minHeight: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
