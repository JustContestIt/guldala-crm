import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink, Field } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { cellName, toMatrix, TYPES } from "@/lib/grid";
import { SEASON_STATUS } from "@/lib/settings";
import { getSeason, seasonRules } from "@/services/catalog";
import { saveGridAction, seasonStatusAction, updateSeasonAction } from "../../actions";

export const metadata: Metadata = { title: "Сезон" };

export default async function SeasonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const season = /^[0-9a-f-]{36}$/i.test(id) ? await getSeason(id) : null;
  if (!season) notFound();
  const rules = await seasonRules(id);
  const s = season.settings;
  const grid = toMatrix(rules);
  const bands = [...grid.bands, null]; // + a blank one for a new band
  const periods = [...grid.periods, null];

  return (
    <div className="space-y-4">
      <BackLink href="/settings">Сезоны</BackLink>
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

      {/* the name in sight, the rest folded; the fields inside a closed <details> are still sent (review 09.11.2026, К12) */}
      <ActionForm action={updateSeasonAction} className="card space-y-3">
        <input type="hidden" name="id" value={season.id} />
        <Field label="Название сезона">
          <input name="name" className="input text-lg font-semibold" defaultValue={season.name} required />
        </Field>
        <details>
          <summary className="font-semibold">Даты и параметры</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
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
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="ready_status_enabled" defaultChecked={s.ready_status_enabled} className="size-5" />
            Колонка «На выдачу»: заказ собран, ждёт клиента
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="issue_on_full_payment_allowed" defaultChecked={s.issue_on_full_payment_allowed} className="size-5" />
            Выдавать бронь без предоплаты при полной оплате на месте
          </label>
          </div>
        </details>
        <Submit>Сохранить</Submit>
      </ActionForm>

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

    </div>
  );
}
