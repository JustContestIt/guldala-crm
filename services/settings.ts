// Settings screen (spec §5.8): seasons, price grid, colors, stock plan. Owner only — checked in the actions.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { appState, priceRules, products, seasons, stockAdjustments, stockPlans } from "@/db/schema";
import { gridProblems, type TulipType } from "@/lib/calc";
import type { GridRule } from "@/lib/grid";
import { DEFAULT_SETTINGS, parseHours, type SeasonSettings } from "@/lib/settings";
import { getSeason } from "./catalog";

type Res = { ok: true } | { ok: false; error: string };
const ok: Res = { ok: true };
const no = (error: string): Res => ({ ok: false, error });

// app_state: small app-wide facts — the WhatsApp channel, the last webhook, the assistant's settings. A save merges keys.
export const saveState = (key: string, value: Record<string, unknown>) =>
  db
    .insert(appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: appState.key, set: { value: sql`${appState.value} || excluded.value`, updatedAt: new Date() } });

export async function readState(key: string) {
  const [row] = await db.select({ value: appState.value }).from(appState).where(eq(appState.key, key));
  return row?.value ?? {};
}

export type SeasonFields = { name: string; ordersOpenFrom: string; peakDate: string; pickupFrom: string; pickupTo: string };

function seasonProblem(f: SeasonFields, s: SeasonSettings) {
  if (!f.name) return "Название сезона";
  if (!(f.ordersOpenFrom && f.peakDate && f.pickupFrom && f.pickupTo)) return "Заполните все даты";
  if (!(f.pickupFrom <= f.pickupTo)) return "Окно выдачи: «с» позже «по»";
  if (!(f.ordersOpenFrom <= f.pickupFrom)) return "Приём заказов должен начаться до выдачи";
  const ints = [s.pack_size, s.min_order_stems, s.hold_days, s.check_threshold_amount, s.prepayment_min_pct, s.prepayment_max_pct, s.prepayment_step, s.stock_few_below_pct];
  if (ints.some((n) => !Number.isInteger(n) || n < 1)) return "Числовые параметры — целые числа больше нуля";
  if (!Number.isInteger(s.storage_fee_per_day) || s.storage_fee_per_day < 0) return "Холодильник — целое число тенге в сутки, 0 — бесплатно";
  if (s.prepayment_min_pct > s.prepayment_max_pct || s.prepayment_max_pct > 100) return "Предоплата: от ≤ до ≤ 100";
  if ((s.prepayment_max_pct - s.prepayment_min_pct) % s.prepayment_step) return "Шаг предоплаты должен укладываться между «от» и «до»";
  if (!parseHours(s.pickup_hours) || !parseHours(s.pickup_hours_peak)) return "Часы выдачи в виде 08:00–18:00";
  if (s.peak_hours_from && (s.peak_hours_from < f.pickupFrom || s.peak_hours_from > f.pickupTo)) return "Пиковые часы — внутри окна выдачи";
  return null;
}

export async function createSeason(f: SeasonFields): Promise<Res & { id?: string }> {
  const settings = { ...DEFAULT_SETTINGS, peak_hours_from: f.pickupTo };
  const p = seasonProblem(f, settings);
  if (p) return no(p);
  const [s] = await db.insert(seasons).values({ ...f, settings }).returning({ id: seasons.id });
  return { ok: true, id: s.id };
}

export async function updateSeason(id: string, f: SeasonFields, settings: SeasonSettings): Promise<Res> {
  const p = seasonProblem(f, settings);
  if (p) return no(p);
  await db.update(seasons).set({ ...f, settings }).where(eq(seasons.id, id));
  return ok;
}

// One open season at a time: it is the one orders go into
export async function setSeasonStatus(id: string, status: "planning" | "open" | "closed"): Promise<Res> {
  if (status === "open") {
    const [other] = await db.select().from(seasons).where(and(eq(seasons.status, "open"), ne(seasons.id, id)));
    if (other) return no(`Сначала закройте сезон «${other.name}»`);
  }
  await db.update(seasons).set({ status }).where(eq(seasons.id, id));
  return ok;
}

const ruleKey = (r: GridRule) => `${r.tulipType}|${r.dateFrom}|${r.dateTo}|${r.prepaymentMinPct}|${r.prepaymentMaxPct}`;

// Replaces the season grid. A rule with the same type, period and band keeps its id (order items point at it).
export async function saveGrid(seasonId: string, rows: GridRule[]): Promise<Res> {
  const problems = gridProblems(rows);
  if (problems.length) return no(problems.join(". "));
  await db.transaction(async (tx) => {
    const existing = new Map((await tx.select().from(priceRules).where(eq(priceRules.seasonId, seasonId))).map((r) => [ruleKey(r), r]));
    const keep: string[] = [];
    for (const r of rows) {
      const e = existing.get(ruleKey(r));
      if (!e) await tx.insert(priceRules).values({ ...r, seasonId });
      else {
        keep.push(e.id);
        if (e.pricePerStem !== r.pricePerStem) await tx.update(priceRules).set({ pricePerStem: r.pricePerStem }).where(eq(priceRules.id, e.id));
      }
    }
    const gone = [...existing.values()].filter((e) => !keep.includes(e.id)).map((e) => e.id);
    if (gone.length) await tx.delete(priceRules).where(inArray(priceRules.id, gone));
  });
  return ok;
}

export type ProductFields = { name: string; tulipType: TulipType; color: string; varieties: string; isActive: boolean; sortOrder: number };

export async function saveProduct(id: string | null, f: ProductFields): Promise<Res> {
  if (!f.name) return no("Название цвета");
  if (!Number.isInteger(f.sortOrder)) return no("Порядок — целое число");
  const values = { ...f, color: f.color || null, varieties: f.varieties || null };
  if (id) await db.update(products).set(values).where(eq(products.id, id));
  else await db.insert(products).values({ ...values, line: "tulpan", unit: "stem", packSize: DEFAULT_SETTINGS.pack_size });
  return ok;
}

// The plan is typed while the season is being planned or for a color without a plan; later changes are adjustments
export async function setPlans(seasonId: string, packs: Map<string, number>): Promise<Res> {
  const season = await getSeason(seasonId);
  if (!season) return no("Сезон не найден");
  if ([...packs.values()].some((n) => !Number.isInteger(n) || n < 0)) return no("План — целое число пачек");
  const ids = [...packs.keys()];
  const ps = await db.select().from(products).where(inArray(products.id, ids));
  const existing = await db.select().from(stockPlans).where(and(eq(stockPlans.seasonId, seasonId), inArray(stockPlans.productId, ids)));
  const stems = (id: string) => packs.get(id)! * ps.find((p) => p.id === id)!.packSize;
  if (season.status !== "planning" && existing.some((e) => stems(e.productId) !== e.plannedStems))
    return no("Сезон открыт: план меняется только корректировкой с причиной");
  for (const p of ps) {
    const plannedStems = stems(p.id);
    await db
      .insert(stockPlans)
      .values({ seasonId, productId: p.id, plannedStems })
      .onConflictDoUpdate({ target: [stockPlans.seasonId, stockPlans.productId], set: { plannedStems } });
  }
  return ok;
}

export async function addAdjustment(seasonId: string, productId: string, deltaStems: number, reason: string, userId: string): Promise<Res> {
  if (!Number.isInteger(deltaStems) || deltaStems === 0) return no("Корректировка — целое число штук, не ноль");
  if (!reason) return no("Укажите причину корректировки");
  await db.insert(stockAdjustments).values({ seasonId, productId, deltaStems, reason, createdBy: userId });
  return ok;
}
