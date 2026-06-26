"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { useWallet } from "@/lib/wallet";

// Watches the wallet status and pushes the user to `target` when
// they transition from connected -> disconnected (i.e. they clicked
// Disconnect on the wallet chip dropdown). Initial mount with no
// wallet does NOT trigger — the dashboard stays accessible for
// preview / direct URL navigation when offline.

export function useRedirectOnDisconnect(target: string = "/") {
  const wallet = useWallet();
  const router = useRouter();
  const wasConnected = useRef(false);

  useEffect(() => {
    // A1-F7: redirect only on an explicit, clean disconnect — NOT on a
    // transient "error" status (set whenever `lastError` is present while
    // disconnected, e.g. a re-auth that throws after a prior connect). Gating
    // on `!isConnected` would eject the user from a protected route on any
    // connect error; match "disconnected" exactly.
    if (wasConnected.current && wallet.status === "disconnected") {
      router.push(target);
    }
    wasConnected.current = wallet.status === "connected";
  }, [wallet.status, router, target]);
}
