import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink, Field } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { SEASON_STATUS } from "@/lib/settings";
import { getSeason } from "@/services/catalog";
import { seasonStatusAction, updateSeasonAction } from "../../actions";

export const metadata: Metadata = { title: "Сезон" };

export default async function SeasonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const season = /^[0-9a-f-]{36}$/i.test(id) ? await getSeason(id) : null;
  if (!season) notFound();
  const s = season.settings;

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
          <Field label="Минимум, шт" className="col-span-2">
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

      {/* the grid has its own page in «Настройки» (review 09.11.2026, К13) */}
      <Link href={`/settings/prices?season=${season.id}`} className="card block font-semibold text-accent">
        Сетка цен этого сезона →
      </Link>

    </div>
  );
}
