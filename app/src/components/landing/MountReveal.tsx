"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

import { useMotion } from "@/lib/motion";

// Mount-time analog of <Reveal>. Animates children in once when
// they enter the React tree — no scroll/IntersectionObserver. Used
// for content that is already visible on first paint (above-the-fold
// hero blocks, dashboard headers, etc.).
//
// Falls back to plain children when the user has reduced motion
// or has flipped the MotionProvider to "off".

export function MountReveal({
  children,
  delay = 0,
  y = 16,
  duration = 0.55,
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  duration?: number;
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
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: [0.4, 0, 0.2, 1], delay }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
