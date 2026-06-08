// ProfileScreen — Fase 2 (Profile). Read-only on-chain reputation
// profile lookup: paste a wallet → derive the reputation PDA → decode
// the account if it exists. Missing profile is NOT an error: the
// program treats it as a fresh wallet (level 1, score 0), and we
// render that default so the user sees the same number the on-chain
// path would resolve. No signing, no attestations posted from here —
// that's admin-only and out of mobile's scope entirely.
//
// Shared wallet (Fase 2 polish): mirrors WalletScreen — the same
// address typed/looked-up here is promoted to WalletContext (persisted
// + cross-tab), and on mount we auto-fetch when the context already
// carries an address.
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

import type { RawReputationProfile } from "@roundfi/sdk/onchain-raw";

import { fetchReputation, formatTimestamp, parseAddress, reputationLabel } from "../lib/chain";
import { useWallet } from "../state/WalletContext";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemeTokens } from "../theme/tokens";

type LoadState =
  | { phase: "idle" }
  | { phase: "loading"; wallet: string }
  | { phase: "error"; message: string }
  | { phase: "ready"; wallet: string; profile: RawReputationProfile | null };

export function ProfileScreen() {
  const { tokens } = useTheme();
  const { currentAddress, hydrated, setCurrentAddress, clear: clearWallet } = useWallet();
  const [input, setInput] = useState("");
  const [state, setState] = useState<LoadState>({ phase: "idle" });

  const lookupAddress = useCallback(async (wallet: string) => {
    setState({ phase: "loading", wallet });
    try {
      const profile = await fetchReputation(wallet);
      setState({ phase: "ready", wallet, profile });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  // Hydrate from shared wallet context — see WalletScreen for the
  // same pattern + rationale.
  useEffect(() => {
    if (!hydrated || !currentAddress) return;
    if (state.phase === "ready" && state.wallet === currentAddress) return;
    if (state.phase === "loading" && state.wallet === currentAddress) return;
    setInput(currentAddress);
    void lookupAddress(currentAddress);
  }, [hydrated, currentAddress, state, lookupAddress]);

  const onLookup = useCallback(async () => {
    const pk = parseAddress(input);
    if (!pk) {
      setState({ phase: "error", message: "Not a valid base58 address." });
      return;
    }
    const wallet = pk.toBase58();
    await lookupAddress(wallet);
    setCurrentAddress(wallet);
  }, [input, lookupAddress, setCurrentAddress]);

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: tokens.bg }]}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.label, { color: tokens.muted }]}>RoundFi mobile · Profile</Text>
      <Text style={[styles.title, { color: tokens.text }]}>On-chain reputation</Text>

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
          <Text style={[styles.dim, { color: tokens.text2 }]}>Reading profile…</Text>
        </View>
      )}

      {state.phase === "error" && (
        <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.red }]}>
          <Text style={[styles.cardLabel, { color: tokens.red }]}>error</Text>
          <Text style={[styles.body, { color: tokens.text2 }]}>{state.message}</Text>
        </View>
      )}

      {state.phase === "ready" && <ProfileCards state={state} tokens={tokens} />}
    </ScrollView>
  );
}

function ProfileCards({
  state,
  tokens,
}: {
  state: Extract<LoadState, { phase: "ready" }>;
  tokens: ThemeTokens;
}) {
  // Missing account = canonical "fresh wallet" semantics: the on-chain
  // program defaults level=1/score=0 for an absent profile.
  const isFresh = state.profile === null;
  const p = state.profile;

  return (
    <View style={styles.stack}>
      <View
        style={[
          styles.headerCard,
          { backgroundColor: tokens.surface1, borderColor: tokens.border },
        ]}
      >
        <Text style={[styles.cardLabel, { color: tokens.muted }]}>
          {isFresh ? "fresh wallet (no profile account)" : "reputation profile"}
        </Text>
        <View style={styles.levelRow}>
          <Text style={[styles.bigAmount, { color: tokens.green }]}>
            {reputationLabel(p?.level ?? 1)}
          </Text>
          <Text style={[styles.score, { color: tokens.text2 }]}>
            score {(p?.score ?? 0n).toString()}
          </Text>
        </View>
        <Text style={[styles.mono, { color: tokens.text2 }]} selectable>
          {state.wallet}
        </Text>
      </View>

      <Section title="Lifecycle" tokens={tokens}>
        <KV tokens={tokens} k="Cycles completed" v={`${p?.cyclesCompleted ?? 0}`} />
        <KV tokens={tokens} k="Pools participated" v={`${p?.totalParticipated ?? 0}`} />
        <KV tokens={tokens} k="First seen" v={isFresh ? "—" : formatTimestamp(p!.firstSeenAt)} />
        <KV
          tokens={tokens}
          k="Last updated"
          v={isFresh ? "—" : formatTimestamp(p!.lastUpdatedAt)}
        />
      </Section>

      <Section title="Behavior" tokens={tokens}>
        <KV tokens={tokens} k="On-time" v={`${p?.onTimePayments ?? 0}`} />
        <KV tokens={tokens} k="Late" v={`${p?.latePayments ?? 0}`} />
        <KV tokens={tokens} k="Defaults" v={`${p?.defaults ?? 0}`} />
      </Section>
    </View>
  );
}

function Section({
  title,
  tokens,
  children,
}: {
  title: string;
  tokens: ThemeTokens;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={[styles.sectionTitle, { color: tokens.text }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}>
        <View style={styles.kvGrid}>{children}</View>
      </View>
    </View>
  );
}

function KV({ tokens, k, v }: { tokens: ThemeTokens; k: string; v: string }) {
  return (
    <View style={styles.kv}>
      <Text style={[styles.kvKey, { color: tokens.muted }]}>{k}</Text>
      <Text style={[styles.kvVal, { color: tokens.text }]}>{v}</Text>
    </View>
  );
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
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
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
    fontFamily: "Menlo",
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
    fontWeight: "600",
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
    fontWeight: "500",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  dim: {
    fontSize: 13,
  },
  stack: {
    gap: 16,
  },
  headerCard: {
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  levelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 14,
  },
  bigAmount: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  score: {
    fontSize: 14,
  },
  mono: {
    fontFamily: "Menlo",
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  kvGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 12,
  },
  kv: {
    width: "50%",
    gap: 2,
  },
  kvKey: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  kvVal: {
    fontSize: 15,
    fontWeight: "600",
  },
});
