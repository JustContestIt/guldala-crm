"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type User } from "@/lib/auth";
import { dm } from "@/lib/format";
import { day, hm, int, oneOf, str, uuid, type FormState } from "@/lib/form";
import { messaging } from "@/integrations/messaging";
import { CLIENT_TYPES, updateClient, type ClientType } from "@/services/clients";
import { deleteDraft, sendDraft, sendMessage, setAssistantMuted } from "@/services/messages";
import { STATUS_LABEL } from "@/lib/status";
import { sendConfirmation } from "@/services/confirmations";
import * as o from "@/services/orders";
import { createPrefill } from "@/services/public";

const actorOf = (u: User): o.Actor => ({ id: u.id, role: u.role });
const reply = (r: { ok: boolean; error?: string }, ok: string): FormState => (r.ok ? (refresh(), { ok }) : { error: r.error });
const METHODS = ["kaspi_invoice", "cash"] as const;
const noOrder: FormState = { error: "Заказ не найден" };
// The texts say where the card went: they pop up over the board and «Выдача» after the card leaves (review 09.11.2026, К22)
const CLOSED = "он в «Показать истёкшие и отменённые» на доске";
const movedIf = (before?: string, after?: keyof typeof STATUS_LABEL) => (after && after !== before ? `, заказ перемещён в «${STATUS_LABEL[after]}»` : "");

// "id:packs,id:packs" from the lines editor
const parseLines = (s: string) =>
  s
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [productId, packs] = part.split(":");
      return { productId, qtyPacks: Number(packs) };
    })
    .filter((l) => /^[0-9a-f-]{36}$/i.test(l.productId));

// «Вручную»: the button pressed says how the order starts (review 09.11.2026, К28); no button, no order
export async function createOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const start = str(fd, "start");
  if (start !== "hold" && start !== "invoice" && start !== "paid") return { error: "Выберите: бронь, наличные или счёт Kaspi" };
  if (!str(fd, "email", 200)) return { error: "Укажите почту клиента: на неё придёт подтверждение заказа" }; // review 12.11.2026, П1
  const r = await o.createOrder(
    {
      phone: str(fd, "phone", 30),
      name: str(fd, "name", 100),
      company: str(fd, "company", 150),
      email: str(fd, "email", 200),
      lines: parseLines(str(fd, "lines", 2000)),
      pct: int(fd, "pct"),
      pickupDate: day(fd, "pickupDate"),
      pickupTime: hm(fd, "pickupTime"),
      pickupMethod: oneOf(fd, "pickupMethod", ["self_pickup", "delivery"], "self_pickup"),
      storage: false, // no fridge (review 09.11.2026, С2)
      commentClient: str(fd, "commentClient", 2000),
      commentInternal: str(fd, "commentInternal", 2000),
      channel: oneOf(fd, "channel", ["whatsapp", "instagram", "telegram", "phone", "in_person", "site"], "whatsapp"),
      start,
    },
    actorOf(user),
  );
  if (!r.ok) return { error: r.error };
  redirect(`/quote?order=${r.id}`); // the confirmation by fact is written from the saved order (К31)
}

export async function pctAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  return id ? reply(await o.setPrepaymentPct(id, int(fd, "pct"), actor), "Процент предоплаты изменён, цена пересчитана") : noOrder;
}

// «Отправить ещё раз»: the confirmation letter to the client's e-mail (review 09.11.2026, К23)
export async function mailAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  if (!id) return noOrder;
  const r = await sendConfirmation(id, actor);
  return reply(r, r.ok ? `Письмо отправлено на ${r.to}` : "");
}

// One order-id action: confirm, resume, ready
export async function statusAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  if (!id) return noOrder;
  const op = oneOf(fd, "op", ["confirm", "resume", "ready"], "confirm");
  const fn = { confirm: o.confirmOrder, resume: o.resumeOrder, ready: o.markReady }[op];
  return reply(
    await fn(id, actor),
    { confirm: "Заказ подтверждён и перемещён в «Бронь»", resume: "Бронь возобновлена, заказ перемещён в «Бронь»", ready: "Заказ собран и перемещён в «На выдачу»" }[op],
  );
}

export async function cancelAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  return id ? reply(await o.cancelOrder(id, str(fd, "reason", 300), actor), `Заказ отменён: ${CLOSED}`) : noOrder;
}

// datetime-local comes without a zone; Kazakhstan is UTC+5 all year
export async function extendHoldAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  const v = str(fd, "until", 20);
  if (!id) return noOrder;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return { error: "Укажите новый срок" };
  return reply(await o.extendHold(id, new Date(`${v}:00+05:00`), actor), "Бронь продлена");
}

export async function paymentAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  if (!id) return noOrder;
  const paid = fd.get("pending") !== "on";
  const before = await o.orderStatus(id);
  const r = await o.recordPayment(
    id,
    { amount: int(fd, "amount"), method: oneOf(fd, "method", METHODS, "kaspi_invoice"), paid, invoiceRef: str(fd, "invoiceRef", 100), note: str(fd, "note", 300) },
    actor,
  );
  return reply(r, paid ? `Оплата записана${r.ok ? movedIf(before, await o.orderStatus(id)) : ""}` : "Счёт записан, ожидается оплата");
}

export async function invoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "paymentId");
  if (!id) return { error: "Счёт не найден" };
  if (fd.get("op") === "cancel") return reply(await o.cancelInvoice(id, actor), "Счёт отменён");
  const orderId = await o.orderOfPayment(id);
  const before = orderId && (await o.orderStatus(orderId));
  const r = await o.markInvoicePaid(id, actor);
  return reply(r, `Счёт оплачен${r.ok && orderId ? movedIf(before || undefined, await o.orderStatus(orderId)) : ""}`);
}

// Full issue, or partial with packs:<itemId> fields (blank = 0) from the «Выдача» screen
export async function issueAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  if (!id) return noOrder;
  const method = fd.get("method") ? oneOf(fd, "method", METHODS, "cash") : null;
  const packs = fd.get("partial")
    ? Object.fromEntries([...fd.keys()].filter((k) => k.startsWith("packs:")).map((k) => [k.slice(6), str(fd, k) ? int(fd, k) : 0]))
    : undefined;
  return reply(await o.issueOrder(id, method, actor, packs), packs ? "Выдача записана" : "Заказ выдан и перемещён в «Выдан»");
}

export async function noShowAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  const d = day(fd, "day");
  if (!id || !d) return noOrder;
  // review 09.11.2026, К20: the client didn't come — cancelled, the flowers go back on sale, a paid prepayment stays as compensation
  return reply(await o.cancelOrder(id, `Не приехал за заказом ${dm(d)}`, actor), `Заказ отменён, цветы вернулись на склад: ${CLOSED}`);
}

export async function discountAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  return id ? reply(await o.setDiscount(id, int(fd, "amount"), str(fd, "reason", 300), actor), "Скидка сохранена") : noOrder;
}

// Existing lines arrive as qty:<itemId>, additions as parallel addProduct / addPacks lists
export async function editItemsAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  if (!id) return noOrder;
  const existing = [...fd.keys()]
    .filter((k) => k.startsWith("qty:"))
    .map((k) => ({ itemId: k.slice(4), qtyPacks: int(fd, k) }));
  const packs = fd.getAll("addPacks").map((v) => Number(String(v).trim() || 0));
  const added = fd
    .getAll("addProduct")
    .map((p, i) => ({ productId: String(p), qtyPacks: packs[i] }))
    .filter((a) => /^[0-9a-f-]{36}$/i.test(a.productId) && a.qtyPacks);
  if (added.some((a) => !Number.isInteger(a.qtyPacks) || a.qtyPacks < 0)) return { error: "Количество — целое число пачек" };
  return reply(await o.editItems(id, { existing, added }, actor), "Состав изменён");
}

export async function substituteAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const itemId = uuid(fd, "itemId");
  if (!itemId) return { error: "Строка не найдена" };
  return reply(await o.substituteItem(itemId, uuid(fd, "substituteId"), str(fd, "note", 300), actor), "Замена сохранена");
}

export async function commentAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const id = uuid(fd, "id");
  if (!id) return noOrder;
  await o.setInternalComment(id, str(fd, "comment", 2000));
  return (refresh(), { ok: "Сохранено" });
}

export async function clientAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const id = uuid(fd, "id");
  if (!id) return { error: "Клиент не найден" };
  const r = await updateClient(id, {
    name: str(fd, "name", 100),
    company: str(fd, "company", 150),
    email: str(fd, "email", 200),
    clientType: oneOf(fd, "clientType", Object.keys(CLIENT_TYPES) as ClientType[], "flower_shop"),
    notes: str(fd, "notes", 2000),
  });
  return reply(r, "Сохранено");
}

// «Ссылка для заказа» in the Composer: the site form with this client's contacts filled in
export async function prefillLinkAction(phone: string) {
  await requireUser();
  return createPrefill(phone);
}

export async function sendAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const r = await sendMessage(
    { phone: str(fd, "phone", 30), text: str(fd, "text", 4000), templateKey: str(fd, "templateKey", 40), orderId: uuid(fd, "orderId") },
    actor,
  );
  if (!r.ok) return { error: r.error };
  refresh();
  return { ok: messaging().name === "fake" ? "Тестовый режим: Wazzup не подключён, сообщение только записано в журнал" : "Отправлено" };
}

// The assistant's draft in the client card: «Отправить» (as corrected in the field) or «Удалить» (spec §19)
export async function draftAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  if (!id) return { error: "Черновик не найден" };
  if (fd.get("op") === "delete") return reply(await deleteDraft(id), "Черновик удалён");
  const r = await sendDraft(id, str(fd, "text", 4000), actor);
  refresh(); // a failed send shows in the dialog as «не отправлено»
  if (!r.ok) return { error: r.error };
  return { ok: messaging().name === "fake" ? "Тестовый режим: Wazzup не подключён, сообщение только записано" : "Отправлено" };
}

// «Бот молчит / включить» for one chat
export async function muteAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const id = uuid(fd, "conversationId");
  if (!id) return { error: "Переписка не найдена" };
  const muted = fd.get("muted") === "1";
  await setAssistantMuted(id, muted);
  return (refresh(), { ok: muted ? "Бот молчит в этом чате" : "Бот снова отвечает в этом чате" });
}
