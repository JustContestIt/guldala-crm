"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, type User } from "@/lib/auth";
import { day, hm, int, oneOf, str, uuid, type FormState } from "@/lib/form";
import { messaging } from "@/integrations/messaging";
import { CLIENT_TYPES, updateClient, type ClientType } from "@/services/clients";
import { sendMessage } from "@/services/messages";
import * as o from "@/services/orders";
import { createPrefill } from "@/services/public";

const actorOf = (u: User): o.Actor => ({ id: u.id, role: u.role });
const reply = (r: { ok: boolean; error?: string }, ok: string): FormState => (r.ok ? (refresh(), { ok }) : { error: r.error });
const METHODS = ["kaspi_invoice", "cash"] as const;
const noOrder: FormState = { error: "Заказ не найден" };

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

export async function createOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const r = await o.createOrder(
    {
      phone: str(fd, "phone", 30),
      name: str(fd, "name", 100),
      company: str(fd, "company", 150),
      lines: parseLines(str(fd, "lines", 2000)),
      pct: int(fd, "pct"),
      pickupDate: day(fd, "pickupDate"),
      pickupTime: hm(fd, "pickupTime"),
      pickupMethod: oneOf(fd, "pickupMethod", ["self_pickup", "client_truck"], "self_pickup"),
      storage: fd.get("storage") === "on",
      commentClient: str(fd, "commentClient", 2000),
      commentInternal: str(fd, "commentInternal", 2000),
      channel: oneOf(fd, "channel", ["whatsapp", "instagram", "telegram", "phone", "in_person", "site"], "whatsapp"),
    },
    actorOf(user),
  );
  if (!r.ok) return { error: r.error };
  redirect(`/orders/${r.id}?msg=booking`);
}

// One order-id action: confirm, resume, ready
export async function statusAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  if (!id) return noOrder;
  const op = oneOf(fd, "op", ["confirm", "resume", "ready"], "confirm");
  const fn = { confirm: o.confirmOrder, resume: o.resumeOrder, ready: o.markReady }[op];
  return reply(await fn(id, actor), { confirm: "Бронь подтверждена", resume: "Бронь возобновлена", ready: "Отмечен готовым к выдаче" }[op]);
}

export async function cancelAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  return id ? reply(await o.cancelOrder(id, str(fd, "reason", 300), actor), "Заказ отменён") : noOrder;
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
  const r = await o.recordPayment(
    id,
    { amount: int(fd, "amount"), method: oneOf(fd, "method", METHODS, "kaspi_invoice"), paid, invoiceRef: str(fd, "invoiceRef", 100), note: str(fd, "note", 300) },
    actor,
  );
  return reply(r, paid ? "Оплата записана" : "Счёт записан, ждём оплату");
}

export async function invoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "paymentId");
  if (!id) return { error: "Счёт не найден" };
  return fd.get("op") === "cancel" ? reply(await o.cancelInvoice(id, actor), "Счёт отменён") : reply(await o.markInvoicePaid(id, actor), "Счёт оплачен");
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
  return reply(await o.issueOrder(id, method, actor, packs), packs ? "Выдача записана" : "Заказ выдан");
}

export async function noShowAction(_: FormState, fd: FormData): Promise<FormState> {
  const actor = actorOf(await requireUser());
  const id = uuid(fd, "id");
  const d = day(fd, "day");
  if (!id || !d) return noOrder;
  return reply(await o.noShow(id, d, actor), "Записано: не приехал");
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
