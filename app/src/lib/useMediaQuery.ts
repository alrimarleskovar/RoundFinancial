"use client";

import { useEffect, useState } from "react";

// SSR-safe media-query hook. Returns `false` on the server and on
// the first client render, then flips to the actual `matchMedia`
// value once the component mounts.

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Modern browsers
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
