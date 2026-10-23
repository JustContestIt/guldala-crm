// What the calculator and the order form show while Tatiana types: same rules the server applies on save
import { orderProblems, prepaymentAmount, priceLines, shortages, type Rule, type TulipType } from "./calc";
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
}) {
  const byId = new Map(a.products.map((p) => [p.id, p]));
  const rows = a.lines.map((l) => {
    const p = byId.get(l.key);
    const tulipType = p?.tulipType ?? (l.key as TulipType);
    return { productId: p?.id ?? null, tulipType, qtyPacks: l.packs, packSize: p?.packSize ?? a.settings.pack_size, name: p?.name ?? ANY[tulipType] };
  });
  const priced = priceLines(rows, a.rules, a.today, a.pct);
  const total = priced.subtotal;
  const withColor = rows.filter((r) => r.productId);
  return {
    rows,
    priced,
    prices: rows.map((r) => priceLines([r], a.rules, a.today, a.pct).lines[0] ?? null),
    total,
    prepayment: prepaymentAmount(total, a.pct),
    problems: orderProblems({ lines: rows, settings: a.settings, pct: a.pct, pickupDate: a.date, pickupTime: null, pickupFrom: a.pickupFrom, pickupTo: a.pickupTo }),
    shortages: shortages(
      withColor.map((r) => ({ productId: r.productId!, name: r.name, qtyStems: r.qtyPacks * r.packSize, packSize: r.packSize })),
      new Map(a.products.map((p) => [p.id, p.freeStems])),
    ),
    overThreshold: total >= a.settings.check_threshold_amount,
    allColored: rows.length > 0 && withColor.length === rows.length,
  };
}
