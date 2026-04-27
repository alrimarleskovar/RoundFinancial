// Secondary-market offer fixtures. Each entry is one NFT share being
// resold below face value. Ported from
// prototype/components/desktop-more.jsx (MARKET_OFFERS).

export interface MarketOffer {
  id: string;
  num: string;     // share number, padded
  group: string;   // owning ROSCA group
  month: number;
  total: number;
  face: number;    // face value in BRL
  price: number;   // ask price in BRL
  disc: number;    // discount % (face → price)
}

export const MARKET_OFFERS: MarketOffer[] = [
  { id: "m1", num: "02", group: "Intercâmbio 2026",       month: 2, total: 12, face: 1640, price: 1440, disc: 12.2 },
  { id: "m2", num: "05", group: "Renovação MEI",          month: 4, total: 12, face:  892, price:  812, disc:  9.0 },
  { id: "m3", num: "11", group: "PME · Capital de Giro",  month: 7, total: 18, face: 1520, price: 1320, disc: 13.2 },
  { id: "m4", num: "04", group: "Dev Setup · 6m",         month: 3, total:  6, face: 1840, price: 1620, disc: 12.0 },
  { id: "m5", num: "08", group: "Reforma Casa",           month: 5, total: 24, face: 1200, price: 1092, disc:  9.0 },
  { id: "m6", num: "14", group: "Enxoval · 6m",           month: 4, total:  6, face:  740, price:  680, disc:  8.1 },
];

// Featured offer of the day (sidebar card on the Buy tab).
export const FEATURED_OFFER = {
  group: "Dev Setup · cota #04",
  monthsLeft: 4,
  sellerScore: 712,
  face: 1840,
  price: 1620,
  effectiveDiscount: 12,
  fillPct: 88, // visual progress filler
  apyEquivalent: 7.8,
};
