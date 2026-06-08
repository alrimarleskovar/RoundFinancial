// Shared wallet context — Fase 2 polish.
//
// Why this exists: the Wallet and Profile tabs both ask "which wallet
// are we looking at?" and used to keep that state isolated, so the user
// had to paste/lookup twice for the same wallet. This context promotes
// the address to app-level state — set it on Wallet, the Profile tab
// already knows; vice-versa.
//
// Persistence: the current address is mirrored to AsyncStorage so a
// cold-open of the app restores the last-used wallet. We expose
// `hydrated` so screens can avoid flashing an empty state during the
// async read on mount.
//
// What it deliberately does NOT do:
//   - No fetched balance / profile cache. Each screen re-fetches on
//     mount / refresh. The address is the shared key; the readings are
//     ephemeral.
//   - No multi-wallet list. Single "current" slot. A wallet picker
//     belongs to Fase 3 (wallet-connect).
//   - No secret material. ONLY the public base58 address is stored. No
//     keys, no signatures.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "@roundfi/mobile/wallet-address";

export interface WalletContextValue {
  /** Active wallet base58 address, or null when no wallet is set. */
  currentAddress: string | null;
  /** True once the initial AsyncStorage read has resolved. */
  hydrated: boolean;
  /** Set the active wallet. Persists to AsyncStorage in the background. */
  setCurrentAddress: (addr: string) => void;
  /** Clear the active wallet AND erase the persisted value. */
  clear: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [currentAddress, setCurrent] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Cold-open: read the persisted address once. Tolerate read errors
  // silently — a missing/corrupt value just means "no wallet yet",
  // which is the default state anyway.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (active && stored) setCurrent(stored);
      })
      .catch(() => {
        // ignore — first-launch / corrupted storage = no wallet
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setCurrentAddress = useCallback((addr: string) => {
    setCurrent(addr);
    // Fire-and-forget. A write failure means "next cold-open won't
    // restore" — not worth surfacing to the user mid-session.
    AsyncStorage.setItem(STORAGE_KEY, addr).catch(() => {});
  }, []);

  const clear = useCallback(() => {
    setCurrent(null);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ currentAddress, hydrated, setCurrentAddress, clear }),
    [currentAddress, hydrated, setCurrentAddress, clear],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const v = useContext(WalletContext);
  if (!v) throw new Error("useWallet() must be used within <WalletProvider>");
  return v;
}
