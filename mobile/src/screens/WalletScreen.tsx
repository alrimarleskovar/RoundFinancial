// WalletScreen — Fase 2 (Wallet). Read-only: paste/type any wallet
// address (base58) → fetch SOL balance via getBalance + USDC balance
// on its devnet-USDC ATA via getTokenAccountBalance. No signing, no
// wallet-connect — that belongs to Fase 3.
//
// Shared wallet (Fase 2 polish): a successful lookup also writes the
// address to WalletContext so Profile inherits it cross-tab and
// AsyncStorage persists it across cold-opens. On mount we auto-fetch
// when the context already carries an address — saves the user from
// re-pasting their wallet each time they re-enter the app or the tab.
//
// A missing ATA returns 0n — the canonical "wallet hasn't been funded
// yet" semantics from the web app, not an error.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  DEVNET_USDC_MINT,
  fetchSolBalance,
  fetchUsdcBalance,
  formatSol,
  formatUsdc,
  parseAddress,
} from "../lib/chain";
import { useWallet } from "../state/WalletContext";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, type ThemeTokens } from "../theme/tokens";

type LoadState =
  | { phase: "idle" }
  | { phase: "loading"; address: string }
  | { phase: "error"; message: string }
  | { phase: "ready"; address: string; sol: bigint; usdc: bigint };

export function WalletScreen() {
  const { tokens } = useTheme();
  const { currentAddress, hydrated, setCurrentAddress, clear: clearWallet } = useWallet();
  const [input, setInput] = useState("");
  const [state, setState] = useState<LoadState>({ phase: "idle" });

  // Internal lookup that doesn't depend on the `input` state (so the
  // hydration effect can run before the user has typed anything).
  const lookupAddress = useCallback(async (address: string) => {
    setState({ phase: "loading", address });
    try {
      const [sol, usdc] = await Promise.all([fetchSolBalance(address), fetchUsdcBalance(address)]);
      setState({ phase: "ready", address, sol, usdc });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Hydrate from shared wallet context: when the persisted/sibling-set
  // address differs from what we're showing, prefill the input and
  // auto-fetch. Guards against re-running for an address we're already
  // displaying — switching tabs back and forth shouldn't trigger
  // duplicate RPC calls.
  useEffect(() => {
    if (!hydrated || !currentAddress) return;
    if (state.phase === "ready" && state.address === currentAddress) return;
    if (state.phase === "loading" && state.address === currentAddress) return;
    setInput(currentAddress);
    void lookupAddress(currentAddress);
  }, [hydrated, currentAddress, state, lookupAddress]);

  const onLookup = useCallback(async () => {
    const pk = parseAddress(input);
    if (!pk) {
      setState({ phase: "error", message: "Not a valid base58 address." });
      return;
    }
    const address = pk.toBase58();
    await lookupAddress(address);
    // Promote to shared state on a successful resolve. We do this even
    // on RPC failure (state.phase === "error" happens above) because
    // the address itself is valid — Profile may still want to read it.
    setCurrentAddress(address);
  }, [input, lookupAddress, setCurrentAddress]);

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: tokens.bg }]}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.label, { color: tokens.muted }]}>RoundFi mobile · Wallet</Text>
      <Text style={[styles.title, { color: tokens.text }]}>Devnet balances</Text>

      <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}>
        <Text style={[styles.cardLabel, { color: tokens.muted }]}>wallet address</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Paste any devnet wallet…"
          placeholderTextColor={tokens.muted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[
            styles.input,
            { color: tokens.text, borderColor: tokens.borderStr, backgroundColor: tokens.bg },
          ]}
        />
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onLookup}
            disabled={state.phase === "loading"}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: tokens.green, borderColor: tokens.borderStr },
              pressed && { opacity: 0.85 },
              state.phase === "loading" && { opacity: 0.5 },
            ]}
          >
            <Text style={[styles.primaryLabel, { color: tokens.bg }]}>
              {state.phase === "loading" ? "Looking up…" : "Lookup"}
            </Text>
          </Pressable>
          {input.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setInput("");
                setState({ phase: "idle" });
                // Also drop the shared/persisted wallet — Clear should
                // mean "stop following this address everywhere", not
                // just "blank this textbox".
                clearWallet();
              }}
              style={[
                styles.ghost,
                { borderColor: tokens.borderStr, backgroundColor: tokens.surface2 },
              ]}
            >
              <Text style={[styles.ghostLabel, { color: tokens.text }]}>Clear</Text>
            </Pressable>
          )}
        </View>
      </View>

      {state.phase === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.green} />
          <Text style={[styles.dim, { color: tokens.text2 }]}>Reading balances…</Text>
        </View>
      )}

      {state.phase === "error" && (
        <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.red }]}>
          <Text style={[styles.cardLabel, { color: tokens.red }]}>error</Text>
          <Text style={[styles.body, { color: tokens.text2 }]}>{state.message}</Text>
        </View>
      )}

      {state.phase === "ready" && <Balances state={state} tokens={tokens} />}
    </ScrollView>
  );
}

function Balances({
  state,
  tokens,
}: {
  state: Extract<LoadState, { phase: "ready" }>;
  tokens: ThemeTokens;
}) {
  return (
    <View style={styles.balances}>
      <BalanceCard
        tokens={tokens}
        label="SOL"
        amount={formatSol(state.sol)}
        sub={`${state.sol.toString()} lamports`}
        accent={tokens.purple}
      />
      <BalanceCard
        tokens={tokens}
        label="USDC (devnet)"
        amount={formatUsdc(state.usdc)}
        sub={`mint ${shortAddr(DEVNET_USDC_MINT.toBase58())}`}
        accent={tokens.green}
      />
      <View
        style={[styles.metaCard, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}
      >
        <Text style={[styles.cardLabel, { color: tokens.muted }]}>wallet</Text>
        <Text style={[styles.mono, { color: tokens.text }]} selectable>
          {state.address}
        </Text>
      </View>
    </View>
  );
}

function BalanceCard({
  tokens,
  label,
  amount,
  sub,
  accent,
}: {
  tokens: ThemeTokens;
  label: string;
  amount: string;
  sub: string;
  accent: string;
}) {
  return (
    <View
      style={[styles.bigCard, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}
    >
      <Text style={[styles.cardLabel, { color: tokens.muted }]}>{label}</Text>
      <Text style={[styles.bigAmount, { color: accent }]}>{amount}</Text>
      <Text style={[styles.sub, { color: tokens.text2 }]}>{sub}</Text>
    </View>
  );
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scroll: {
    padding: 20,
    gap: 16,
    paddingBottom: 32,
  },
  label: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: FONT.mono,
  },
  title: {
    fontSize: 24,
    fontFamily: FONT.displayHeavy,
    letterSpacing: -0.5,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  cardLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: FONT.mono,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FONT.mono,
    fontSize: 13,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  primary: {
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  primaryLabel: {
    fontSize: 14,
    fontFamily: FONT.displayHeavy,
  },
  ghost: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
  },
  ghostLabel: {
    fontSize: 14,
    fontFamily: FONT.mono,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  dim: {
    fontSize: 13,
    fontFamily: FONT.mono,
  },
  balances: {
    gap: 16,
  },
  bigCard: {
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  bigAmount: {
    fontSize: 40,
    fontFamily: FONT.display,
    letterSpacing: -1,
  },
  sub: {
    fontSize: 12,
    fontFamily: FONT.mono,
  },
  metaCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
  },
  mono: {
    fontFamily: FONT.monoBold,
    fontSize: 13,
  },
});
