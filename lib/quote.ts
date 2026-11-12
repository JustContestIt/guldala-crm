// What the calculator and the order form show while Tatiana types: same rules the server applies on save
import { orderProblems, prepayDiscountPct, prepaymentAmount, priceLines, shortages, storageDays, type Rule, type TulipType } from "./calc";
import type { SeasonSettings } from "./settings";

export type ProductOpt = { id: string; name: string; tulipType: TulipType; packSize: number; freeStems: number };
export type LineState = { key: string; packs: number }; // key: product id, or "classic" / "double" for «any color»
export const ANY: Record<TulipType, string> = { classic: "Классика, любой цвет", double: "Махровые, любой цвет" };

export function computeQuote(a: {
  lines: LineState[];
  products: ProductOpt[];
  rules: Rule[];
  settings: SeasonSettings;
  today: string;
  pct: number;
  date: string | null;
  pickupFrom: string;
  pickupTo: string;
  storage?: boolean; // the fridge until pickup, by the day from today
}) {
  const byId = new Map(a.products.map((p) => [p.id, p]));
  const rows = a.lines.map((l) => {
    const p = byId.get(l.key);
    const tulipType = p?.tulipType ?? (l.key as TulipType);
    return { productId: p?.id ?? null, tulipType, qtyPacks: l.packs, packSize: p?.packSize ?? a.settings.pack_size, name: p?.name ?? ANY[tulipType] };
  });
  const off = prepayDiscountPct(a.settings, a.pct, a.today, a.date);
  const priced = priceLines(rows, a.rules, a.today, a.pct, off);
  const days = a.storage ? storageDays(a.today, a.date) : 0;
  const storageFee = days * a.settings.storage_fee_per_day;
  const total = priced.subtotal + storageFee;
  const withColor = rows.filter((r) => r.productId);
  return {
    rows,
    priced,
    // lines at the grid price; the discount is its own line under them, so the client sees what the 100 % saved
    prices: rows.map((r) => priceLines([r], a.rules, a.today, a.pct).lines[0] ?? null),
    discount: { pct: off, amount: priced.saved }, // «Скидка 10 % за 100 % предоплату» (review 12.11.2026, Ц4)
    storage: { days, fee: storageFee },
    total,
    prepayment: prepaymentAmount(total, a.pct),
    problems: orderProblems({ lines: rows, settings: a.settings, pct: a.pct, pickupDate: a.date, pickupTime: null, pickupFrom: a.pickupFrom, pickupTo: a.pickupTo }),
    shortages: shortages(
      withColor.map((r) => ({ productId: r.productId!, name: r.name, qtyStems: r.qtyPacks * r.packSize, packSize: r.packSize })),
      new Map(a.products.map((p) => [p.id, p.freeStems])),
    ),
    allColored: rows.length > 0 && withColor.length === rows.length,
  };
}
