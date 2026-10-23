// Price grid as Tatiana thinks of it: periods × prepayment bands × type. Stored as flat price_rules.
import type { Rule, TulipType } from "./calc";

export const TYPES: TulipType[] = ["classic", "double"];
export type GridRule = Omit<Rule, "id">;
export type Matrix = { periods: { from: string; to: string }[]; bands: { min: number; max: number }[]; cells: Map<string, number> };

export const cellName = (t: TulipType, p: number, b: number) => `cell:${t}:${p}:${b}`;

export function toMatrix(rules: GridRule[]): Matrix {
  const periods = [...new Set(rules.map((r) => `${r.dateFrom}|${r.dateTo}`))].sort().map((s) => {
    const [from, to] = s.split("|");
    return { from, to };
  });
  const bands = [...new Set(rules.map((r) => `${r.prepaymentMinPct}|${r.prepaymentMaxPct}`))]
    .map((s) => s.split("|").map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([min, max]) => ({ min, max }));
  const cells = new Map<string, number>();
  for (const r of rules) {
    const p = periods.findIndex((x) => x.from === r.dateFrom && x.to === r.dateTo);
    const b = bands.findIndex((x) => x.min === r.prepaymentMinPct && x.max === r.prepaymentMaxPct);
    cells.set(cellName(r.tulipType, p, b), r.pricePerStem);
  }
  return { periods, bands, cells };
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const whole = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);

// Form fields: bmin/bmax and pfrom/pto lists, cell:<type>:<period>:<band>, delb/delp = indexes to drop.
// Blank bands, periods and cells are skipped: a blank cell means «no price» for that combination.
export function fromForm(fd: FormData): { rows: GridRule[] } | { error: string } {
  const list = (k: string) => fd.getAll(k).map((v) => String(v).trim());
  const [bmin, bmax, pfrom, pto] = ["bmin", "bmax", "pfrom", "pto"].map(list);
  const delb = new Set(list("delb"));
  const delp = new Set(list("delp"));

  const bands: { i: number; min: number; max: number }[] = [];
  for (let i = 0; i < bmin.length; i++) {
    if (delb.has(String(i)) || (!bmin[i] && !bmax[i])) continue;
    const [min, max] = [whole(bmin[i]), whole(bmax[i] || bmin[i])];
    if (Number.isNaN(min) || Number.isNaN(max)) return { error: `Полоса ${bands.length + 1}: % предоплаты «от» и «до» — целые числа` };
    bands.push({ i, min, max });
  }
  const periods: { j: number; from: string; to: string }[] = [];
  for (let j = 0; j < pfrom.length; j++) {
    if (delp.has(String(j)) || (!pfrom[j] && !pto[j])) continue;
    if (!isDay(pfrom[j]) || !isDay(pto[j])) return { error: `Период ${periods.length + 1}: укажите обе даты` };
    periods.push({ j, from: pfrom[j], to: pto[j] });
  }

  const rows: GridRule[] = [];
  for (const p of periods)
    for (const b of bands)
      for (const t of TYPES) {
        const v = String(fd.get(cellName(t, p.j, b.i)) ?? "").trim();
        if (!v) continue;
        const price = whole(v.replace(/\s/g, ""));
        if (!(price > 0)) return { error: `Цена ${p.from}…${p.to}, ${b.min}–${b.max} %: целое число больше нуля` };
        rows.push({ tulipType: t, dateFrom: p.from, dateTo: p.to, prepaymentMinPct: b.min, prepaymentMaxPct: b.max, pricePerStem: price });
      }
  return { rows };
}
