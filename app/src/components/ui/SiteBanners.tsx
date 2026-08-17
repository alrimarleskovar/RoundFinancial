"use client";

import { usePathname } from "next/navigation";

import { NetworkBanner } from "@/components/ui/NetworkBanner";
import { PhishingBanner } from "@/components/ui/PhishingBanner";

// Top-of-page chrome, in the order it stacks: phishing warning first
// (it's the louder of the two), then the cluster identity strip.
//
// Routes listed here render WITHOUT the cluster strip. The public landing
// is a marketing page — it never connects a wallet and never builds a
// transaction, so the devnet/mainnet identity the strip carries has
// nothing to qualify there; it only costs the hero its first screenful.
//
// This is NOT a general opt-out, and it must not grow into one. SEV-045
// made the strip unconditional precisely because the threat model is "the
// user believes they're on devnet but the RPC is mainnet" — so every route
// that can sign anything keeps it, including /grupos, one click away
// behind the landing's own CTA.
//
// The phishing banner is deliberately NOT route-gated: a typo-squat domain
// lies about *where you are*, which a landing page does as readily as a
// dashboard — and on a canonical domain it renders nothing anyway.
const ROUTES_WITHOUT_CLUSTER_STRIP = new Set(["/landing-v2"]);

export function SiteBanners() {
  const pathname = usePathname();
  return (
    <>
      <PhishingBanner />
      {!ROUTES_WITHOUT_CLUSTER_STRIP.has(pathname) && <NetworkBanner />}
    </>
  );
}
