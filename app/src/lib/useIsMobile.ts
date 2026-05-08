"use client";

import { useEffect, useState } from "react";

// SSR-safe matchMedia hook. Returns true when viewport width is below
// `breakpoint` (default 768px = Tailwind's `md` breakpoint). Safe on
// the server: starts as `false`, then hydrates to the real value
// after mount via window.matchMedia. Components that use this for
// layout should fall back to the desktop layout during SSR — that's
// the expected pattern for inline-styled dashboards that need
// responsive behavior without going full Tailwind.
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [breakpoint]);

  return isMobile;
}
