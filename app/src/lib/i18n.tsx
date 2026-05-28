"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Translation tables + USDC_RATE live in a sibling .ts so the workspace
// typecheck can pull DICT into tests without enabling JSX globally.
import { DICT, USDC_RATE } from "./i18n-dict";
import type { Currency, Dict, Lang } from "./i18n-dict";

export { DICT, USDC_RATE };
export type { Currency, Dict, Lang };

// ── Helpers ────────────────────────────────────────────────
function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}

export function translate(
  dict: Dict,
  fallback: Dict,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw = dict[key] ?? fallback[key] ?? key;
  return interpolate(raw, params);
}

// ── Context ────────────────────────────────────────────────
export interface I18nContextValue {
  lang: Lang;
  currency: Currency;
  setLang: (l: Lang) => void;
  setCurrency: (c: Currency) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  fmtMoney: (brlAmount: number, opts?: FmtOptions) => string;
  moneySymbol: () => string;
  fmtMoneyThreshold: (brl: number) => string;
}

export interface FmtOptions {
  compact?: boolean;
  noCents?: boolean;
  signed?: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────
const LANG_STORAGE_KEY = "roundfi.lang";
const CURRENCY_STORAGE_KEY = "roundfi.currency";

const isLang = (v: unknown): v is Lang => v === "pt" || v === "en";
const isCurrency = (v: unknown): v is Currency => v === "BRL" || v === "USDC";

export function I18nProvider({
  initialLang = "pt",
  initialCurrency = "BRL",
  children,
}: {
  initialLang?: Lang;
  initialCurrency?: Currency;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);

  // Hydrate from localStorage once on mount. Server render uses
  // `initialLang` (so SSR markup stays deterministic); the effect
  // then upgrades to the user's persisted choice.
  useEffect(() => {
    try {
      const storedLang = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (isLang(storedLang)) setLangState(storedLang);
      const storedCurrency = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
      if (isCurrency(storedCurrency)) setCurrencyState(storedCurrency);
    } catch {
      // localStorage unavailable (private mode, SSR fallback) — ignore.
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang === "pt" ? "pt-BR" : "en");
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {}
  }, [lang]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
    } catch {}
  }, [currency]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const setCurrency = useCallback((c: Currency) => setCurrencyState(c), []);

  const value = useMemo<I18nContextValue>(() => {
    const dict = DICT[lang] ?? DICT.pt;
    const fallback = DICT.pt;

    const t = (key: string, params?: Record<string, string | number>) =>
      translate(dict, fallback, key, params);

    const fmtMoney = (brlAmount: number, opts: FmtOptions = {}) => {
      const { compact = false, noCents = false, signed = false } = opts;
      const isUSDC = currency === "USDC";
      const amount = isUSDC ? brlAmount / USDC_RATE : brlAmount;
      const locale = lang === "pt" ? "pt-BR" : "en-US";
      const minDec = noCents ? 0 : 2;
      const maxDec = noCents ? 0 : 2;

      let num: string;
      if (compact && Math.abs(amount) >= 1000) {
        num = amount.toLocaleString(locale, {
          notation: "compact",
          compactDisplay: "short",
          maximumFractionDigits: 1,
        });
      } else {
        num = amount.toLocaleString(locale, {
          minimumFractionDigits: minDec,
          maximumFractionDigits: maxDec,
        });
      }

      const prefix = signed && brlAmount > 0 ? "+" : "";
      return isUSDC ? `${prefix}${num} USDC` : `${prefix}R$ ${num}`;
    };

    const moneySymbol = () => (currency === "USDC" ? "USDC" : "R$");

    const fmtMoneyThreshold = (brl: number) => {
      if (currency === "USDC") {
        const u = brl / USDC_RATE;
        const k = u >= 1000 ? `${(u / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${u.toFixed(0)}`;
        return `${k} USDC`;
      }
      const k = brl >= 1000 ? `${(brl / 1000).toFixed(0)}k` : `${brl}`;
      return `R$ ${k}`;
    };

    return {
      lang,
      currency,
      setLang,
      setCurrency,
      t,
      fmtMoney,
      moneySymbol,
      fmtMoneyThreshold,
    };
  }, [lang, currency, setLang, setCurrency]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// ── Hooks ──────────────────────────────────────────────────
export function useI18n(): I18nContextValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n() must be used within <I18nProvider>");
  return v;
}

// Convenience: just the `t` function, matches prototype's useT().
export function useT() {
  return useI18n().t;
}
