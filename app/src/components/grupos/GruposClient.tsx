"use client";

import { useMemo, useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { Chip } from "@/components/grupos/Chip";
import { FilterRow } from "@/components/grupos/FilterRow";
import { FilterSelect } from "@/components/grupos/FilterSelect";
import { GroupCard } from "@/components/grupos/GroupCard";
import { NewCycleModal } from "@/components/grupos/NewCycleModal";
import { NoGroupsYet } from "@/components/grupos/NoGroupsYet";
import { DeskBtn } from "@/components/home/DeskBtn";
import { useSession } from "@/lib/session";
import { ACTIVE_GROUPS, DISCOVER_GROUPS, type GroupLevel } from "@/data/groups";
import {
  CATEGORY_KEYS,
  fromActive,
  fromDiscover,
  type Category,
  type CatalogGroup,
} from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

type LevelFilter = "all" | GroupLevel;
type CategoryFilter = "all" | Category;
type Budget = "all" | "lt15" | "15to30" | "gt30";
type Duration = "all" | "short" | "mid" | "long";
type Sort = "relevant" | "prize-low" | "prize-high" | "spots";

export function GruposClient() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoneyThreshold } = useI18n();
  const { user } = useSession();

  const enriched: CatalogGroup[] = useMemo(
    () => [...ACTIVE_GROUPS.map(fromActive), ...DISCOVER_GROUPS.map(fromDiscover)],
    [],
  );

  const [level, setLevel] = useState<LevelFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [budget, setBudget] = useState<Budget>("all");
  const [duration, setDuration] = useState<Duration>("all");
  const [sort, setSort] = useState<Sort>("relevant");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyAccessible, setOnlyAccessible] = useState(false);
  const [query, setQuery] = useState("");
  const [newCycleOpen, setNewCycleOpen] = useState(false);

  const filtered = useMemo(() => {
    let rows = enriched;
    if (level !== "all") rows = rows.filter((g) => g.level === level);
    if (category !== "all") rows = rows.filter((g) => g.category === category);
    if (budget !== "all") {
      rows = rows.filter((g) => {
        if (budget === "lt15") return g.prize < 15000;
        if (budget === "15to30") return g.prize >= 15000 && g.prize < 30000;
        return g.prize >= 30000;
      });
    }
    if (duration !== "all") {
      rows = rows.filter((g) => {
        if (duration === "short") return g.months <= 6;
        if (duration === "mid") return g.months > 6 && g.months <= 12;
        return g.months > 12;
      });
    }
    if (onlyOpen) rows = rows.filter((g) => g.filled < g.total);
    if (onlyAccessible) rows = rows.filter((g) => g.level <= user.level);
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((g) => g.name.toLowerCase().includes(q));
    }
    if (sort === "prize-low") rows = [...rows].sort((a, b) => a.prize - b.prize);
    if (sort === "prize-high") rows = [...rows].sort((a, b) => b.prize - a.prize);
    if (sort === "spots")
      rows = [...rows].sort((a, b) => a.total - a.filled - (b.total - b.filled));
    return rows;
  }, [
    enriched,
    level,
    category,
    budget,
    duration,
    onlyOpen,
    onlyAccessible,
    query,
    sort,
    user.level,
  ]);

  const totalOpen = enriched.filter((g) => g.filled < g.total).length;
  const accessibleCount = enriched.filter((g) => g.level <= user.level).length;
  const activeCount =
    [level, category, budget, duration].filter((x) => x !== "all").length +
    (onlyOpen ? 1 : 0) +
    (onlyAccessible ? 1 : 0) +
    (query ? 1 : 0);

  const clearAll = () => {
    setLevel("all");
    setCategory("all");
    setBudget("all");
    setDuration("all");
    setOnlyOpen(false);
    setOnlyAccessible(false);
    setQuery("");
  };

  const sortOptions: ReadonlyArray<readonly [Sort, string]> = [
    ["relevant", t("groups.sort.relevant")],
    ["prize-low", t("groups.sort.priceLow")],
    ["prize-high", t("groups.sort.priceHigh")],
    ["spots", t("groups.sort.spots")],
  ];

  const categoryLabel = (k: Category) => t(`cat.${k}`);

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <MonoLabel color={tokens.green}>{t("groups.badge")}</MonoLabel>
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
            {t("groups.title")}
          </div>
          <div
            style={{
              fontSize: 13,
              color: tokens.text2,
              marginTop: 4,
            }}
          >
            {t("groups.subtitle", {
              open: totalOpen,
              access: accessibleCount,
            })}
          </div>
        </div>
        <DeskBtn tone="primary" icon={Icons.plus} onClick={() => setNewCycleOpen(true)}>
          {t("groups.newCycle")}
        </DeskBtn>
      </div>

      {/* Filter panel */}
      <div
        style={{
          ...glass,
          marginTop: 20,
          padding: 18,
          borderRadius: 16,
        }}
      >
        {/* Search + sort */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={tokens.muted}
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("groups.search")}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                color: tokens.text,
                fontSize: 12,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: tokens.muted,
                  padding: 0,
                  display: "flex",
                }}
              >
                <Icons.close size={14} />
              </button>
            )}
          </div>
          <FilterSelect value={sort} onChange={setSort} options={sortOptions} />
        </div>

        {/* Chip rows */}
        <div
          style={{
            marginTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <FilterRow label={t("groups.filter.level")}>
            <Chip active={level === "all"} onClick={() => setLevel("all")}>
              {t("groups.chip.all")}
            </Chip>
            <Chip active={level === 1} onClick={() => setLevel(1)}>
              {t("groups.lvl1")}
            </Chip>
            <Chip active={level === 2} onClick={() => setLevel(2)}>
              {t("groups.lvl2")}
            </Chip>
            <Chip active={level === 3} tone="p" onClick={() => setLevel(3)}>
              {t("groups.lvl3")}
            </Chip>
          </FilterRow>

          <FilterRow label={t("groups.filter.category")}>
            <Chip active={category === "all"} onClick={() => setCategory("all")}>
              {t("groups.chip.all")}
            </Chip>
            {CATEGORY_KEYS.map((k) => (
              <Chip key={k} active={category === k} onClick={() => setCategory(k)}>
                {categoryLabel(k)}
              </Chip>
            ))}
          </FilterRow>

          <FilterRow label={t("groups.filter.prize")}>
            <Chip active={budget === "all"} onClick={() => setBudget("all")}>
              {t("groups.chip.any")}
            </Chip>
            <Chip active={budget === "lt15"} onClick={() => setBudget("lt15")}>
              {t("groups.chip.lt15", { v: fmtMoneyThreshold(15000) })}
            </Chip>
            <Chip active={budget === "15to30"} onClick={() => setBudget("15to30")}>
              {t("groups.chip.15to30", {
                a: fmtMoneyThreshold(15000),
                b: fmtMoneyThreshold(30000),
              })}
            </Chip>
            <Chip active={budget === "gt30"} onClick={() => setBudget("gt30")}>
              {t("groups.chip.gt30", { v: fmtMoneyThreshold(30000) })}
            </Chip>
          </FilterRow>

          <FilterRow label={t("groups.filter.duration")}>
            <Chip active={duration === "all"} onClick={() => setDuration("all")}>
              {t("groups.chip.any")}
            </Chip>
            <Chip active={duration === "short"} onClick={() => setDuration("short")}>
              {t("groups.chip.lt6")}
            </Chip>
            <Chip active={duration === "mid"} onClick={() => setDuration("mid")}>
              {t("groups.chip.7to12")}
            </Chip>
            <Chip active={duration === "long"} onClick={() => setDuration("long")}>
              {t("groups.chip.gt12")}
            </Chip>
          </FilterRow>

          <FilterRow label={t("groups.filter.avail")}>
            <Chip active={onlyOpen} onClick={() => setOnlyOpen(!onlyOpen)}>
              {onlyOpen ? "✓ " : ""}
              {t("groups.chip.onlyOpen")}
            </Chip>
            <Chip active={onlyAccessible} onClick={() => setOnlyAccessible(!onlyAccessible)}>
              {onlyAccessible ? "✓ " : ""}
              {t("groups.chip.onlyAccessible", { lv: user.level })}
            </Chip>
          </FilterRow>
        </div>

        {/* Active filter summary */}
        {activeCount > 0 && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: `1px solid ${tokens.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: tokens.text2,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("groups.ofN", {
                n: filtered.length,
                total: enriched.length,
                c: activeCount,
                s: activeCount > 1 ? "s" : "",
              })}
            </span>
            <button
              type="button"
              onClick={clearAll}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: tokens.teal,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icons.close size={12} /> {t("groups.clear")}
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <NoGroupsYet onClear={clearAll} />
      ) : (
        <div
          style={{
            marginTop: 20,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
          }}
        >
          {filtered.map((g) => (
            <GroupCard key={g.id} g={g} />
          ))}
        </div>
      )}

      <NewCycleModal open={newCycleOpen} onClose={() => setNewCycleOpen(false)} />
    </div>
  );
}
