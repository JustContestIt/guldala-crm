import { describe, expect, it } from "vitest";
import { cellName, fromForm, toMatrix, type GridRule } from "./grid";

const rule = (o: Partial<GridRule>): GridRule => ({
  tulipType: "classic",
  dateFrom: "2026-10-20",
  dateTo: "2026-12-31",
  prepaymentMinPct: 40,
  prepaymentMaxPct: 60,
  pricePerStem: 200,
  ...o,
});

const form = (fields: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  return fd;
};

describe("price grid matrix", () => {
  it("round-trips rules through the matrix form", () => {
    const rules = [
      rule({}),
      rule({ prepaymentMinPct: 100, prepaymentMaxPct: 100, pricePerStem: 180 }),
      rule({ tulipType: "double", pricePerStem: 300 }),
      rule({ dateFrom: "2027-01-01", dateTo: "2027-01-31", pricePerStem: 220 }),
    ];
    const m = toMatrix(rules);
    expect(m.periods).toEqual([
      { from: "2026-10-20", to: "2026-12-31" },
      { from: "2027-01-01", to: "2027-01-31" },
    ]);
    expect(m.bands).toEqual([
      { min: 40, max: 60 },
      { min: 100, max: 100 },
    ]);
    const fields: [string, string][] = [
      ...m.bands.flatMap((b): [string, string][] => [
        ["bmin", String(b.min)],
        ["bmax", String(b.max)],
      ]),
      ...m.periods.flatMap((p): [string, string][] => [
        ["pfrom", p.from],
        ["pto", p.to],
      ]),
      ...[...m.cells].map(([k, v]): [string, string] => [k, String(v)]),
    ];
    const r = fromForm(form(fields));
    expect("rows" in r && r.rows).toEqual(expect.arrayContaining(rules));
    expect("rows" in r && r.rows.length).toBe(4);
  });

  it("skips blank and deleted bands and periods, rejects bad cells", () => {
    const base: [string, string][] = [
      ["bmin", "40"],
      ["bmax", "60"],
      ["bmin", ""],
      ["bmax", ""],
      ["pfrom", "2026-10-20"],
      ["pto", "2026-12-31"],
      ["pfrom", "2027-01-01"],
      ["pto", "2027-01-31"],
      ["delp", "1"],
      [cellName("classic", 0, 0), "200"],
      [cellName("classic", 1, 0), "220"],
    ];
    const r = fromForm(form(base));
    expect(r).toEqual({ rows: [rule({})] });
    expect(fromForm(form([...base, [cellName("double", 0, 0), "abc"]]))).toHaveProperty("error");
    expect(fromForm(form([["bmin", "40"], ["bmax", "60"], ["pfrom", "2026-10-20"], ["pto", ""]]))).toHaveProperty("error");
  });
});
