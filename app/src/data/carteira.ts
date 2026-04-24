// Mock data for the Carteira screen (and anything that needs the
// active USER). Ported from prototype/components/screens-home.jsx
// + prototype/components/desktop-more.jsx.
//
// These are stand-ins until the on-chain accounts / indexer hook up.

export interface User {
  name: string;
  handle: string;
  avatar: string; // initials
  level: 1 | 2 | 3;
  levelLabel: string;
  score: number;
  scoreDelta: number;
  nextLevel: number;
  walletShort: string;
  colateralPct: number; // % of the prize
  leverageX: number;
  balance: number; // BRL
  yield: number; // BRL
}

export const USER: User = {
  name: "Maria Luísa",
  handle: "@marialuisa.sol",
  avatar: "ML",
  level: 2,
  levelLabel: "Comprovado",
  score: 684,
  scoreDelta: +18,
  nextLevel: 750,
  walletShort: "7xG3…k9Fn",
  colateralPct: 30,
  leverageX: 3.3,
  balance: 8420.55,
  yield: 312.08,
};

// Token accents: 'g' = green, 't' = teal, 'p' = purple, 'a' = amber, 'r' = red.
export type Tone = "g" | "t" | "p" | "a" | "r";

export interface NftPosition {
  id: string;
  num: string;
  group: string;
  tone: Tone;
  month: number;
  total: number;
  exp: string;
  value: number; // BRL
  yieldPct: number;
}

export const NFT_POSITIONS: NftPosition[] = [
  {
    id: "n1",
    num: "03",
    group: "Renovação MEI · 12m",
    tone: "g",
    month: 4,
    total: 12,
    exp: "dez/26",
    value: 1890,
    yieldPct: 6.8,
  },
  {
    id: "n2",
    num: "07",
    group: "Dev Setup · 6m",
    tone: "p",
    month: 3,
    total: 6,
    exp: "jul/26",
    value: 1420,
    yieldPct: 5.2,
  },
  {
    id: "n3",
    num: "01",
    group: "Intercâmbio 2026",
    tone: "t",
    month: 2,
    total: 12,
    exp: "fev/27",
    value: 1070,
    yieldPct: 4.1,
  },
];

export interface Transaction {
  label: string;
  addr: string;
  amount: number; // BRL; negative = outflow
  date: string;
}

export const TX_LIST: Transaction[] = [
  {
    label: "Parcela · Renovação MEI",
    addr: "7xG3…k9Fn → escrow",
    amount: -892.4,
    date: "12 ABR",
  },
  {
    label: "Yield · Kamino vault",
    addr: "kamino.usdc.pool",
    amount: +52.3,
    date: "10 ABR",
  },
  {
    label: "Venda cota #03 · secundário",
    addr: "Pedro S. · @petrus",
    amount: +1890,
    date: "05 ABR",
  },
  {
    label: "Depósito PIX",
    addr: "via Solflare",
    amount: +500,
    date: "03 ABR",
  },
  {
    label: "Parcela · Dev Setup",
    addr: "7xG3…k9Fn → escrow",
    amount: -460,
    date: "01 ABR",
  },
];

// Kamino vault snapshot (shown on the Visão geral tab).
export interface KaminoVault {
  apy: number;
  allocated: number; // BRL
  accrued: number; // BRL
  cycles: number;
  sparkline: number[]; // synthetic yield curve, 0-1 range
}

export const KAMINO_VAULT: KaminoVault = {
  apy: 6.8,
  allocated: 6210.55,
  accrued: 312.08,
  cycles: 2,
  sparkline: [0.2, 0.28, 0.34, 0.4, 0.43, 0.5, 0.58, 0.62, 0.71, 0.78, 0.86, 0.95],
};
