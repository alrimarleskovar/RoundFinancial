// HomeScreen — Fase 2 overview. Bento-style dashboard mirroring the
// desktop /home shape (but compact for mobile):
//
//   Hero (RoundFi · devnet)
//   ─────────────────────────────────────────
//   4 KPI cards (2x2): Pools · Members · Contributed · Default rate
//   ─────────────────────────────────────────
//   "On-chain · devnet" pool rail (horizontal scroll)
//
// The palette toggle moved to the navigation header (PaletteToggle in
// RootNavigator's headerRight) so it's reachable from every tab — the
// Hero no longer carries its own pill.
//
// Reads `listPools()` once on mount + aggregates client-side via
// aggregateProtocol(). Pull-to-refresh re-fetches. Loading and error
// states inline so the bento collapses gracefully.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { RawPoolView } from "@roundfi/sdk/onchain-raw";

import {
  aggregateProtocol,
  formatUsdc,
  formatUsdcCompact,
  listPools,
  statusLabel,
  type ProtocolSnapshot,
} from "../lib/chain";
import { useTheme } from "../theme/ThemeProvider";
import { FONT, type ThemeTokens } from "../theme/tokens";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; snap: ProtocolSnapshot };

export function HomeScreen() {
  const { tokens } = useTheme();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh: boolean) => {
    if (!isRefresh) setState({ phase: "loading" });
    try {
      const pools = await listPools();
      setState({ phase: "ready", snap: aggregateProtocol(pools) });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
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
    <ScrollView
      style={[styles.fill, { backgroundColor: tokens.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.green} />
      }
    >
      <Hero tokens={tokens} />

      {state.phase === "loading" && (
        <View style={[styles.center, { paddingVertical: 60 }]}>
          <ActivityIndicator color={tokens.green} />
          <Text style={[styles.dim, { color: tokens.text2, marginTop: 10 }]}>
            Reading on-chain…
          </Text>
        </View>
      )}

      {state.phase === "error" && (
        <View
          style={[styles.errorCard, { backgroundColor: tokens.surface1, borderColor: tokens.red }]}
        >
          <Text style={[styles.label, { color: tokens.red }]}>RPC error</Text>
          <Text style={[styles.body, { color: tokens.text2 }]}>{state.message}</Text>
        </View>
      )}

      {state.phase === "ready" && (
        <>
          <KpiGrid tokens={tokens} snap={state.snap} />
          <DevnetRail tokens={tokens} pools={state.snap.pools} />
        </>
      )}
    </ScrollView>
  );
}

// ── Hero ───────────────────────────────────────────────────────────

function Hero({ tokens }: { tokens: ThemeTokens }) {
  return (
    <View style={styles.hero}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.heroBadge, { color: tokens.green }]}>RoundFi · devnet</Text>
        <Text style={[styles.heroTitle, { color: tokens.text }]}>Protocol overview</Text>
        <Text style={[styles.heroSub, { color: tokens.text2 }]}>
          Live on-chain state · pull to refresh
        </Text>
      </View>
    </View>
  );
}

// ── KPI grid (2x2 bento) ───────────────────────────────────────────

function KpiGrid({ tokens, snap }: { tokens: ThemeTokens; snap: ProtocolSnapshot }) {
  const defaultRatePct =
    snap.defaultRate === null ? "—" : `${(snap.defaultRate * 100).toFixed(1)}%`;

  return (
    <View style={styles.kpiGrid}>
      <Kpi
        tokens={tokens}
        label="Pools"
        value={`${snap.totalPools}`}
        sub={`${snap.active} active · ${snap.completed} done`}
        tone={tokens.green}
      />
      <Kpi
        tokens={tokens}
        label="Members"
        value={`${snap.totalMembers}`}
        sub={`${snap.totalDefaults} defaulted`}
        tone={tokens.teal}
      />
      <Kpi
        tokens={tokens}
        label="Contributed"
        value={`${formatUsdcCompact(snap.totalContributed)}`}
        sub={`${formatUsdcCompact(snap.totalPaidOut)} paid out`}
        tone={tokens.purple}
      />
      <Kpi
        tokens={tokens}
        label="Default rate"
        value={defaultRatePct}
        sub={
          snap.totalMembers === 0 ? "no members yet" : `${snap.totalDefaults}/${snap.totalMembers}`
        }
        tone={snap.defaultRate && snap.defaultRate > 0.1 ? tokens.red : tokens.amber}
      />
    </View>
  );
}

function Kpi({
  tokens,
  label,
  value,
  sub,
  tone,
}: {
  tokens: ThemeTokens;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <View style={[styles.kpi, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}>
      <Text style={[styles.kpiLabel, { color: tokens.muted }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color: tone }]}>{value}</Text>
      <Text style={[styles.kpiSub, { color: tokens.text2 }]}>{sub}</Text>
    </View>
  );
}

// ── Devnet rail (horizontal scroll) ────────────────────────────────

function DevnetRail({ tokens, pools }: { tokens: ThemeTokens; pools: RawPoolView[] }) {
  if (pools.length === 0) {
    return (
      <View>
        <Text style={[styles.sectionLabel, { color: tokens.green }]}>ON-CHAIN · DEVNET</Text>
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: tokens.surface1, borderColor: tokens.border },
          ]}
        >
          <Text style={[styles.body, { color: tokens.text2 }]}>
            No pools deployed to devnet yet.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: tokens.green }]}>ON-CHAIN · DEVNET</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
      >
        {pools.map((p) => (
          <PoolMiniCard key={p.address.toBase58()} pool={p} tokens={tokens} />
        ))}
      </ScrollView>
    </View>
  );
}

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

function PoolMiniCard({ pool, tokens }: { pool: RawPoolView; tokens: ThemeTokens }) {
  const addr = pool.address.toBase58();
  const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  return (
    <View
      style={[styles.miniCard, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}
    >
      <View style={styles.miniHead}>
        <View style={[styles.dot, { backgroundColor: statusColor(tokens, pool.status) }]} />
        <Text style={[styles.miniStatus, { color: tokens.text2 }]}>{statusLabel(pool.status)}</Text>
      </View>
      <Text style={[styles.miniAddr, { color: tokens.text }]}>{short}</Text>
      <View style={styles.miniRow}>
        <Text style={[styles.miniLabel, { color: tokens.muted }]}>credit</Text>
        <Text style={[styles.miniValue, { color: tokens.text }]}>
          {formatUsdc(pool.creditAmount)} USDC
        </Text>
      </View>
      <View style={styles.miniRow}>
        <Text style={[styles.miniLabel, { color: tokens.muted }]}>members</Text>
        <Text style={[styles.miniValue, { color: tokens.text }]}>
          {pool.membersJoined}/{pool.membersTarget}
        </Text>
      </View>
      <View style={styles.miniRow}>
        <Text style={[styles.miniLabel, { color: tokens.muted }]}>cycle</Text>
        <Text style={[styles.miniValue, { color: tokens.text }]}>
          {pool.currentCycle}/{pool.cyclesTotal}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scroll: {
    padding: 20,
    paddingBottom: 32,
    gap: 24,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  dim: {
    fontSize: 13,
    fontFamily: FONT.mono,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  label: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: FONT.mono,
  },
  errorCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },

  // Hero
  hero: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 16,
  },
  heroBadge: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: FONT.mono,
  },
  heroTitle: {
    fontSize: 32,
    fontFamily: FONT.display,
    letterSpacing: -1,
    marginTop: 4,
  },
  heroSub: {
    fontSize: 13,
    fontFamily: FONT.mono,
    marginTop: 4,
  },

  // KPI grid
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  kpi: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  kpiLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: FONT.mono,
  },
  kpiValue: {
    fontSize: 28,
    fontFamily: FONT.display,
    letterSpacing: -0.8,
    lineHeight: 32,
  },
  kpiSub: {
    fontSize: 12,
    fontFamily: FONT.mono,
  },

  // Devnet rail
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontFamily: FONT.mono,
    marginBottom: 12,
  },
  railContent: {
    gap: 12,
    paddingRight: 4,
  },
  miniCard: {
    width: 200,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  miniHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  miniStatus: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: FONT.mono,
  },
  miniAddr: {
    fontSize: 16,
    fontFamily: FONT.monoBold,
  },
  miniRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  miniLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: FONT.mono,
  },
  miniValue: {
    fontSize: 13,
    fontFamily: FONT.monoBold,
  },
  emptyCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
});
