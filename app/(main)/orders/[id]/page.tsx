import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  cancelAction,
  commentAction,
  discountAction,
  editItemsAction,
  extendHoldAction,
  invoiceAction,
  issueAction,
  paymentAction,
  statusAction,
  substituteAction,
} from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Composer } from "@/components/Composer";
import { Field, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { describeEvent } from "@/lib/events";
import { almatyDay, dm, dmhm, hhmm, prettyPhone, tenge } from "@/lib/format";
import { ORDER_TEMPLATES, orderText, type OrderTemplate } from "@/lib/templates";
import { tulips } from "@/services/catalog";
import { orderCard, orderView } from "@/services/orders";

export const metadata: Metadata = { title: "Заказ" };

const METHOD = { kaspi_invoice: "Kaspi", cash: "Наличные", bank_transfer: "Перевод" } as const;
const PAY_STATUS = { pending: "ждём оплату", paid: "оплачено", cancelled: "отменён" } as const;

// "2 дн 5 ч" / "40 мин" until the hold runs out
function left(until: Date) {
  const min = Math.round((until.getTime() - Date.now()) / 60_000);
  if (min <= 0) return "истекает";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return d ? `${d} дн ${h} ч` : h ? `${h} ч ${min % 60} мин` : `${min} мин`;
}

// datetime-local value in Almaty time (UTC+5 all year)
const localInput = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 16);

function Panel({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <details className="card">
      <summary className={`font-semibold ${danger ? "text-up" : ""}`}>{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const user = await requireUser();
  const [{ id }, { msg }] = await Promise.all([params, searchParams]);
  const card = await orderCard(id);
  if (!card) notFound();
  const { order: o, client, items, payments, events, season, money: m } = card;
  const s = season.settings;
  const owner = user.role === "owner";
  const editable = ["new", "confirmed", "prepaid", "ready"].includes(o.status);
  const allProducts = editable ? (await tulips()).filter((p) => p.isActive) : [];

  const view = orderView(card);
  const templates = (Object.keys(ORDER_TEMPLATES) as OrderTemplate[])
    .filter((k) => k !== "ready" || s.ready_status_enabled)
    .map((k) => ({ key: k, label: ORDER_TEMPLATES[k], text: orderText(k, view) }));
  const composer = (
    <section id="msg" className="card space-y-2">
      <h2>Написать клиенту</h2>
      <Composer
        key={templates.map((t) => t.text).join("|")} // the order changed → fresh texts, not the old draft
        templates={templates}
        phone={client.phone}
        orderId={o.id}
        initial={msg}
      />
    </section>
  );
  const payDefault = o.status === "confirmed" && m.prepaymentDue > 0 ? m.prepaymentDue : m.balance;

  return (
    <div className="space-y-4">
      <Link href="/orders" className="text-sm text-muted">
        ← Заказы
      </Link>

      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="tabular-nums">{o.number}</h1>
          <StatusBadge status={o.status} />
        </div>
        <p className="font-semibold">{[client.company, client.name].filter(Boolean).join(" · ") || "Без имени"}</p>
        <p className="flex flex-wrap gap-3 text-sm">
          <a href={`tel:${client.phone}`} className="text-accent underline">
            {prettyPhone(client.phone)}
          </a>
          <a href={`https://wa.me/${client.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            WhatsApp
          </a>
        </p>
      </header>

      {msg && composer}

      <section className="card space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Сумма</span>
          <span className="text-2xl font-extrabold tabular-nums">{tenge(o.total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Оплачено</span>
          <span className="tabular-nums">{tenge(m.paid)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Предоплата {o.prepaymentPct}%</span>
          <span className="tabular-nums">
            {tenge(m.prepayment)}
            {m.prepaymentDue > 0 && o.status === "confirmed" && <span className="text-up"> · осталось {tenge(m.prepaymentDue)}</span>}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">К оплате</span>
          <b className="tabular-nums">{tenge(m.balance)}</b>
        </div>
        {o.status === "confirmed" && o.holdUntil && (
          <div className="flex justify-between">
            <span className="text-muted">Бронь до</span>
            <b>
              {dmhm(o.holdUntil)} · {left(o.holdUntil)}
            </b>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Цена</span>
          <span>{o.priceLockedAt ? `зафиксирована ${dm(almatyDay(o.priceLockedAt))}` : "по сетке на сегодня"}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Выдача</span>
          <span className="text-right">
            {o.pickupDate ? `${dm(o.pickupDate)}${o.pickupTime ? ` ${hhmm(o.pickupTime)}` : ""}` : "дата не задана"}
            {o.pickupMethod === "client_truck" ? ", машина клиента" : ", самовывоз"}
            {o.storageRequested && ", холодильник"}
          </span>
        </div>
        {o.status === "cancelled" && o.cancelReason && <p className="text-up">Отменён: {o.cancelReason}</p>}
      </section>

      <section className="card space-y-2">
        <h2>Состав</h2>
        <ul className="divide-y divide-line text-sm">
          {items.map((i) => (
            <li key={i.id} className="py-2">
              <div className="flex justify-between gap-2">
                <span className={i.substituteName ? "text-muted line-through" : "font-medium"}>{i.name}</span>
                <b className="tabular-nums">{tenge(i.lineTotal)}</b>
              </div>
              {i.substituteName && (
                <p className="font-medium">
                  → {i.substituteName}
                  {i.substitutionNote && <span className="font-normal text-muted"> · {i.substitutionNote}</span>}
                </p>
              )}
              <p className="text-muted">
                {i.qtyPacks} пач. × {i.packSize} шт × {tenge(i.unitPrice)}
                {i.issuedStems > 0 && o.status !== "issued" && ` · выдано ${i.issuedStems} шт`}
              </p>
            </li>
          ))}
        </ul>
        {o.discountAmount > 0 && (
          <p className="flex justify-between text-sm">
            <span className="text-muted">Скидка{o.discountReason && ` · ${o.discountReason}`}</span>
            <span className="tabular-nums">−{tenge(o.discountAmount)}</span>
          </p>
        )}
      </section>

      <div className="space-y-2">
        {o.status === "new" && (
          <ActionForm action={statusAction}>
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="op" value="confirm" />
            <Submit className="btn-primary w-full">Подтвердить бронь</Submit>
          </ActionForm>
        )}
        {o.status === "expired" && (
          <ActionForm action={statusAction}>
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="op" value="resume" />
            <Submit className="btn-primary w-full">Возобновить бронь по сегодняшней цене</Submit>
          </ActionForm>
        )}
        {o.status === "prepaid" && s.ready_status_enabled && (
          <ActionForm action={statusAction}>
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="op" value="ready" />
            <Submit className="w-full">Готов к выдаче</Submit>
          </ActionForm>
        )}

        {["confirmed", "prepaid", "ready", "issued"].includes(o.status) && m.balance > 0 && (
          <Panel title="Отметить оплату">
            <ActionForm action={paymentAction} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="id" value={o.id} />
              <Field label="Сумма, ₸">
                <input name="amount" inputMode="numeric" defaultValue={payDefault} className="input" required />
              </Field>
              <Field label="Способ">
                <select name="method" className="input">
                  <option value="kaspi_invoice">Kaspi</option>
                  <option value="cash">Наличные</option>
                </select>
              </Field>
              <Field label="Номер счёта Kaspi">
                <input name="invoiceRef" className="input" />
              </Field>
              <Field label="Заметка">
                <input name="note" className="input" />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" name="pending" className="size-5" />
                Счёт только выставлен, ждём оплату
              </label>
              <div className="col-span-2">
                <Submit>Записать</Submit>
              </div>
            </ActionForm>
          </Panel>
        )}

        {(o.status === "prepaid" || o.status === "ready") && (
          <Panel title="Выдать">
            <ActionForm action={issueAction}>
              <input type="hidden" name="id" value={o.id} />
              {m.balance > 0 ? (
                <Field label={`Принять остаток ${tenge(m.balance)}`}>
                  <select name="method" className="input">
                    <option value="cash">Наличные</option>
                    <option value="kaspi_invoice">Kaspi</option>
                  </select>
                </Field>
              ) : (
                <p className="text-sm text-muted">Оплачен полностью.</p>
              )}
              <Submit confirm={`Выдать ${o.number} целиком?`}>Выдано</Submit>
            </ActionForm>
          </Panel>
        )}

        {o.status === "confirmed" && o.holdUntil && (
          <Panel title="Продлить бронь">
            <ActionForm action={extendHoldAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={o.id} />
              <Field label="Новый срок" className="flex-1">
                <input name="until" type="datetime-local" defaultValue={localInput(new Date(o.holdUntil.getTime() + s.hold_days * 86_400_000))} className="input" />
              </Field>
              <Submit>Продлить</Submit>
            </ActionForm>
          </Panel>
        )}

        {editable && owner && (
          <Panel title="Изменить состав">
            <ActionForm action={editItemsAction}>
              <input type="hidden" name="id" value={o.id} />
              {o.priceLockedAt && <p className="text-sm text-muted">Цена зафиксирована: добавленные пачки пойдут по сегодняшней сетке отдельной строкой.</p>}
              {items.map((i) => (
                <Field key={i.id} label={`${i.substituteName ?? i.name}, пачек (0 — убрать)`}>
                  <input name={`qty:${i.id}`} inputMode="numeric" defaultValue={i.qtyPacks} className="input" />
                </Field>
              ))}
              {[0, 1].map((n) => (
                <div key={n} className="grid grid-cols-3 gap-2">
                  <select name="addProduct" aria-label="Добавить цвет" className="input col-span-2" defaultValue="">
                    <option value="">+ добавить цвет</option>
                    {allProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input name="addPacks" inputMode="numeric" aria-label="Пачек" placeholder="пач." className="input" />
                </div>
              ))}
              <Submit>Сохранить состав</Submit>
            </ActionForm>
          </Panel>
        )}

        {editable && (
          <Panel title="Замена цвета">
            <div className="space-y-4">
              {items.map((i) => (
                <ActionForm key={i.id} action={substituteAction} className="grid grid-cols-2 gap-2">
                  <input type="hidden" name="itemId" value={i.id} />
                  <Field label={i.name} className="col-span-2">
                    <select name="substituteId" defaultValue={i.substituteProductId ?? ""} className="input">
                      <option value="">без замены</option>
                      {allProducts
                        .filter((p) => p.tulipType === i.tulipType && p.id !== i.productId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <input name="note" defaultValue={i.substitutionNote ?? ""} placeholder="согласовано с клиентом…" aria-label="Пометка" className="input" />
                  <Submit>Сохранить</Submit>
                </ActionForm>
              ))}
            </div>
          </Panel>
        )}

        {owner && !["issued", "cancelled"].includes(o.status) && (
          <Panel title="Скидка">
            <ActionForm action={discountAction} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="id" value={o.id} />
              <Field label="Скидка, ₸">
                <input name="amount" inputMode="numeric" defaultValue={o.discountAmount} className="input" />
              </Field>
              <Field label="Причина">
                <input name="reason" defaultValue={o.discountReason ?? ""} className="input" />
              </Field>
              <div className="col-span-2">
                <Submit>Сохранить скидку</Submit>
              </div>
            </ActionForm>
          </Panel>
        )}

        {["new", "confirmed", "prepaid", "ready"].includes(o.status) && (
          <Panel title="Отменить заказ" danger>
            <ActionForm action={cancelAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={o.id} />
              <Field label="Причина" className="flex-1">
                <input name="reason" className="input" required />
              </Field>
              <Submit className="btn-danger" confirm={`Отменить ${o.number}?`}>
                Отменить
              </Submit>
            </ActionForm>
          </Panel>
        )}
      </div>

      {!msg && composer}

      {payments.length > 0 && (
        <section className="card space-y-2">
          <h2>Платежи</h2>
          <ul className="divide-y divide-line text-sm">
            {payments.map((p) => (
              <li key={p.id} className="py-2">
                <div className="flex justify-between gap-2">
                  <span>
                    {METHOD[p.method]}
                    {p.invoiceRef && ` · ${p.invoiceRef}`} · <span className={p.status === "pending" ? "text-warn" : "text-muted"}>{PAY_STATUS[p.status]}</span>
                  </span>
                  <b className={`tabular-nums ${p.status === "cancelled" ? "text-muted line-through" : ""}`}>
                    {p.kind === "refund" ? "−" : ""}
                    {tenge(p.amount)}
                  </b>
                </div>
                <p className="text-muted">
                  {dmhm(p.paidAt ?? p.createdAt)}
                  {p.note && ` · ${p.note}`}
                </p>
                {p.status === "pending" && (
                  <ActionForm action={invoiceAction} className="mt-2 flex gap-2">
                    <input type="hidden" name="paymentId" value={p.id} />
                    <button name="op" value="paid" className="btn btn-primary min-h-9 text-xs">
                      Оплачено
                    </button>
                    <button name="op" value="cancel" className="btn min-h-9 text-xs">
                      Отменить счёт
                    </button>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-2">
        {o.commentClient && (
          <p className="text-sm">
            <span className="text-muted">Клиент: </span>
            {o.commentClient}
          </p>
        )}
        <ActionForm action={commentAction} className="space-y-2">
          <input type="hidden" name="id" value={o.id} />
          <Field label="Внутренний комментарий">
            <textarea name="comment" rows={2} defaultValue={o.commentInternal} className="input" />
          </Field>
          <Submit className="min-h-9 text-xs">Сохранить</Submit>
        </ActionForm>
      </section>

      <section className="card space-y-2">
        <h2>Журнал</h2>
        <ul className="space-y-1.5 text-sm">
          {events.map(({ e, actor }) => (
            <li key={e.id}>
              <span className="text-muted">{dmhm(e.createdAt)}</span> {describeEvent(e)}
              <span className="text-muted"> · {actor ?? (e.actorType === "system" ? "система" : "клиент")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
