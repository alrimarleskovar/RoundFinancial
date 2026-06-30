"use client";

import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import {
  ConnectionCard,
  type ConnMeta,
  type ConnSpec,
  type PassportRealHandlers,
} from "@/components/carteira/ConnectionCard";
import { type GlyphKind } from "@/components/carteira/ConnectionGlyph";
import { EmailAlertsCard } from "@/components/carteira/EmailAlertsCard";
import { useConnections, type ConnId, type ConnRuntime } from "@/lib/connections";
import { useI18n, useT } from "@/lib/i18n";
import { sendUnlinkPassport, sendVerifyPassport } from "@/lib/link-passport";
import { useNetwork } from "@/lib/network";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { useIdentity } from "@/lib/useIdentity";
import { useIsMobile } from "@/lib/useIsMobile";
import { shortAddr, useWallet } from "@/lib/wallet";

// Conexões tab content. Composes the connection cards — the connected wallet
// (real; reflects whichever adapter is connected: Phantom/Solflare/Backpack/…)
// + the real Human Passport + Kamino/Pix mocks — with the security explainer +
// roadmap panel on the side. Port of WalletConnections from
// prototype/components/desktop-more.jsx.

/** Map the connected wallet's adapter name to a brand glyph; falls back to the
 *  generic phantom glyph for wallets without a dedicated icon (Backpack, Glow…). */
function glyphForWallet(label: string | null): GlyphKind {
  switch (label?.toLowerCase()) {
    case "solflare":
      return "solflare";
    case "phantom":
      return "phantom";
    default:
      return "phantom";
  }
}

export function WalletConnections() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { lang, fmtMoney } = useI18n();
  const wallet = useWallet();
  const isMobile = useIsMobile();
  const conns = useConnections();
  const [expanded, setExpanded] = useState<string | null>("phantom");

  const solFmt = (n: number) =>
    `${n.toLocaleString(lang === "pt" ? "pt-BR" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })} SOL`;
  const phantomAddrShort = wallet.publicKey ? shortAddr(wallet.publicKey, 6, 6) : "—";
  const phantomBalance = wallet.balanceSol != null ? solFmt(wallet.balanceSol) : "—";

  // ─── Human Passport: REAL on-chain identity (devnet) ───────────────────
  const identity = useIdentity();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const network = useNetwork();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // The real flow runs on devnet/localnet — the program's devnet-identity-shim
  // is compiled out of mainnet, so on mainnet-beta keep the legacy static card.
  const passportRealMode = network.id !== "mainnet-beta";

  const fmtDate = useCallback(
    (unixSec: number) =>
      new Date(unixSec * 1000).toLocaleDateString(lang === "pt" ? "pt-BR" : "en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    [lang],
  );

  const doVerifyPassport = useCallback(async () => {
    setVerifyError(null);
    if (!adapter.publicKey || !adapter.sendTransaction) {
      setVerifyError("conn.passport.errConnect");
      return;
    }
    setVerifying(true);
    try {
      await sendVerifyPassport({
        connection,
        sendTransaction: adapter.sendTransaction,
        wallet: adapter.publicKey,
      });
      await identity.refresh();
    } catch {
      setVerifyError("conn.passport.errGeneric");
    } finally {
      setVerifying(false);
    }
  }, [adapter.publicKey, adapter.sendTransaction, connection, identity]);

  const doUnlinkPassport = useCallback(async () => {
    setVerifyError(null);
    if (!adapter.publicKey || !adapter.sendTransaction) {
      setVerifyError("conn.passport.errConnect");
      return;
    }
    setVerifying(true);
    try {
      await sendUnlinkPassport({
        connection,
        sendTransaction: adapter.sendTransaction,
        wallet: adapter.publicKey,
      });
      await identity.refresh();
    } catch {
      setVerifyError("conn.passport.errUnlink");
    } finally {
      setVerifying(false);
    }
  }, [adapter.publicKey, adapter.sendTransaction, connection, identity]);

  const passportVerified = passportRealMode && identity.verified;
  const passportRuntime: ConnRuntime = passportRealMode
    ? {
        status: passportVerified ? "connected" : "disconnected",
        since: passportVerified && identity.verifiedAt ? fmtDate(identity.verifiedAt) : undefined,
      }
    : conns.state.passport;
  const shortGw = identity.gatewayToken
    ? `${identity.gatewayToken.slice(0, 4)}…${identity.gatewayToken.slice(-4)}`
    : "—";
  const passportMeta: ConnMeta[] = passportVerified
    ? [
        {
          l: t("conn.passport.attestation"),
          v: shortGw,
          mono: true,
          link: identity.gatewayToken
            ? `https://solscan.io/account/${identity.gatewayToken}?cluster=devnet`
            : null,
        },
        { l: t("conn.passport.tier"), v: t("conn.passport.tierReal") },
        {
          l: t("conn.passport.exp"),
          v: identity.expiresAt ? fmtDate(identity.expiresAt) : t("conn.passport.never"),
        },
      ]
    : [
        { l: t("conn.passport.status"), v: t("conn.passport.notVerified") },
        { l: t("conn.phantom.net"), v: t("conn.phantom.devnet") },
      ];
  const passportReal: PassportRealHandlers = {
    busy: verifying,
    error: verifyError ? t(verifyError) : null,
    onVerify: () => void doVerifyPassport(),
    onUnlink: () => void doUnlinkPassport(),
    ctaLabel: t("conn.passport.verifyCta"),
    busyLabel: t("conn.passport.verifying"),
    verifiedNote: t("conn.passport.verifiedNote"),
    unlinkLabel: t("conn.passport.unlinkCta"),
    unlinkingLabel: t("conn.passport.unlinking"),
  };

  const spec: ConnSpec[] = useMemo(
    () => [
      {
        id: "phantom",
        name: wallet.walletLabel ?? t("conn.wallet.name"),
        tone: "p",
        tagline: t("conn.phantom.tag"),
        live: true,
        featured: true,
        glyph: glyphForWallet(wallet.walletLabel),
        meta: [
          {
            l: t("conn.phantom.addr"),
            v: phantomAddrShort,
            mono: true,
            link: wallet.publicKey ? wallet.explorerAddr(wallet.publicKey) : null,
          },
          {
            l: t("conn.phantom.net"),
            v:
              wallet.network === "mainnet-beta"
                ? t("conn.phantom.mainnet")
                : t("conn.phantom.devnet"),
          },
          { l: t("conn.phantom.balance"), v: phantomBalance, mono: true },
        ],
        perms: [t("conn.phantom.p1"), t("conn.phantom.p2"), t("conn.phantom.p3")],
      },
      {
        id: "passport",
        name: "Human Passport",
        tone: "g",
        tagline: t("conn.passport.tag"),
        glyph: "passport",
        meta: [
          { l: t("conn.passport.passId"), v: "passport:hpx:7xG3…k9Fn", mono: true },
          { l: t("conn.passport.tier"), v: t("conn.passport.tierV") },
          { l: t("conn.passport.exp"), v: "14 Mar 2027" },
        ],
        perms: [t("conn.passport.p1"), t("conn.passport.p2")],
      },
      {
        id: "kamino",
        name: "Kamino Finance",
        tone: "t",
        tagline: t("conn.kamino.tag"),
        glyph: "kamino",
        meta: [
          { l: t("conn.kamino.vault"), v: "roundfi/escrow-usdc-v2", mono: true },
          { l: t("conn.kamino.alloc"), v: fmtMoney(2360) },
          {
            l: t("conn.kamino.yield"),
            v: `${fmtMoney(312.08)} (+6,8% APY)`,
          },
        ],
        perms: [t("conn.kamino.p1"), t("conn.kamino.p2"), t("conn.kamino.p3")],
      },
      {
        id: "pix",
        name: "Pix · BRL on-ramp",
        tone: "a",
        tagline: t("conn.pix.tag"),
        glyph: "pix",
        meta: [
          { l: t("conn.pix.provider"), v: t("conn.pix.notSet") },
          { l: t("conn.pix.req"), v: t("conn.pix.reqV") },
        ],
        perms: [
          t("conn.pix.p1", { c1: "BRL", c2: "USDC" }),
          t("conn.pix.p2", { c1: "BRL", c2: "USDC" }),
        ],
      },
    ],
    [t, fmtMoney, phantomAddrShort, phantomBalance, wallet],
  );

  // Connected count: Phantom + passport (real on devnet) are live, the other
  // mocks come from ConnectionsProvider.
  const connectedCount =
    (wallet.status === "connected" ? 1 : 0) +
    (Object.keys(conns.state) as ConnId[]).filter((k) =>
      k === "passport" && passportRealMode
        ? passportVerified
        : conns.state[k].status === "connected",
    ).length;

  return (
    <div
      style={{
        marginTop: 20,
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <MonoLabel color={tokens.green}>{t("conn.badge")}</MonoLabel>
          <span
            style={{
              fontSize: 11,
              color: tokens.muted,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("conn.count", { c: connectedCount, t: spec.length })}
          </span>
        </div>

        {spec.map((c) => {
          const isPassportReal = c.id === "passport" && passportRealMode;
          // In real mode the passport card reads/writes real on-chain state
          // (like Phantom), so mark it `live` — drop the "DEMO" badge that
          // groups it with the mock connections.
          const card = isPassportReal ? { ...c, meta: passportMeta, live: true } : c;
          const runtime = isPassportReal
            ? passportRuntime
            : c.id === "phantom"
              ? { status: "disconnected" as const }
              : conns.state[c.id as ConnId];
          return (
            <ConnectionCard
              key={c.id}
              c={card}
              runtime={runtime}
              wallet={c.id === "phantom" ? wallet : null}
              open={expanded === c.id}
              onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
              onMockConnect={conns.connect}
              onMockDisconnect={conns.disconnect}
              real={isPassportReal ? passportReal : null}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Email-alerts opt-in (dark unless NEXT_PUBLIC_EMAIL_NOTIFICATIONS_ENABLED) */}
        <EmailAlertsCard />

        <div
          style={{
            ...glass,
            padding: 22,
            borderRadius: 18,
            position: "relative",
            overflow: "hidden",
            background: `linear-gradient(145deg, ${tokens.navy}AA, rgba(255,255,255,0.04) 80%)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -30,
              right: -30,
              width: 140,
              height: 140,
              borderRadius: "50%",
              border: `20px solid ${tokens.green}1A`,
            }}
          />
          <div style={{ position: "relative" }}>
            <Icons.shield size={22} stroke={tokens.green} />
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 20,
                fontWeight: 700,
                color: tokens.text,
                marginTop: 12,
                letterSpacing: "-0.02em",
              }}
            >
              {t("conn.keys.title")}
            </div>
            <div
              style={{
                fontSize: 12,
                color: tokens.text2,
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              {t("conn.keys.body")}
            </div>
          </div>
        </div>

        <div
          style={{
            ...glass,
            padding: 18,
            borderRadius: 14,
          }}
        >
          <MonoLabel color={tokens.teal}>{t("conn.soon")}</MonoLabel>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {[
              { n: "Marginfi", d: t("conn.soon.marginfi") },
              { n: "Jupiter", d: t("conn.soon.jupiter") },
              { n: "Open Finance BR", d: t("conn.soon.openfin") },
            ].map((row) => (
              <div
                key={row.n}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      color: tokens.text,
                      fontWeight: 500,
                    }}
                  >
                    {row.n}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: tokens.muted,
                      marginTop: 2,
                    }}
                  >
                    {row.d}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: tokens.fillSoft,
                    border: `1px solid ${tokens.border}`,
                    color: tokens.muted,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  {t("conn.roadmap")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
