"use client";

import { useSpring, useMotionValueEvent } from "framer-motion";
import { useEffect, useState } from "react";

// Animated counter — interpolates between value changes via a
// framer-motion spring and re-formats on every tick. Drop-in
// replacement for raw {fmtMoney(value)} renders so currency /
// language flips also play the count-up animation.
//
//   <CountUp value={USER.balance} format={fmtMoney} />
//
// `value` is the underlying number (always BRL when used with
// fmtMoney since fmtMoney does the BRL->USDC conversion itself
// based on context).

export function CountUp({
  value,
  format = (n: number) => n.toLocaleString(),
  damping = 22,
  stiffness = 90,
  mass = 0.5,
}: {
  value: number;
  format?: (n: number) => string;
  damping?: number;
  stiffness?: number;
  mass?: number;
}) {
  const spring = useSpring(value, { damping, stiffness, mass, restDelta: 0.01 });
  const [current, setCurrent] = useState(value);

  useMotionValueEvent(spring, "change", (latest) => setCurrent(latest));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <span>{format(current)}</span>;
}
