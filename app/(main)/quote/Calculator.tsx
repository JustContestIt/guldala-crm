"use client";

import { useState } from "react";
import { createOrderAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { LinesEditor } from "@/components/LinesEditor";
import { Field } from "@/components/ui";
import type { Rule } from "@/lib/calc";
import { dm, normalizePhone, tenge } from "@/lib/format";
import { computeQuote, type LineState, type ProductOpt } from "@/lib/quote";
import { hoursFor, pctOptions, type SeasonSettings } from "@/lib/settings";

type Client = { phone: string; name: string; company: string | null; email: string | null };

// «Вручную»: the price as Tatiana types, then one of the three ways to book it (review 09.11.2026, К28).
// Controlled only where the screen reacts while typing: phone → known client, lines / % / date → price and hours
export function Calculator(p: {
  products: ProductOpt[];
  rules: Rule[];
  settings: SeasonSettings;
  today: string;
  pickupFrom: string;
  pickupTo: string;
  clients: Client[];
  phone: string;
}) {
  const s = p.settings;
  const [lines, setLines] = useState<LineState[]>([{ key: "classic", packs: 4 }]);
  const [pct, setPct] = useState(s.prepayment_min_pct);
  const [date, setDate] = useState("");
  const [pay, setPay] = useState<"paid" | "invoice">("paid");
  const [c, setC] = useState(() => ({ phone: p.phone, name: "", company: "", email: "", ...fill(p.clients, p.phone) }));
  const known = p.clients.some((x) => x.phone === normalizePhone(c.phone));
  const onPhone = (phone: string) => setC((x) => ({ ...x, phone, ...fill(p.clients, phone, x) }));
  const q = computeQuote({ ...p, lines, pct, date: date || null });

  const warnings = [
    ...q.problems,
    ...q.priced.missing.map((t) => `Нет цены на сегодня для ${t === "classic" ? "классики" : "махровых"} — проверьте сетку`),
    ...q.shortages,
  ];
  const ready = q.allColored && !warnings.length;

  return (
    <ActionForm action={createOrderAction} className="space-y-4">
      {/* Enter in a field would press the first button and book a hold nobody chose */}
      <div className="contents" onKeyDown={(e) => e.key === "Enter" && e.target instanceof HTMLInputElement && e.preventDefault()}>
        <input type="hidden" name="lines" value={q.rows.map((r) => `${r.productId}:${r.qtyPacks}`).join(",")} />
        <input type="hidden" name="pct" value={pct} />

        <section className="card space-y-3">
          <Field label="Телефон клиента">
            <input
              name="phone"
              type="tel"
              inputMode="tel"
              list="clients"
              value={c.phone}
              onChange={(e) => onPhone(e.target.value)}
              placeholder="+7 777 000 00 00"
              className="input"
              required
            />
            <datalist id="clients">
              {p.clients.map((x) => (
                <option key={x.phone} value={x.phone}>
                  {[x.name, x.company].filter(Boolean).join(", ")}
                </option>
              ))}
            </datalist>
          </Field>
          {known && <p className="text-sm text-accent">Клиент уже есть в базе</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Имя">
              <input name="name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} className="input" />
            </Field>
            <Field label="Магазин / компания">
              <input name="company" value={c.company} onChange={(e) => setC({ ...c, company: e.target.value })} className="input" />
            </Field>
          </div>
          <Field label="Почта (необязательно): сюда придёт подтверждение">
            <input name="email" type="email" inputMode="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} className="input" />
          </Field>
        </section>

        <LinesEditor lines={lines} onChange={setLines} products={p.products} allowAny prices={q.prices} />

        <section className="card space-y-3">
          <div>
            <span className="label">Предоплата</span>
            <div className="flex gap-1" role="group" aria-label="Предоплата">
              {pctOptions(s).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPct(v)}
                  aria-pressed={v === pct}
                  className={`btn min-h-10 min-w-0 flex-1 px-0 text-xs ${v === pct ? "btn-primary" : ""}`}
                >
                  {v}%
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Дата выдачи">
              <input name="pickupDate" type="date" value={date} min={p.pickupFrom} max={p.pickupTo} onChange={(e) => setDate(e.target.value)} className="input" />
            </Field>
            <Field label={`Время (${hoursFor(s, date || null)})`}>
              <input name="pickupTime" type="time" className="input" />
            </Field>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer py-1 text-accent">Вывоз, откуда заказ, комментарии</summary>
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap gap-4">
                {[
                  ["self_pickup", "Самовывоз"],
                  ["client_truck", "Машина клиента"],
                ].map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="radio" name="pickupMethod" value={v} defaultChecked={v === "self_pickup"} className="size-5" />
                    {label}
                  </label>
                ))}
              </div>
              <Field label="Откуда заказ">
                <select name="channel" className="input">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                  <option value="telegram">Telegram</option>
                  <option value="phone">Звонок</option>
                  <option value="in_person">Лично</option>
                </select>
              </Field>
              <Field label="Комментарий клиента">
                <textarea name="commentClient" rows={2} className="input" />
              </Field>
              <Field label="Внутренний комментарий (клиент не видит)">
                <textarea name="commentInternal" rows={2} className="input" />
              </Field>
            </div>
          </details>
        </section>

        {/* the prepayment and the rest are what the client asks about: big, apart from each other (review 09.11.2026, К26) */}
        <div className="card space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-extrabold">Итого</span>
            <span className="text-3xl font-extrabold tabular-nums">{tenge(q.total)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 rounded-xl bg-mint px-3 py-2 text-accent-dark">
            <span className="text-lg font-semibold">Предоплата {pct}%</span>
            <span className="text-2xl font-extrabold tabular-nums">{tenge(q.prepayment)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-3">
            <span className="text-lg font-semibold">Остаток оплаты при выдаче</span>
            <span className="text-xl font-bold tabular-nums">{tenge(q.total - q.prepayment)}</span>
          </div>
          {q.priced.validUntil && <p className="px-3 font-semibold">Цена действует до {dm(q.priced.validUntil)}</p>}
        </div>

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-warn-bg p-3 text-sm text-warn">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {!q.allColored ? (
          <p className="text-center text-sm text-muted">Чтобы оформить заказ, выберите цвет в каждой строке</p>
        ) : (
          <div className={`space-y-3 ${ready ? "" : "pointer-events-none opacity-50"}`}>
            <section className="card space-y-2">
              <h2>Бронь без предоплаты</h2>
              <p className="text-sm text-muted">
                Цветы отложены на {s.hold_days} дн.{s.price_lock_on === "confirmed" && ", цена по сетке сегодняшнего дня держится всю бронь при любом % предоплаты"}. Не внесут
                предоплату — бронь снимется сама, цветы вернутся на склад.
              </p>
              <Submit name="start" value="hold" className="w-full">
                Оформить бронь
              </Submit>
            </section>
            <section className="card space-y-2">
              <h2>
                Предоплата {pct}% · <span className="tabular-nums">{tenge(q.prepayment)}</span>
              </h2>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Как внесена предоплата">
                {(
                  [
                    ["paid", "Внесено наличными"],
                    ["invoice", "Выставить счёт Kaspi"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={pay === v}
                    onClick={() => setPay(v)}
                    className={`btn min-h-11 px-2 text-sm ${pay === v ? "border-accent bg-mint text-accent-dark" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted">
                {pay === "paid"
                  ? "Заказ сразу станет «Предоплачен»."
                  : `Заказ встанет в «Бронь» с пометкой «Ожидается оплата». Выставьте счёт на ${tenge(q.prepayment)} в приложении Kaspi на номер клиента, а когда деньги придут, нажмите в заказе «Оплачено».`}
              </p>
              <Submit
                name="start"
                value={pay}
                className="btn-primary w-full"
                confirm={pay === "paid" ? `Предоплата ${tenge(q.prepayment)} наличными получена?` : undefined}
              >
                Создать заказ
              </Submit>
            </section>
          </div>
        )}

        <section className="card space-y-1">
          <h2>Подтверждение клиенту</h2>
          <p className="text-sm text-muted">Текст появится, когда заказ будет создан: что забронировано, что оплачено, что ждём.</p>
        </section>
      </div>
    </ActionForm>
  );
}

// A known phone fills the empty fields from the client base
function fill(list: Client[], phone: string, now?: { name: string; company: string; email: string }) {
  const k = list.find((x) => x.phone === normalizePhone(phone));
  if (!k) return {};
  return {
    ...(!now?.name && { name: k.name }),
    ...(!now?.company && { company: k.company ?? "" }),
    ...(!now?.email && { email: k.email ?? "" }),
  };
}
