// Price, stock and order rules of spec §9 as pure functions: the server and the calculator in the browser use the same code.
import { hoursFor, parseHours, type SeasonSettings } from "./settings";

export type TulipType = "classic" | "double";
export type Status = "new" | "confirmed" | "prepaid" | "ready" | "issued" | "expired" | "cancelled";

// Only these statuses hold flowers (spec §7)
export const RESERVING: Status[] = ["confirmed", "prepaid", "ready"];

export type Rule = {
  id: string;
  tulipType: TulipType;
  dateFrom: string; // YYYY-MM-DD, inclusive
  dateTo: string;
  prepaymentMinPct: number;
  prepaymentMaxPct: number;
  pricePerStem: number;
};

export const findRule = (rules: Rule[], type: TulipType, day: string, pct: number): Rule | null =>
  rules.find(
    (r) =>
      r.tulipType === type &&
      r.dateFrom <= day &&
      day <= r.dateTo &&
      r.prepaymentMinPct <= pct &&
      pct <= r.prepaymentMaxPct,
  ) ?? null;

export const prepaymentAmount = (total: number, pct: number) => Math.ceil((total * pct) / 100);

export const isValidPct = (pct: number, s: SeasonSettings) =>
  Number.isInteger(pct) &&
  pct >= s.prepayment_min_pct &&
  pct <= s.prepayment_max_pct &&
  (pct - s.prepayment_min_pct) % s.prepayment_step === 0;

// Rows of one tulip type must not share a day and a prepayment % at the same time
export function gridProblems(rules: Omit<Rule, "id">[]): string[] {
  const out: string[] = [];
  rules.forEach((r, i) => {
    const n = i + 1;
    if (!(r.dateFrom <= r.dateTo)) out.push(`Строка ${n}: дата «с» позже даты «по»`);
    if (!(r.prepaymentMinPct <= r.prepaymentMaxPct)) out.push(`Строка ${n}: предоплата «от» больше «до»`);
    if (r.prepaymentMinPct < 0 || r.prepaymentMaxPct > 100) out.push(`Строка ${n}: предоплата вне 0–100 %`);
    if (!(Number.isInteger(r.pricePerStem) && r.pricePerStem > 0)) out.push(`Строка ${n}: цена должна быть целым числом больше нуля`);
    rules.slice(i + 1).forEach((o, j) => {
      if (
        o.tulipType === r.tulipType &&
        r.dateFrom <= o.dateTo &&
        o.dateFrom <= r.dateTo &&
        r.prepaymentMinPct <= o.prepaymentMaxPct &&
        o.prepaymentMinPct <= r.prepaymentMaxPct
      )
        out.push(`Строки ${n} и ${i + j + 2} пересекаются: одна дата и один % предоплаты попадают в обе`);
    });
  });
  return out;
}

export type StockInput = {
  plans: { productId: string; plannedStems: number }[];
  adjustments: { productId: string; deltaStems: number }[];
  items: { productId: string; substituteProductId: string | null; qtyStems: number; issuedStems: number; status: Status }[];
};

// available = plan + adjustments − reserved (confirmed/prepaid/ready) − issued; a substituted line counts against the substitute
export function availableStems({ plans, adjustments, items }: StockInput): Map<string, number> {
  const m = new Map<string, number>();
  const add = (id: string, n: number) => m.set(id, (m.get(id) ?? 0) + n);
  for (const p of plans) add(p.productId, p.plannedStems);
  for (const a of adjustments) add(a.productId, a.deltaStems);
  for (const it of items) {
    const id = it.substituteProductId ?? it.productId;
    if (RESERVING.includes(it.status)) add(id, -it.qtyStems);
    else if (it.status === "issued") add(id, -it.issuedStems);
  }
  return m;
}

export type Line = { productId: string | null; tulipType: TulipType; qtyPacks: number; packSize: number };
export type Priced = { qtyStems: number; unitPrice: number; priceRuleId: string; lineTotal: number };

// Prices every line by the grid on `day`; types with no rule on that day come back in `missing`
export function priceLines<L extends Line>(lines: L[], rules: Rule[], day: string, pct: number) {
  const priced: (L & Priced)[] = [];
  const missing = new Set<TulipType>();
  let validUntil: string | null = null;
  for (const l of lines) {
    const rule = findRule(rules, l.tulipType, day, pct);
    if (!rule) {
      missing.add(l.tulipType);
      continue;
    }
    if (!validUntil || rule.dateTo < validUntil) validUntil = rule.dateTo;
    const qtyStems = l.qtyPacks * l.packSize;
    priced.push({ ...l, qtyStems, unitPrice: rule.pricePerStem, priceRuleId: rule.id, lineTotal: qtyStems * rule.pricePerStem });
  }
  return { lines: priced, subtotal: priced.reduce((a, l) => a + l.lineTotal, 0), missing: [...missing], validUntil };
}

const packs = (n: number) => `${n} пач.`;

export type OrderCheck = {
  lines: (Line & { name: string })[];
  settings: SeasonSettings;
  pct: number;
  pickupDate: string | null;
  pickupTime: string | null; // "HH:MM"
  pickupFrom: string;
  pickupTo: string;
};

// Form-level rules of spec §9: the order can't be saved while any of these hold
export function orderProblems(o: OrderCheck): string[] {
  const s = o.settings;
  const out: string[] = [];
  if (!o.lines.length) out.push("Добавьте хотя бы одну строку");
  if (o.lines.some((l) => !Number.isInteger(l.qtyPacks) || l.qtyPacks < 1)) out.push("Количество — целое число пачек, от 1");
  if (s.min_order_scope === "total") {
    const stems = o.lines.reduce((a, l) => a + l.qtyPacks * l.packSize, 0);
    if (o.lines.length && stems < s.min_order_stems) out.push(`Минимальный заказ — ${s.min_order_stems} шт, сейчас ${stems}`);
  } else {
    for (const l of o.lines)
      if (l.qtyPacks * l.packSize < s.min_order_stems) out.push(`${l.name}: минимум ${s.min_order_stems} шт на цвет`);
  }
  if (!isValidPct(o.pct, s))
    out.push(`Предоплата — от ${s.prepayment_min_pct} до ${s.prepayment_max_pct} % с шагом ${s.prepayment_step}`);
  if (o.pickupDate && (o.pickupDate < o.pickupFrom || o.pickupDate > o.pickupTo)) out.push("Дата выдачи вне окна выдачи сезона");
  if (o.pickupTime) {
    const hours = parseHours(hoursFor(s, o.pickupDate));
    if (hours && (o.pickupTime < hours[0] || o.pickupTime > hours[1])) out.push(`Время выдачи — ${hoursFor(s, o.pickupDate)}`);
  }
  return out;
}

// "Красный классический — свободно 7 пач., запрошено 10" for every product short of stock
export function shortages(lines: { productId: string; name: string; qtyStems: number; packSize: number }[], available: Map<string, number>) {
  const want = new Map<string, { name: string; stems: number; packSize: number }>();
  for (const l of lines) {
    const w = want.get(l.productId) ?? { name: l.name, stems: 0, packSize: l.packSize };
    w.stems += l.qtyStems;
    want.set(l.productId, w);
  }
  const out: string[] = [];
  for (const [id, w] of want) {
    const free = Math.max(0, available.get(id) ?? 0);
    if (w.stems > free) out.push(`${w.name} — свободно ${packs(Math.floor(free / w.packSize))}, запрошено ${w.stems / w.packSize}`);
  }
  return out;
}

export type Pay = { kind: "prepayment" | "balance" | "refund"; status: "pending" | "paid" | "cancelled"; amount: number };

export const paidAmount = (payments: Pay[]) =>
  payments.reduce((a, p) => (p.status !== "paid" ? a : p.kind === "refund" ? a - p.amount : a + p.amount), 0);

export function money(total: number, pct: number, payments: Pay[]) {
  const paid = paidAmount(payments);
  const prepayment = prepaymentAmount(total, pct);
  return {
    paid,
    prepayment,
    prepaymentDue: Math.max(0, prepayment - paid),
    balance: Math.max(0, total - paid),
    prepaid: paid >= prepayment,
    paidInFull: paid >= total,
  };
}
