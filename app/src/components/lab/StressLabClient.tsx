"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { MonoLabel } from "@/components/brand/brand";
import { MemberInfoModal } from "@/components/lab/MemberInfoModal";
import { Icons } from "@/components/brand/icons";
import {
  ALL_NAMES,
  defaultMatrix,
  emptyFrame,
  LEVEL_PARAMS,
  PRESETS,
  PRESET_ORDER,
  runSimulation,
  toggleCell,
  type GroupLevel,
  type GroupMaturity,
  type MatrixCell,
  type MemberLedger,
  type PresetId,
  type StressLabFrame,
} from "@/lib/stressLab";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

const CYCLE_TICK_MS = 450;

function fmtUsdc(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function StressLabClient() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

  // ── Config state ─────────────────────────────────────────
  const [level, setLevel] = useState<GroupLevel>("Comprovado");
  const [maturity, setMaturity] = useState<GroupMaturity>("immature");
  const [members, setMembers] = useState(12);
  const [creditAmountUsdc, setCreditAmountUsdc] = useState(12000);
  const [kaminoApy, setKaminoApy] = useState(6.5);
  const [yieldFeePct, setYieldFeePct] = useState(20);

  const params = LEVEL_PARAMS[level];
  const credit = creditAmountUsdc;
  const installmentUsdc = members > 0 ? credit / members : 0;
  const stakePerPerson = credit * (params.stakePct / 100);

  // ── Matrix state ─────────────────────────────────────────
  const [matrix, setMatrix] = useState<MatrixCell[][]>(() => defaultMatrix(members));

  // Track which preset (if any) is currently loaded so the selector can
  // highlight it. Toggling any cell or moving the members slider clears it.
  const [activePreset, setActivePreset] = useState<PresetId | null>(null);

  // ── Simulation runner ────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [currentCycle, setCurrentCycle] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const memberNames = useMemo(() => ALL_NAMES.slice(0, members), [members]);

  // Frames are derived — recomputed whenever config or matrix changes.
  // The sparkline can read the full trajectory before the user clicks Run;
  // Run just animates currentCycle through the precomputed frames.
  const frames = useMemo<StressLabFrame[]>(
    () =>
      runSimulation(
        { level, maturity, members, creditAmountUsdc, kaminoApy, yieldFeePct, memberNames },
        matrix,
      ),
    [level, maturity, members, creditAmountUsdc, kaminoApy, yieldFeePct, memberNames, matrix],
  );

  const handleMembersChange = (n: number) => {
    setMembers(n);
    setMatrix(defaultMatrix(n));
    setActivePreset(null);
  };

  const handleToggle = (row: number, col: number) => {
    if (running || finished) return;
    setMatrix((prev) => toggleCell(prev, row, col));
    setActivePreset(null);
  };

  const handleLoadPreset = (id: PresetId) => {
    if (running) return;
    const preset = PRESETS[id];
    setLevel(preset.config.level);
    setMaturity(preset.config.maturity ?? "immature");
    setMembers(preset.config.members);
    setCreditAmountUsdc(preset.config.creditAmountUsdc);
    setKaminoApy(preset.config.kaminoApy);
    setYieldFeePct(preset.config.yieldFeePct);
    setMatrix(preset.matrix.map((r) => [...r]));
    setActivePreset(id);
    if (finished) {
      setFinished(false);
      setCurrentCycle(0);
    }
  };

  const handleRun = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(true);
    setFinished(false);
    setCurrentCycle(1);

    let tick = 1;
    intervalRef.current = setInterval(() => {
      tick += 1;
      if (tick > members) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setRunning(false);
        setFinished(true);
      } else {
        setCurrentCycle(tick);
      }
    }, CYCLE_TICK_MS);
  };

  const handleReset = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    setFinished(false);
    setCurrentCycle(0);
  };

  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  // ── Member modal ─────────────────────────────────────────
  const [selectedMember, setSelectedMember] = useState<MemberLedger | null>(null);

  const frame = frames[currentCycle - 1] ?? emptyFrame();
  const m = frame.metrics;

  // ── Render ───────────────────────────────────────────────
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div>
        <Link
          href="/home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 11px",
            borderRadius: 999,
            background: tokens.fillSoft,
            border: `1px solid ${tokens.border}`,
            color: tokens.text2,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontSize: 11,
            fontWeight: 600,
            textDecoration: "none",
            marginBottom: 12,
            transition: "all 180ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = `${tokens.green}55`;
            e.currentTarget.style.color = tokens.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = tokens.border;
            e.currentTarget.style.color = tokens.text2;
          }}
        >
          <Icons.back size={12} stroke="currentColor" sw={2} />
          {t("lab.back")}
        </Link>
        <MonoLabel color={tokens.green}>◆ Stress Lab · M1</MonoLabel>
        <div
          style={{
            fontFamily: "var(--font-syne), Syne",
            fontSize: 32,
            fontWeight: 800,
            color: tokens.text,
            letterSpacing: "-0.03em",
            marginTop: 4,
          }}
        >
          {t("lab.title")}
        </div>
        <div style={{ fontSize: 13, color: tokens.text2, marginTop: 4 }}>
          {t("lab.subtitle")}
        </div>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        {/* ── LEFT — Controls ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...glass, padding: 18, borderRadius: 18 }}>
            <MonoLabel size={9}>{t("lab.controls.title")}</MonoLabel>

            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Presets */}
              <div>
                <label
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: tokens.text2,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  {t("lab.presets.title")}
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                  }}
                >
                  {PRESET_ORDER.map((id) => {
                    const active = activePreset === id;
                    const accent =
                      id === "healthy"
                        ? tokens.green
                        : id === "preDefault"
                        ? tokens.amber
                        : id === "postDefault"
                        ? tokens.red
                        : tokens.purple;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={running}
                        onClick={() => handleLoadPreset(id)}
                        title={t(`lab.presets.${id}Hint`)}
                        style={{
                          padding: "8px 0",
                          fontSize: 9,
                          fontWeight: 700,
                          borderRadius: 8,
                          border: `1px solid ${active ? accent : tokens.border}`,
                          background: active ? `${accent}22` : tokens.fillSoft,
                          color: active ? accent : tokens.text2,
                          cursor: running ? "not-allowed" : "pointer",
                          opacity: running ? 0.6 : 1,
                          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                          transition: "all 200ms ease",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          boxShadow: active ? `0 0 10px ${accent}33` : "none",
                        }}
                      >
                        {t(`lab.presets.${id}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Level */}
              <div>
                <label
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: tokens.text2,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  {t("lab.controls.level")}
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {(["Iniciante", "Comprovado", "Veterano"] as const).map((lvl) => {
                    const active = level === lvl;
                    const isTopTier = lvl === "Veterano";
                    return (
                      <button
                        key={lvl}
                        type="button"
                        disabled={running || finished}
                        onClick={() => setLevel(lvl)}
                        style={{
                          padding: "8px 0",
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 8,
                          border: `1px solid ${active ? tokens.purple : tokens.border}`,
                          background: active ? `${tokens.purple}22` : tokens.fillSoft,
                          color: active ? tokens.purple : tokens.muted,
                          cursor: running || finished ? "not-allowed" : "pointer",
                          opacity: running || finished ? 0.6 : 1,
                          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                          transition: "all 200ms ease",
                          boxShadow: active ? `0 0 12px ${tokens.purple}33` : "none",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4,
                        }}
                      >
                        {t(`lab.level.${lvl.toLowerCase()}`)}
                        {isTopTier && (
                          <span
                            style={{
                              fontSize: 8,
                              color: tokens.green,
                              letterSpacing: "0.04em",
                            }}
                          >
                            ✦
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Group maturity toggle */}
              <div>
                <label
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: tokens.text2,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span>{t("lab.controls.maturity")}</span>
                  <span style={{ color: tokens.muted, fontWeight: 400 }}>
                    {maturity === "mature"
                      ? `${params.releaseMonthsMature} ${t("lab.controls.maturityMonths")}`
                      : `${params.releaseMonths} ${t("lab.controls.maturityMonths")}`}
                  </span>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {(["immature", "mature"] as const).map((mat) => {
                    const active = maturity === mat;
                    const accent = mat === "mature" ? tokens.green : tokens.teal;
                    return (
                      <button
                        key={mat}
                        type="button"
                        disabled={running || finished}
                        onClick={() => setMaturity(mat)}
                        style={{
                          padding: "8px 0",
                          fontSize: 10,
                          fontWeight: 700,
                          borderRadius: 8,
                          border: `1px solid ${active ? accent : tokens.border}`,
                          background: active ? `${accent}22` : tokens.fillSoft,
                          color: active ? accent : tokens.muted,
                          cursor: running || finished ? "not-allowed" : "pointer",
                          opacity: running || finished ? 0.6 : 1,
                          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                          transition: "all 200ms ease",
                          boxShadow: active ? `0 0 12px ${accent}33` : "none",
                        }}
                      >
                        {t(`lab.controls.maturity.${mat}`)}
                      </button>
                    );
                  })}
                </div>

                {/* Explanation: what maturity means + acceleration ladder */}
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: tokens.fillSoft,
                    border: `1px solid ${tokens.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: tokens.text2,
                      lineHeight: 1.5,
                    }}
                  >
                    {t(
                      maturity === "mature"
                        ? "lab.controls.maturity.matureDesc"
                        : "lab.controls.maturity.immatureDesc",
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: `1px solid ${tokens.border}`,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 6,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      fontSize: 10,
                    }}
                  >
                    {(["Iniciante", "Comprovado", "Veterano"] as const).map(
                      (lvl) => {
                        const lvlParams = LEVEL_PARAMS[lvl];
                        const months =
                          maturity === "mature"
                            ? lvlParams.releaseMonthsMature
                            : lvlParams.releaseMonths;
                        const isCurrent = level === lvl;
                        return (
                          <div
                            key={lvl}
                            style={{
                              flex: 1,
                              textAlign: "center",
                              color: isCurrent ? tokens.text : tokens.muted,
                              fontWeight: isCurrent ? 700 : 400,
                            }}
                          >
                            <div style={{ fontSize: 8, letterSpacing: "0.08em" }}>
                              {t(`lab.level.${lvl.toLowerCase()}`)
                                .slice(0, 3)
                                .toUpperCase()}
                            </div>
                            <div
                              style={{
                                marginTop: 2,
                                color: isCurrent
                                  ? maturity === "mature"
                                    ? tokens.green
                                    : tokens.teal
                                  : tokens.muted,
                              }}
                            >
                              {months}m
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              </div>

              {/* Stake info card */}
              <div
                style={{
                  ...glass,
                  padding: 14,
                  borderRadius: 12,
                  background: `${tokens.green}0F`,
                  border: `1px solid ${tokens.green}33`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9 }}>
                  <span
                    style={{
                      color: tokens.green,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {t("lab.controls.stakeRequired")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      color: tokens.green,
                      fontWeight: 700,
                      fontSize: 11,
                      background: `${tokens.green}22`,
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {params.stakePct}%
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 9,
                    marginTop: 8,
                  }}
                >
                  <span
                    style={{
                      color: tokens.muted,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {t("lab.controls.guarantee")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      color: tokens.text,
                    }}
                  >
                    ${fmtUsdc(stakePerPerson)}
                  </span>
                </div>
              </div>

              {/* Members */}
              <div>
                <label
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: tokens.text2,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span>{t("lab.controls.members")}</span>
                  <span style={{ color: tokens.green }}>{members}</span>
                </label>
                <input
                  type="range"
                  min={4}
                  max={24}
                  value={members}
                  disabled={running || finished}
                  onChange={(e) => handleMembersChange(Number(e.target.value))}
                  style={{
                    width: "100%",
                    accentColor: tokens.green,
                    cursor: running || finished ? "not-allowed" : "pointer",
                  }}
                />
              </div>

              {/* Installment */}
              <div>
                <label
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: tokens.text2,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  {t("lab.controls.creditAmount")}
                </label>
                <input
                  type="number"
                  step={500}
                  value={creditAmountUsdc}
                  disabled={running || finished}
                  onChange={(e) =>
                    setCreditAmountUsdc(Number(e.target.value))
                  }
                  style={{
                    width: "100%",
                    background: tokens.fillSoft,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: 8,
                    color: tokens.text,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 12,
                    padding: "10px 12px",
                    outline: "none",
                  }}
                />
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 10,
                    color: tokens.muted,
                  }}
                >
                  <span>{t("lab.controls.derivedInstallment")}</span>
                  <span style={{ color: tokens.text2 }}>
                    ${fmtUsdc(installmentUsdc)} ×{" "}
                    {t("lab.controls.derivedCycles", { n: members })}
                  </span>
                </div>
              </div>

              {/* APY */}
              <div>
                <label
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: tokens.text2,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span>{t("lab.controls.kaminoApy")}</span>
                  <span style={{ color: tokens.teal }}>{kaminoApy}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={0.5}
                  value={kaminoApy}
                  disabled={running || finished}
                  onChange={(e) => setKaminoApy(Number(e.target.value))}
                  style={{ width: "100%", accentColor: tokens.teal }}
                />
              </div>

              {/* Admin fee */}
              <div>
                <label
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: tokens.text2,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span>{t("lab.controls.adminFee")}</span>
                  <span style={{ color: tokens.amber }}>{yieldFeePct}%</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={yieldFeePct}
                  disabled={running || finished}
                  onChange={(e) => setYieldFeePct(Number(e.target.value))}
                  style={{ width: "100%", accentColor: tokens.amber }}
                />
                <div style={{ fontSize: 9, color: tokens.muted, marginTop: 4 }}>
                  {t("lab.controls.adminFeeHint")}
                </div>
              </div>
            </div>
          </div>

          {!running && !finished ? (
            <button
              type="button"
              onClick={handleRun}
              style={{
                background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
                color: tokens.bgDeep,
                fontWeight: 800,
                padding: "14px 0",
                borderRadius: 14,
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                boxShadow: `0 0 24px ${tokens.green}55`,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            >
              {t("lab.controls.run")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReset}
              style={{
                background: tokens.fillMed,
                color: tokens.text,
                fontWeight: 700,
                padding: "14px 0",
                borderRadius: 14,
                border: `1px solid ${tokens.borderStr}`,
                cursor: "pointer",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            >
              {t("lab.controls.reset")}
            </button>
          )}
        </div>

        {/* ── RIGHT — Matrix + audit + ledger ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          {/* Matrix */}
          <div style={{ ...glass, padding: 18, borderRadius: 18 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <MonoLabel size={9}>{t("lab.matrix.title")}</MonoLabel>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontSize: 9,
                  background: tokens.fillSoft,
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: `1px solid ${tokens.border}`,
                }}
              >
                <span style={{ color: tokens.green }}>{t("lab.matrix.legend.pay")}</span>
                <span style={{ color: tokens.purple }}>{t("lab.matrix.legend.contemplate")}</span>
                <span style={{ color: tokens.red }}>{t("lab.matrix.legend.default")}</span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 2, minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        fontSize: 9,
                        color: tokens.muted,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        paddingBottom: 6,
                        width: 70,
                      }}
                    >
                      {t("lab.matrix.head.members")}
                    </th>
                    {Array.from({ length: members }).map((_, i) => (
                      <th
                        key={i}
                        style={{
                          fontSize: 8,
                          fontFamily:
                            "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                          color: currentCycle === i + 1 ? tokens.green : tokens.muted,
                          paddingBottom: 6,
                          fontWeight: 500,
                        }}
                      >
                        {t("lab.matrix.cyclePrefix")}_{i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memberNames.map((name, mIdx) => (
                    <tr key={name + mIdx}>
                      <td
                        style={{
                          fontSize: 10,
                          fontFamily:
                            "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                          color: tokens.text2,
                          paddingRight: 8,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 70,
                        }}
                      >
                        {name}
                      </td>
                      {Array.from({ length: members }).map((_, cIdx) => {
                        const action = matrix[mIdx]?.[cIdx] ?? "P";
                        const isActiveCycle = cIdx + 1 === currentCycle;
                        const isPast = cIdx + 1 < currentCycle;
                        const dimmed = (running || finished) && !isActiveCycle && !isPast;

                        let bg = tokens.fillSoft;
                        let color = tokens.muted;
                        let border = `1px solid transparent`;
                        if (action === "C") {
                          bg = `${tokens.purple}22`;
                          color = tokens.purple;
                          border = `1px solid ${tokens.purple}55`;
                        } else if (action === "X") {
                          bg = `${tokens.red}1F`;
                          color = tokens.red;
                          border = `1px solid ${tokens.red}55`;
                        }

                        return (
                          <td key={cIdx} style={{ padding: 0, height: 28 }}>
                            <button
                              type="button"
                              disabled={running || finished}
                              onClick={() => handleToggle(mIdx, cIdx)}
                              style={{
                                width: "100%",
                                height: "100%",
                                background: bg,
                                color,
                                border,
                                borderRadius: 4,
                                fontSize: 9,
                                fontWeight: 700,
                                fontFamily:
                                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                                cursor: running || finished ? "not-allowed" : "pointer",
                                opacity: dimmed ? 0.3 : 1,
                                outline: isActiveCycle ? `1px solid ${tokens.green}` : "none",
                                transition: "all 150ms ease",
                              }}
                            >
                              {action}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PoolBalanceSparkline
              frames={frames}
              currentCycle={currentCycle}
              tokens={tokens}
              t={t}
            />
          </div>

          {/* Audit + KPIs + Ledger */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            {/* LEFT: Audit + KPIs */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {finished && (
                <div
                  style={{
                    ...glass,
                    padding: 22,
                    borderRadius: 22,
                    background:
                      m.netSolvency >= 0
                        ? `${tokens.green}0D`
                        : `${tokens.red}1A`,
                    border: `1px solid ${
                      m.netSolvency >= 0 ? `${tokens.green}55` : `${tokens.red}55`
                    }`,
                  }}
                >
                  <MonoLabel size={9}>{t("lab.audit.title")}</MonoLabel>

                  {/* Assets — float + segregated buckets */}
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    <span style={{ color: tokens.text2, textTransform: "uppercase" }}>
                      {t("lab.audit.grossCash")}
                    </span>
                    <span style={{ color: tokens.text, fontWeight: 700 }}>
                      ${fmtUsdc(m.poolBalance)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    <span style={{ color: tokens.green, textTransform: "uppercase" }}>
                      {t("lab.audit.solidarityVault")}
                    </span>
                    <span style={{ color: tokens.green, fontWeight: 700 }}>
                      +${fmtUsdc(m.solidarityVault)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      paddingBottom: 14,
                      borderBottom: `1px solid ${tokens.border}`,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    <span style={{ color: tokens.green, textTransform: "uppercase" }}>
                      {t("lab.audit.guaranteeFund")}
                    </span>
                    <span style={{ color: tokens.green, fontWeight: 700 }}>
                      +${fmtUsdc(m.guaranteeFund)}
                      <span
                        style={{
                          color: tokens.muted,
                          fontWeight: 400,
                          marginLeft: 4,
                          fontSize: 10,
                        }}
                      >
                        / ${fmtUsdc(m.guaranteeFundCap)}
                      </span>
                    </span>
                  </div>

                  {/* Liabilities — what's still owed */}
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    <span style={{ color: tokens.amber, textTransform: "uppercase" }}>
                      {t("lab.audit.outstandingEscrow")}
                    </span>
                    <span style={{ color: tokens.amber, fontWeight: 700 }}>
                      −${fmtUsdc(m.outstandingEscrow)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    <span style={{ color: tokens.amber, textTransform: "uppercase" }}>
                      {t("lab.audit.outstandingStake")}
                    </span>
                    <span style={{ color: tokens.amber, fontWeight: 700 }}>
                      −${fmtUsdc(m.outstandingStakeRefund)}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      paddingBottom: 14,
                      borderBottom: `1px solid ${tokens.border}`,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    <span style={{ color: tokens.red, textTransform: "uppercase" }}>
                      {t("lab.audit.totalLoss")}
                    </span>
                    <span style={{ color: tokens.red, fontWeight: 700 }}>
                      −${fmtUsdc(m.totalLoss)}
                    </span>
                  </div>
                  {/* Side metrics — already accounted for elsewhere or
                      paid out, shown as informational rows */}
                  <div
                    style={{
                      marginTop: 8,
                      paddingBottom: 14,
                      borderBottom: `1px solid ${tokens.border}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 10,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      color: tokens.muted,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ textTransform: "uppercase" }}>
                        {t("lab.audit.retained")}
                      </span>
                      <span>+${fmtUsdc(m.totalRetained)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ textTransform: "uppercase" }}>
                        {t("lab.audit.lpDistribution")}
                      </span>
                      <span>+${fmtUsdc(m.lpDistribution)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ textTransform: "uppercase" }}>
                        {t("lab.audit.participantsDistribution")}
                      </span>
                      <span>+${fmtUsdc(m.participantsDistribution)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ textTransform: "uppercase" }}>
                        {t("lab.audit.protocolFee")}
                      </span>
                      <span>+${fmtUsdc(m.protocolFeeRevenue)}</span>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        color: tokens.text,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {t("lab.audit.netSolvency")}
                    </span>
                    <span
                      style={{
                        fontFamily:
                          "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                        fontWeight: 800,
                        fontSize: 18,
                        color: m.netSolvency >= 0 ? tokens.green : tokens.red,
                      }}
                    >
                      {m.netSolvency >= 0
                        ? t("lab.audit.solvent")
                        : t("lab.audit.insolvent")}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      color: tokens.muted,
                      textAlign: "right",
                    }}
                  >
                    {m.netSolvency >= 0 ? "+" : ""}${fmtUsdc(m.netSolvency)}
                  </div>
                </div>
              )}

              {/* KPI cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <KpiCard
                  label={t("lab.kpi.inflow")}
                  value={`$${fmtUsdc(
                    (m.totalStake || stakePerPerson * members) + m.collectedInstallments,
                  )}`}
                  glass={glass}
                  tokens={tokens}
                />
                <KpiCard
                  label={t("lab.kpi.escrowOut")}
                  value={`$${fmtUsdc(m.paidOut)}`}
                  color={tokens.purple}
                  glass={glass}
                  tokens={tokens}
                />
              </div>
              <div
                style={{
                  ...glass,
                  padding: 16,
                  borderRadius: 18,
                  background: `${tokens.amber}0D`,
                  border: `1px solid ${tokens.amber}33`,
                }}
              >
                <MonoLabel size={9} color={tokens.amber}>
                  {t("lab.kpi.protocolFee")}
                </MonoLabel>
                <div
                  style={{
                    marginTop: 6,
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontWeight: 800,
                    fontSize: 20,
                    color: tokens.amber,
                  }}
                >
                  +${fmtUsdc(m.protocolFeeRevenue)}
                </div>
                <div style={{ fontSize: 9, color: tokens.muted, marginTop: 4 }}>
                  {t("lab.kpi.protocolFeeHint")}
                </div>
              </div>
            </div>

            {/* RIGHT: Ledger */}
            <div
              style={{
                ...glass,
                padding: 18,
                borderRadius: 22,
                display: "flex",
                flexDirection: "column",
                minHeight: 320,
              }}
            >
              <MonoLabel size={9}>{t("lab.ledger.title")}</MonoLabel>
              <div
                style={{
                  marginTop: 10,
                  flex: 1,
                  overflowY: "auto",
                  fontSize: 10,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: tokens.muted, borderBottom: `1px solid ${tokens.border}` }}>
                      <th style={{ textAlign: "left", paddingBottom: 6, paddingRight: 6 }}>
                        {t("lab.ledger.col.member")}
                      </th>
                      <th style={{ textAlign: "center", paddingBottom: 6 }}>
                        {t("lab.ledger.col.info")}
                      </th>
                      <th style={{ textAlign: "right", paddingBottom: 6, paddingRight: 6 }}>
                        {t("lab.ledger.col.received")}
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          paddingBottom: 6,
                          paddingRight: 6,
                          color: tokens.amber,
                        }}
                      >
                        {t("lab.ledger.col.retained")}
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          paddingBottom: 6,
                          color: tokens.red,
                        }}
                      >
                        {t("lab.ledger.col.loss")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {frame.ledgerSnapshot.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          style={{ padding: 14, textAlign: "center", color: tokens.muted }}
                        >
                          {t("lab.ledger.empty")}
                        </td>
                      </tr>
                    ) : (
                      frame.ledgerSnapshot.map((l, i) => (
                        <tr key={l.name + i} style={{ borderBottom: `1px solid ${tokens.border}` }}>
                          <td style={{ paddingTop: 6, paddingBottom: 6, color: tokens.text }}>
                            {l.name}
                            {l.status === "calote_pre" && (
                              <span style={{ color: tokens.amber, marginLeft: 4 }}>⚠</span>
                            )}
                            {l.status === "calote_pos" && (
                              <span style={{ color: tokens.red, marginLeft: 4 }}>🚨</span>
                            )}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => setSelectedMember(l)}
                              style={{
                                background: tokens.fillSoft,
                                border: `1px solid ${tokens.border}`,
                                borderRadius: 6,
                                padding: 4,
                                cursor: "pointer",
                                color: tokens.text2,
                                display: "inline-flex",
                              }}
                            >
                              <Icons.info size={12} />
                            </button>
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              paddingRight: 6,
                              color: tokens.purple,
                            }}
                          >
                            {l.received > 0 ? `$${fmtUsdc(l.received)}` : "-"}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              paddingRight: 6,
                              color: tokens.amber,
                              fontWeight: 700,
                            }}
                          >
                            {l.retained > 0 ? `+$${fmtUsdc(l.retained)}` : "-"}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              color: tokens.red,
                              fontWeight: 700,
                            }}
                          >
                            {l.lossCaused > 0 ? `-$${fmtUsdc(l.lossCaused)}` : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MemberInfoModal
        member={selectedMember}
        open={selectedMember !== null}
        onClose={() => setSelectedMember(null)}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
  glass,
  tokens,
}: {
  label: string;
  value: string;
  color?: string;
  glass: ReturnType<typeof glassSurfaceStyle>;
  tokens: ReturnType<typeof useTheme>["tokens"];
}) {
  return (
    <div style={{ ...glass, padding: 14, borderRadius: 14 }}>
      <MonoLabel size={9}>{label}</MonoLabel>
      <div
        style={{
          marginTop: 6,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontWeight: 700,
          fontSize: 16,
          color: color ?? tokens.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// Inline SVG sparkline of pool balance per cycle. Pre-run shows the
// full predicted trajectory (frames are recomputed on every config /
// matrix change). During run, the cycles up to currentCycle render
// solid; the rest of the curve stays dimmed.
function PoolBalanceSparkline({
  frames,
  currentCycle,
  tokens,
  t,
}: {
  frames: StressLabFrame[];
  currentCycle: number;
  tokens: ReturnType<typeof useTheme>["tokens"];
  t: (k: string) => string;
}) {
  if (frames.length === 0) return null;

  const W = 100;
  const H = 28;
  const pad = 2;

  const balances = frames.map((f) => f.metrics.poolBalance);
  const minBal = Math.min(0, ...balances);
  const maxBal = Math.max(0, ...balances);
  const span = Math.max(1, maxBal - minBal);

  const N = frames.length;
  const xAt = (i: number) => pad + (i / Math.max(1, N - 1)) * (W - pad * 2);
  const yAt = (v: number) =>
    H - pad - ((v - minBal) / span) * (H - pad * 2);

  const points = frames.map((f, i) => `${xAt(i)},${yAt(f.metrics.poolBalance)}`);
  const path = `M ${points.join(" L ")}`;
  const zeroY = yAt(0);

  // Solid path up to currentCycle, dim path thereafter.
  const cutoff = currentCycle > 0 ? currentCycle : N;
  const solidPath =
    cutoff >= 2
      ? `M ${points.slice(0, cutoff).join(" L ")}`
      : "";
  const dimPath =
    cutoff < N
      ? `M ${points.slice(Math.max(0, cutoff - 1)).join(" L ")}`
      : "";

  const lastBalance = frames[frames.length - 1].metrics.poolBalance;
  // Color signal driven by net solvency (gross cash − outstanding
  // obligations) rather than gross cash alone — matches the audit
  // panel verdict so the two surfaces always agree.
  const lastNetSolvency = frames[frames.length - 1].metrics.netSolvency;
  const isHealthy = lastNetSolvency >= 0;

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 9,
          color: tokens.muted,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          marginBottom: 6,
        }}
      >
        <span>{t("lab.chart.poolBalance")}</span>
        <span style={{ color: isHealthy ? tokens.green : tokens.red }}>
          ${lastBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: 64,
          background: tokens.fillSoft,
          borderRadius: 6,
          border: `1px solid ${tokens.border}`,
          display: "block",
        }}
      >
        {/* Zero baseline */}
        <line
          x1={pad}
          y1={zeroY}
          x2={W - pad}
          y2={zeroY}
          stroke={tokens.border}
          strokeWidth={0.3}
          strokeDasharray="1 1"
        />
        {/* Predicted (dim) curve */}
        {dimPath && (
          <path
            d={dimPath}
            fill="none"
            stroke={tokens.muted}
            strokeWidth={0.6}
            strokeDasharray="1 1"
            opacity={0.7}
          />
        )}
        {/* Realised (solid) curve */}
        {solidPath && (
          <path
            d={solidPath}
            fill="none"
            stroke={isHealthy ? tokens.green : tokens.red}
            strokeWidth={0.9}
            strokeLinejoin="round"
          />
        )}
        {/* Cycle marker */}
        {currentCycle > 0 && currentCycle <= N && (
          <line
            x1={xAt(currentCycle - 1)}
            y1={pad}
            x2={xAt(currentCycle - 1)}
            y2={H - pad}
            stroke={tokens.green}
            strokeWidth={0.4}
            opacity={0.6}
          />
        )}
      </svg>
    </div>
  );
}
