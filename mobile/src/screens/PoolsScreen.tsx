// PoolsScreen — Fase 2's first live on-chain read.
//
// Lists every Pool account on devnet via `getProgramAccounts` + the
// SDK's IDL-free decoder (see ../lib/chain.ts). Read-only: no wallet,
// no signing — just renders protocol state. Proves the full chain
// (RPC → Buffer polyfill → raw decoder → palette-aware list) works
// on-device, building on Home's PDA-derivation proof.

import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { RawPoolView } from "@roundfi/sdk/onchain-raw";

import type { PoolsStackParamList } from "../navigation/PoolsStack";
import { formatUsdc, listPools, statusLabel } from "../lib/chain";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemeTokens } from "../theme/tokens";

type PoolsNav = NativeStackNavigationProp<PoolsStackParamList, "PoolsList">;

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; pools: RawPoolView[] };

// Map a pool status to an accent token so the dot reads at a glance.
function statusColor(tokens: ThemeTokens, status: RawPoolView["status"]): string {
  switch (status) {
    case "active":
      return tokens.green;
    case "forming":
      return tokens.amber;
    case "completed":
      return tokens.teal;
    case "liquidated":
    case "closed":
      return tokens.red;
    default:
      return tokens.muted;
  }
}

export function PoolsScreen() {
  const { tokens } = useTheme();
  const navigation = useNavigation<PoolsNav>();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  // Client-side filter — match by base58 substring (case-insensitive
  // since base58 is mixed-case but human searches usually aren't) OR
  // by exact seedId string. Devnet has <20 pools today, so filtering
  // in-memory beats refetching with server-side memcmp.
  const filtered = useMemo(() => {
    if (state.phase !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.pools;
    return state.pools.filter((p) => {
      const addr = p.address.toBase58().toLowerCase();
      if (addr.includes(q)) return true;
      if (p.seedId.toString() === q) return true;
      return false;
    });
  }, [state, query]);

  const load = useCallback(async (isRefresh: boolean) => {
    if (!isRefresh) setState({ phase: "loading" });
    try {
      const pools = await listPools();
      setState({ phase: "ready", pools });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  return (
    <View style={[styles.container, { backgroundColor: tokens.bg }]}>
      <Text style={[styles.label, { color: tokens.muted }]}>RoundFi mobile · Pools</Text>
      <Text style={[styles.title, { color: tokens.text }]}>Devnet pools</Text>

      {state.phase === "loading" && (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.green} />
          <Text style={[styles.dim, { color: tokens.text2 }]}>Reading on-chain…</Text>
        </View>
      )}

      {state.phase === "error" && (
        <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.red }]}>
          <Text style={[styles.cardLabel, { color: tokens.red }]}>RPC error</Text>
          <Text style={[styles.body, { color: tokens.text2 }]}>{state.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load(false)}
            style={[
              styles.retry,
              { backgroundColor: tokens.surface2, borderColor: tokens.borderStr },
            ]}
          >
            <Text style={[styles.retryLabel, { color: tokens.text }]}>Retry</Text>
          </Pressable>
        </View>
      )}

      {state.phase === "ready" && (
        <>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Filter by address or seedId…"
              placeholderTextColor={tokens.muted}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={[
                styles.search,
                {
                  color: tokens.text,
                  borderColor: tokens.borderStr,
                  backgroundColor: tokens.surface1,
                },
              ]}
            />
            <Text style={[styles.count, { color: tokens.text2 }]}>
              {query.trim() ? `${filtered.length}/${state.pools.length}` : `${state.pools.length}`}
            </Text>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(p) => p.address.toBase58()}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={tokens.green}
              />
            }
            ListEmptyComponent={
              <View
                style={[
                  styles.card,
                  { backgroundColor: tokens.surface1, borderColor: tokens.border },
                ]}
              >
                <Text style={[styles.cardLabel, { color: tokens.muted }]}>
                  {query.trim() ? "no match" : "empty"}
                </Text>
                <Text style={[styles.body, { color: tokens.text2 }]}>
                  {query.trim()
                    ? "No pools match this filter. Clear the search to see all."
                    : "No pools on devnet yet. Pull to refresh."}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <PoolRow
                pool={item}
                tokens={tokens}
                onPress={() =>
                  navigation.navigate("PoolDetail", { address: item.address.toBase58() })
                }
              />
            )}
          />
        </>
      )}
    </View>
  );
}

function PoolRow({
  pool,
  tokens,
  onPress,
}: {
  pool: RawPoolView;
  tokens: ThemeTokens;
  onPress: () => void;
}) {
  const addr = pool.address.toBase58();
  const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: tokens.surface1, borderColor: tokens.border },
        pressed && { borderColor: tokens.borderStr, opacity: 0.85 },
      ]}
    >
      <View style={styles.rowHead}>
        <Text style={[styles.mono, { color: tokens.text }]}>{short}</Text>
        <View style={styles.statusWrap}>
          <View style={[styles.dot, { backgroundColor: statusColor(tokens, pool.status) }]} />
          <Text style={[styles.status, { color: tokens.text2 }]}>{statusLabel(pool.status)}</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <Metric tokens={tokens} k="Credit" v={`${formatUsdc(pool.creditAmount)} USDC`} />
        <Metric tokens={tokens} k="Installment" v={`${formatUsdc(pool.installmentAmount)} USDC`} />
        <Metric tokens={tokens} k="Members" v={`${pool.membersJoined}/${pool.membersTarget}`} />
        <Metric tokens={tokens} k="Cycle" v={`${pool.currentCycle}/${pool.cyclesTotal}`} />
      </View>
    </Pressable>
  );
}

function Metric({ tokens, k, v }: { tokens: ThemeTokens; k: string; v: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricKey, { color: tokens.muted }]}>{k}</Text>
      <Text style={[styles.metricVal, { color: tokens.text }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 14,
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  dim: {
    fontSize: 13,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: "Menlo",
    fontSize: 13,
  },
  count: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    minWidth: 36,
    textAlign: "right",
  },
  listContent: {
    gap: 12,
    paddingBottom: 24,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
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
  retry: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  row: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 14,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mono: {
    fontFamily: "Menlo",
    fontSize: 14,
  },
  statusWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  status: {
    fontSize: 12,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 12,
  },
  metric: {
    width: "50%",
    gap: 2,
  },
  metricKey: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  metricVal: {
    fontSize: 15,
    fontWeight: "600",
  },
});
