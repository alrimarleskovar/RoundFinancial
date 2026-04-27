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
    const isConnected = wallet.status === "connected";
    if (wasConnected.current && !isConnected) {
      router.push(target);
    }
    wasConnected.current = isConnected;
  }, [wallet.status, router, target]);
}
