import { describe, expect, it } from "vitest";
import {
  availableStems,
  findRule,
  gridProblems,
  money,
  orderProblems,
  prepaymentAmount,
  priceLines,
  shortages,
  type Rule,
} from "./calc";
import { DEFAULT_SETTINGS } from "./settings";

// Spec §18 stub grid: 4 periods × 3 prepayment bands × 2 types
const PERIODS = [
  ["2026-10-20", "2026-12-31"],
  ["2027-01-01", "2027-01-31"],
  ["2027-02-01", "2027-02-20"],
  ["2027-02-21", "2027-03-08"],
];
const BANDS = [
  [40, 60],
  [70, 90],
  [100, 100],
];
const PRICES = {
  classic: [[200, 190, 180], [220, 210, 200], [250, 240, 230], [300, 290, 280]],
  double: [[300, 290, 280], [330, 320, 310], [370, 360, 350], [450, 440, 430]],
};
const RULES: Rule[] = (["classic", "double"] as const).flatMap((t) =>
  PERIODS.flatMap(([dateFrom, dateTo], p) =>
    BANDS.map(([min, max], b) => ({
      id: `${t}-${p}-${b}`,
      tulipType: t,
      dateFrom,
      dateTo,
      prepaymentMinPct: min,
      prepaymentMaxPct: max,
      pricePerStem: PRICES[t][p][b],
    })),
  ),
);

describe("findRule", () => {
  it("picks the period and band the day and % fall into", () => {
    expect(findRule(RULES, "classic", "2026-11-15", 40)?.pricePerStem).toBe(200);
    expect(findRule(RULES, "classic", "2026-11-15", 80)?.pricePerStem).toBe(190);
    expect(findRule(RULES, "double", "2027-02-10", 100)?.pricePerStem).toBe(350);
  });

  it("treats both period ends as inclusive", () => {
    expect(findRule(RULES, "classic", "2026-12-31", 40)?.pricePerStem).toBe(200);
    expect(findRule(RULES, "classic", "2027-01-01", 40)?.pricePerStem).toBe(220);
    expect(findRule(RULES, "classic", "2027-03-08", 40)?.pricePerStem).toBe(300);
  });

  it("treats both band ends as inclusive", () => {
    expect(findRule(RULES, "classic", "2026-11-01", 60)?.pricePerStem).toBe(200);
    expect(findRule(RULES, "classic", "2026-11-01", 70)?.pricePerStem).toBe(190);
    expect(findRule(RULES, "classic", "2026-11-01", 90)?.pricePerStem).toBe(190);
  });

  it("returns null outside the grid", () => {
    expect(findRule(RULES, "classic", "2026-10-19", 40)).toBeNull();
    expect(findRule(RULES, "classic", "2027-03-09", 40)).toBeNull();
    expect(findRule(RULES, "classic", "2026-11-01", 30)).toBeNull();
    expect(findRule(RULES, "classic", "2026-11-01", 95)).toBeNull();
  });
});

describe("prepaymentAmount", () => {
  it("rounds up to a whole tenge", () => {
    expect(prepaymentAmount(24_000, 40)).toBe(9_600);
    expect(prepaymentAmount(1_001, 40)).toBe(401); // 400.4
    expect(prepaymentAmount(999, 70)).toBe(700); // 699.3
    expect(prepaymentAmount(5_000, 100)).toBe(5_000);
  });
});

describe("gridProblems", () => {
  const row = (o: Partial<Rule>) => ({ ...RULES[0], ...o });

  it("accepts the seed grid", () => {
    expect(gridProblems(RULES)).toEqual([]);
  });

  it("finds rows sharing a day and a %", () => {
    const p = gridProblems([row({}), row({ dateFrom: "2026-12-31", dateTo: "2027-01-05", prepaymentMinPct: 60, prepaymentMaxPct: 60 })]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("Строки 1 и 2");
  });

  it("allows the same dates for another type or another band", () => {
    expect(gridProblems([row({}), row({ tulipType: "double" }), row({ prepaymentMinPct: 61, prepaymentMaxPct: 100 })])).toEqual([]);
  });

  it("rejects reversed ranges and non-positive prices", () => {
    expect(gridProblems([row({ dateFrom: "2027-01-01", dateTo: "2026-12-01" })])[0]).toContain("Строка 1");
    expect(gridProblems([row({ prepaymentMinPct: 90, prepaymentMaxPct: 40 })])).toHaveLength(1);
    expect(gridProblems([row({ pricePerStem: 0 })])).toHaveLength(1);
  });
});

describe("availableStems", () => {
  const plans = [
    { productId: "red", plannedStems: 3000 },
    { productId: "pink", plannedStems: 900 },
  ];
  const item = (productId: string, status: Parameters<typeof availableStems>[0]["items"][0]["status"], qtyStems: number, o = {}) => ({
    productId,
    substituteProductId: null,
    qtyStems,
    issuedStems: 0,
    status,
    ...o,
  });

  it("subtracts reserves of confirmed, prepaid and ready only", () => {
    const m = availableStems({
      plans,
      adjustments: [],
      items: [
        item("red", "confirmed", 120),
        item("red", "prepaid", 300),
        item("red", "ready", 30),
        item("red", "new", 600),
        item("red", "expired", 600),
        item("red", "cancelled", 600),
      ],
    });
    expect(m.get("red")).toBe(3000 - 450);
  });

  it("subtracts issued stems of issued orders, not the ordered quantity", () => {
    const m = availableStems({ plans, adjustments: [], items: [item("red", "issued", 300, { issuedStems: 270 })] });
    expect(m.get("red")).toBe(2730);
  });

  it("counts a substituted line against the substitute", () => {
    const m = availableStems({ plans, adjustments: [], items: [item("red", "confirmed", 300, { substituteProductId: "pink" })] });
    expect(m.get("red")).toBe(3000);
    expect(m.get("pink")).toBe(600);
  });

  it("adds adjustments to the plan", () => {
    const m = availableStems({
      plans,
      adjustments: [
        { productId: "red", deltaStems: -150 },
        { productId: "red", deltaStems: 30 },
      ],
      items: [],
    });
    expect(m.get("red")).toBe(2880);
  });
});

describe("priceLines", () => {
  it("prices lines and reports the earliest end of the used periods", () => {
    const r = priceLines(
      [
        { productId: "red", tulipType: "classic", qtyPacks: 4, packSize: 30 },
        { productId: "pink", tulipType: "double", qtyPacks: 2, packSize: 30 },
      ],
      RULES,
      "2026-12-20",
      40,
    );
    expect(r.lines.map((l) => l.lineTotal)).toEqual([24_000, 18_000]);
    expect(r.subtotal).toBe(42_000);
    expect(r.validUntil).toBe("2026-12-31");
    expect(r.missing).toEqual([]);
  });

  it("reports types with no price on the day", () => {
    const r = priceLines([{ productId: "red", tulipType: "classic", qtyPacks: 4, packSize: 30 }], RULES, "2027-04-01", 40);
    expect(r.lines).toEqual([]);
    expect(r.missing).toEqual(["classic"]);
  });
});

describe("orderProblems", () => {
  const base = {
    lines: [{ productId: "red", tulipType: "classic" as const, qtyPacks: 4, packSize: 30, name: "Красный классический" }],
    settings: { ...DEFAULT_SETTINGS, peak_hours_from: "2027-03-05" },
    pct: 40,
    pickupDate: "2027-03-06",
    pickupTime: "20:00",
    pickupFrom: "2027-03-01",
    pickupTo: "2027-03-08",
  };

  it("accepts a valid order", () => {
    expect(orderProblems(base)).toEqual([]);
  });

  it("checks the minimum in total or per color", () => {
    const lines = [
      { ...base.lines[0], qtyPacks: 2 },
      { ...base.lines[0], productId: "pink", qtyPacks: 2, name: "Розовый" },
    ];
    expect(orderProblems({ ...base, lines })).toEqual([]);
    expect(orderProblems({ ...base, lines: [lines[0]] })[0]).toContain("120 шт, сейчас 60");
    expect(orderProblems({ ...base, lines, settings: { ...base.settings, min_order_scope: "per_color" } })).toHaveLength(2);
  });

  it("checks % step and range", () => {
    expect(orderProblems({ ...base, pct: 50 })).toEqual([]);
    expect(orderProblems({ ...base, pct: 45 })).toHaveLength(1);
    expect(orderProblems({ ...base, pct: 30 })).toHaveLength(1);
    expect(orderProblems({ ...base, pct: 110 })).toHaveLength(1);
  });

  it("checks the pickup window and the hours of that day", () => {
    expect(orderProblems({ ...base, pickupDate: "2027-03-09" })).toHaveLength(1);
    expect(orderProblems({ ...base, pickupDate: "2027-03-02" })[0]).toBe("Время выдачи — 08:00–18:00");
    expect(orderProblems({ ...base, pickupDate: null, pickupTime: null })).toEqual([]);
  });

  it("rejects fractional and zero packs", () => {
    expect(orderProblems({ ...base, lines: [{ ...base.lines[0], qtyPacks: 4.5 }] })).toContain("Количество — целое число пачек, от 1");
    expect(orderProblems({ ...base, lines: [] })).toContain("Добавьте хотя бы одну строку");
  });
});

describe("shortages", () => {
  it("sums lines of one product and speaks in packs", () => {
    const lines = [
      { productId: "red", name: "Красный классический", qtyStems: 150, packSize: 30 },
      { productId: "red", name: "Красный классический", qtyStems: 150, packSize: 30 },
    ];
    expect(shortages(lines, new Map([["red", 210]]))).toEqual(["Красный классический — свободно 7 пач., запрошено 10"]);
    expect(shortages(lines, new Map([["red", 300]]))).toEqual([]);
  });
});

describe("money", () => {
  it("counts only paid payments and subtracts refunds", () => {
    const m = money(10_000, 40, [
      { kind: "prepayment", status: "paid", amount: 3_000 },
      { kind: "prepayment", status: "pending", amount: 1_000 },
      { kind: "balance", status: "cancelled", amount: 5_000 },
    ]);
    expect(m).toMatchObject({ paid: 3_000, prepayment: 4_000, prepaymentDue: 1_000, balance: 7_000, prepaid: false });
    const m2 = money(10_000, 40, [
      { kind: "prepayment", status: "paid", amount: 10_000 },
      { kind: "refund", status: "paid", amount: 1_000 },
    ]);
    expect(m2).toMatchObject({ paid: 9_000, prepaid: true, paidInFull: false, balance: 1_000 });
  });
});
