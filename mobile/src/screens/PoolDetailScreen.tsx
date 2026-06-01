// PoolDetailScreen — Fase 2 (detail). Read-only deep-dive on one pool:
// full terms, lifecycle progress, vault balances, and the member
// roster. Re-fetches by address (param) so pull-to-refresh and
// deep-links work without carrying non-serializable state through
// navigation. No wallet, no signing — same IDL-free RPC path as the
// list.
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { RawMemberView, RawPoolView } from "@roundfi/sdk/onchain-raw";

import type { PoolsStackParamList } from "../navigation/PoolsStack";
import {
  fetchMembers,
  fetchPool,
  formatBps,
  formatDuration,
  formatTimestamp,
  formatUsdc,
  reputationLabel,
  statusLabel,
} from "../lib/chain";
import { useTheme } from "../theme/ThemeProvider";
import type { ThemeTokens } from "../theme/tokens";

type Props = NativeStackScreenProps<PoolsStackParamList, "PoolDetail">;

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "missing" }
  | { phase: "ready"; pool: RawPoolView; members: RawMemberView[] };

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

export function PoolDetailScreen({ route }: Props) {
  const { address } = route.params;
  const { tokens } = useTheme();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!isRefresh) setState({ phase: "loading" });
      try {
        const [pool, members] = await Promise.all([fetchPool(address), fetchMembers(address)]);
        if (!pool) {
          setState({ phase: "missing" });
          return;
        }
        setState({ phase: "ready", pool, members });
      } catch (err) {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [address],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load(true);
  }, [load]);

  if (state.phase === "loading") {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: tokens.bg }]}>
        <ActivityIndicator color={tokens.green} />
        <Text style={[styles.dim, { color: tokens.text2 }]}>Reading pool…</Text>
      </View>
    );
  }

  if (state.phase === "error") {
    return (
      <View style={[styles.fill, { backgroundColor: tokens.bg, padding: 20 }]}>
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
      </View>
    );
  }

  if (state.phase === "missing") {
    return (
      <View style={[styles.fill, { backgroundColor: tokens.bg, padding: 20 }]}>
        <View
          style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}
        >
          <Text style={[styles.cardLabel, { color: tokens.muted }]}>not found</Text>
          <Text style={[styles.body, { color: tokens.text2 }]}>
            No pool account at this address on devnet.
          </Text>
        </View>
      </View>
    );
  }

  const { pool, members } = state;

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: tokens.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.green} />
      }
    >
      {/* Identity + status */}
      <View style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}>
        <View style={styles.headRow}>
          <Text style={[styles.cardLabel, { color: tokens.muted }]}>pool address</Text>
          <View style={styles.statusWrap}>
            <View style={[styles.dot, { backgroundColor: statusColor(tokens, pool.status) }]} />
            <Text style={[styles.status, { color: tokens.text2 }]}>{statusLabel(pool.status)}</Text>
          </View>
        </View>
        <Text style={[styles.mono, { color: tokens.green }]} selectable>
          {pool.address.toBase58()}
        </Text>
      </View>

      <Section title="Terms" tokens={tokens}>
        <KV tokens={tokens} k="Credit" v={`${formatUsdc(pool.creditAmount)} USDC`} />
        <KV tokens={tokens} k="Installment" v={`${formatUsdc(pool.installmentAmount)} USDC`} />
        <KV tokens={tokens} k="Cycle length" v={formatDuration(pool.cycleDurationSec)} />
        <KV tokens={tokens} k="Seed draw" v={formatBps(pool.seedDrawBps)} />
        <KV tokens={tokens} k="Solidarity" v={formatBps(pool.solidarityBps)} />
        <KV tokens={tokens} k="Escrow release" v={formatBps(pool.escrowReleaseBps)} />
      </Section>

      <Section title="Progress" tokens={tokens}>
        <KV tokens={tokens} k="Members" v={`${pool.membersJoined}/${pool.membersTarget}`} />
        <KV tokens={tokens} k="Cycle" v={`${pool.currentCycle}/${pool.cyclesTotal}`} />
        <KV tokens={tokens} k="Defaulted" v={`${pool.defaultedMembers}`} />
        <KV tokens={tokens} k="Started" v={formatTimestamp(pool.startedAt)} />
        <KV tokens={tokens} k="Next cycle" v={formatTimestamp(pool.nextCycleAt)} />
      </Section>

      <Section title="Vault balances" tokens={tokens}>
        <KV tokens={tokens} k="Contributed" v={`${formatUsdc(pool.totalContributed)} USDC`} />
        <KV tokens={tokens} k="Paid out" v={`${formatUsdc(pool.totalPaidOut)} USDC`} />
        <KV tokens={tokens} k="Solidarity" v={`${formatUsdc(pool.solidarityBalance)} USDC`} />
        <KV tokens={tokens} k="Escrow" v={`${formatUsdc(pool.escrowBalance)} USDC`} />
        <KV tokens={tokens} k="Yield accrued" v={`${formatUsdc(pool.yieldAccrued)} USDC`} />
        <KV
          tokens={tokens}
          k="Guarantee fund"
          v={`${formatUsdc(pool.guaranteeFundBalance)} USDC`}
        />
      </Section>

      <Text style={[styles.sectionTitle, { color: tokens.text }]}>Members ({members.length})</Text>
      {members.length === 0 ? (
        <View
          style={[styles.card, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}
        >
          <Text style={[styles.body, { color: tokens.text2 }]}>No members joined yet.</Text>
        </View>
      ) : (
        members.map((m) => <MemberRow key={m.address.toBase58()} member={m} tokens={tokens} />)
      )}
    </ScrollView>
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

function MemberRow({ member, tokens }: { member: RawMemberView; tokens: ThemeTokens }) {
  const w = member.wallet.toBase58();
  const short = `${w.slice(0, 4)}…${w.slice(-4)}`;
  const badge = member.defaulted
    ? { label: "Defaulted", color: tokens.red }
    : member.paidOut
      ? { label: "Paid out", color: tokens.teal }
      : { label: "Active", color: tokens.green };
  return (
    <View
      style={[styles.memberRow, { backgroundColor: tokens.surface1, borderColor: tokens.border }]}
    >
      <View style={styles.headRow}>
        <Text style={[styles.mono, { color: tokens.text }]}>
          #{member.slotIndex} · {short}
        </Text>
        <View style={styles.statusWrap}>
          <View style={[styles.dot, { backgroundColor: badge.color }]} />
          <Text style={[styles.status, { color: tokens.text2 }]}>{badge.label}</Text>
        </View>
      </View>
      <View style={styles.kvGrid}>
        <KV tokens={tokens} k="Level" v={reputationLabel(member.reputationLevel)} />
        <KV tokens={tokens} k="Paid" v={`${member.contributionsPaid}`} />
        <KV tokens={tokens} k="On-time" v={`${member.onTimeCount}`} />
        <KV tokens={tokens} k="Late" v={`${member.lateCount}`} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  dim: {
    fontSize: 13,
  },
  scroll: {
    padding: 20,
    gap: 16,
    paddingBottom: 32,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
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
  headRow: {
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
  memberRow: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
});
