import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { db } from "@/db";
import { products, stockAdjustments, users } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { dmhm } from "@/lib/format";
import { cellName, toMatrix, TYPES } from "@/lib/grid";
import { SEASON_STATUS } from "@/lib/settings";
import { getSeason, seasonRules, stockTable } from "@/services/catalog";
import { expireHolds } from "@/services/orders";
import { addAdjustmentAction, saveGridAction, seasonStatusAction, setPlansAction, updateSeasonAction } from "../../actions";

export const metadata: Metadata = { title: "Сезон" };

export default async function SeasonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const season = /^[0-9a-f-]{36}$/i.test(id) ? await getSeason(id) : null;
  if (!season) notFound();
  await expireHolds();
  const [rules, stock, history] = await Promise.all([
    seasonRules(id),
    stockTable(id),
    db
      .select({ a: stockAdjustments, product: products.name, by: users.name })
      .from(stockAdjustments)
      .innerJoin(products, eq(products.id, stockAdjustments.productId))
      .leftJoin(users, eq(users.id, stockAdjustments.createdBy))
      .where(eq(stockAdjustments.seasonId, id))
      .orderBy(desc(stockAdjustments.createdAt)),
  ]);
  const s = season.settings;
  const grid = toMatrix(rules);
  const bands = [...grid.bands, null]; // + a blank one for a new band
  const periods = [...grid.periods, null];
  const packs = (stems: number, size: number) => Math.floor(stems / size);
  const planEditable = (planned: number | null) => season.status === "planning" || planned === null;

  return (
    <div className="space-y-4">
      <Link href="/settings" className="text-sm text-muted">
        ← Сезоны
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{season.name}</h1>
        <ActionForm action={seasonStatusAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={season.id} />
          <span className="text-sm text-muted">{SEASON_STATUS[season.status]}</span>
          {season.status !== "open" && (
            <button name="status" value="open" className="btn btn-primary">
              Открыть приём
            </button>
          )}
          {season.status === "open" && (
            <button name="status" value="closed" className="btn">
              Закрыть сезон
            </button>
          )}
          {season.status === "closed" && (
            <button name="status" value="planning" className="btn">
              В планирование
            </button>
          )}
        </ActionForm>
      </div>

      <details className="card">
        <summary className="font-semibold">Даты и параметры</summary>
        <ActionForm action={updateSeasonAction} className="mt-3 grid grid-cols-2 gap-3">
          <input type="hidden" name="id" value={season.id} />
          <Field label="Название" className="col-span-2">
            <input name="name" className="input" defaultValue={season.name} required />
          </Field>
          <Field label="Приём заказов с">
            <input name="ordersOpenFrom" type="date" className="input" defaultValue={season.ordersOpenFrom} required />
          </Field>
          <Field label="Пиковая дата">
            <input name="peakDate" type="date" className="input" defaultValue={season.peakDate} required />
          </Field>
          <Field label="Выдача с">
            <input name="pickupFrom" type="date" className="input" defaultValue={season.pickupFrom} required />
          </Field>
          <Field label="Выдача по">
            <input name="pickupTo" type="date" className="input" defaultValue={season.pickupTo} required />
          </Field>
          <Field label="Часы выдачи">
            <input name="pickup_hours" className="input" defaultValue={s.pickup_hours} />
          </Field>
          <Field label="Часы в пик">
            <input name="pickup_hours_peak" className="input" defaultValue={s.pickup_hours_peak} />
          </Field>
          <Field label="Пиковые часы с" className="col-span-2">
            <input name="peak_hours_from" type="date" className="input" defaultValue={s.peak_hours_from} />
          </Field>
          <Field label="Пачка, шт">
            <input name="pack_size" inputMode="numeric" className="input" defaultValue={s.pack_size} />
          </Field>
          <Field label="Минимум, шт">
            <input name="min_order_stems" inputMode="numeric" className="input" defaultValue={s.min_order_stems} />
          </Field>
          <Field label="Минимум считать" className="col-span-2">
            <select name="min_order_scope" className="input" defaultValue={s.min_order_scope}>
              <option value="total">в сумме по заказу</option>
              <option value="per_color">на каждый цвет</option>
            </select>
          </Field>
          <Field label="Бронь без предоплаты, дней">
            <input name="hold_days" inputMode="numeric" className="input" defaultValue={s.hold_days} />
          </Field>
          <Field label="На сайте «мало» ниже, % плана">
            <input name="stock_few_below_pct" inputMode="numeric" className="input" defaultValue={s.stock_few_below_pct ?? 30} />
          </Field>
          <Field label="Проверка от, ₸">
            <input name="check_threshold_amount" inputMode="numeric" className="input" defaultValue={s.check_threshold_amount} />
          </Field>
          <Field label="Предоплата от, %">
            <input name="prepayment_min_pct" inputMode="numeric" className="input" defaultValue={s.prepayment_min_pct} />
          </Field>
          <Field label="Предоплата до, %">
            <input name="prepayment_max_pct" inputMode="numeric" className="input" defaultValue={s.prepayment_max_pct} />
          </Field>
          <Field label="Шаг предоплаты, %">
            <input name="prepayment_step" inputMode="numeric" className="input" defaultValue={s.prepayment_step} />
          </Field>
          <Field label="Цена фиксируется">
            <select name="price_lock_on" className="input" defaultValue={s.price_lock_on}>
              <option value="prepaid">при предоплате</option>
              <option value="confirmed">при подтверждении</option>
            </select>
          </Field>
          <Field label="Напоминания клиентам" className="col-span-2">
            <select name="client_notifications" className="input" defaultValue={s.client_notifications}>
              <option value="manual">вручную, по кнопке</option>
              <option value="auto">автоматически</option>
            </select>
          </Field>
          <Field label="Ассистент в WhatsApp" className="col-span-2">
            <select name="assistant_mode" className="input" defaultValue={s.assistant_mode ?? "off"}>
              <option value="off">выключен</option>
              <option value="draft">черновики — отправляет Татьяна</option>
              <option value="auto">отвечает сам</option>
            </select>
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="ready_status_enabled" defaultChecked={s.ready_status_enabled} className="size-5" />
            Статус «Готов к выдаче»
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="issue_on_full_payment_allowed" defaultChecked={s.issue_on_full_payment_allowed} className="size-5" />
            Выдавать бронь без предоплаты при полной оплате на месте
          </label>
          <div className="col-span-2">
            <Submit>Сохранить</Submit>
          </div>
        </ActionForm>
      </details>

      <section className="card space-y-3">
        <h2>Сетка цен, ₸ за штуку</h2>
        <p className="text-sm text-muted">
          Период заказа × полоса предоплаты × тип. Пустая клетка — цены нет. Пустые полоса и период внизу — для новых.
        </p>
        <ActionForm action={saveGridAction} className="space-y-3">
          <input type="hidden" name="seasonId" value={season.id} />
          <fieldset className="space-y-2">
            <legend className="label">Полосы предоплаты, %</legend>
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <input name="bmin" inputMode="numeric" aria-label="Предоплата от, %" placeholder="от" defaultValue={b?.min} className="input w-20" />
                <span>–</span>
                <input name="bmax" inputMode="numeric" aria-label="Предоплата до, %" placeholder="до" defaultValue={b?.max} className="input w-20" />
                {b ? (
                  <label className="flex items-center gap-1 text-sm text-muted">
                    <input type="checkbox" name="delb" value={i} className="size-5" />
                    удалить
                  </label>
                ) : (
                  <span className="text-sm text-muted">новая</span>
                )}
              </div>
            ))}
          </fieldset>
          {periods.map((p, j) => (
            <fieldset key={j} className="space-y-2 rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{p ? `Период ${j + 1}` : "Новый период"}</legend>
              <div className="grid grid-cols-2 gap-2">
                <input name="pfrom" type="date" aria-label="Период с" defaultValue={p?.from} className="input" />
                <input name="pto" type="date" aria-label="Период по" defaultValue={p?.to} className="input" />
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="pr-2 font-normal">Предоплата</th>
                    <th className="font-normal">Классика</th>
                    <th className="font-normal">Махровые</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b, i) => (
                    <tr key={i}>
                      <td className="pr-2 text-muted">{b ? `${b.min}–${b.max}` : "новая"}</td>
                      {TYPES.map((t) => (
                        <td key={t} className="py-1 pr-2">
                          <input
                            name={cellName(t, j, i)}
                            inputMode="numeric"
                            aria-label={`${t === "classic" ? "Классика" : "Махровые"}, ${b ? `${b.min}–${b.max} %` : "новая полоса"}`}
                            defaultValue={p && b ? grid.cells.get(cellName(t, j, i)) : undefined}
                            className="input min-h-10 py-1 font-semibold"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {p && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" name="delp" value={j} className="size-5" />
                  удалить период
                </label>
              )}
            </fieldset>
          ))}
          <Submit>Сохранить сетку</Submit>
        </ActionForm>
      </section>

      <section className="card space-y-3">
        <h2>Остатки по цветам, пачек</h2>
        <ActionForm action={setPlansAction} className="space-y-3">
          <input type="hidden" name="seasonId" value={season.id} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-2 font-normal">Цвет</th>
                  <th className="px-1 font-normal">Свободно</th>
                  <th className="px-1 font-normal">План</th>
                  <th className="px-1 font-normal">Резерв</th>
                  <th className="px-1 font-normal">Выдано</th>
                  <th className="pl-1 font-normal">Корр.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stock.map((r) => {
                  const size = r.product.packSize;
                  const low = r.planned !== null && r.available < r.planned * 0.1;
                  return (
                    <tr key={r.product.id} className={r.product.isActive ? "" : "text-muted"}>
                      <td className="py-2 pr-2">{r.product.name}</td>
                      <td className={`px-1 font-semibold ${low ? "text-up" : ""}`}>{packs(Math.max(0, r.available), size)}</td>
                      <td className="px-1">
                        {planEditable(r.planned) ? (
                          <input
                            name={`plan:${r.product.id}`}
                            inputMode="numeric"
                            aria-label={`План, пачек: ${r.product.name}`}
                            className="input w-20 min-h-9 py-1"
                            defaultValue={r.planned === null ? "" : packs(r.planned, size)}
                          />
                        ) : (
                          packs(r.planned!, size)
                        )}
                      </td>
                      <td className="px-1">{packs(r.reserved, size)}</td>
                      <td className="px-1">{packs(r.issued, size)}</td>
                      <td className="pl-1">{r.adjusted ? `${r.adjusted > 0 ? "+" : ""}${r.adjusted} шт` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stock.some((r) => planEditable(r.planned)) && <Submit>Сохранить план</Submit>}
        </ActionForm>

        <details>
          <summary className="text-sm font-semibold">Корректировка остатка</summary>
          <ActionForm action={addAdjustmentAction} className="mt-3 grid grid-cols-2 gap-3">
            <input type="hidden" name="seasonId" value={season.id} />
            <Field label="Цвет" className="col-span-2">
              <select name="productId" className="input" required>
                {stock.map((r) => (
                  <option key={r.product.id} value={r.product.id}>
                    {r.product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="± штук">
              <input name="delta" inputMode="numeric" className="input" placeholder="-30" required />
            </Field>
            <Field label="Причина">
              <input name="reason" className="input" placeholder="пересорт, списание…" required />
            </Field>
            <div className="col-span-2">
              <Submit>Записать</Submit>
            </div>
          </ActionForm>
        </details>

        {history.length > 0 && (
          <ul className="space-y-1 text-sm">
            {history.map(({ a, product, by }) => (
              <li key={a.id} className="text-muted">
                {dmhm(a.createdAt)} · {product} {a.deltaStems > 0 ? "+" : ""}
                {a.deltaStems} шт · {a.reason}
                {by && ` · ${by}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
