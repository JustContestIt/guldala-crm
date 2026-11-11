// The order confirmation by e-mail (review 09.11.2026, К23, С10): the letter of lib/letters.ts through integrations/mail,
// with a line in the order journal either way
import { after } from "next/server";
import { db } from "@/db";
import { orderEvents } from "@/db/schema";
import { sendMail } from "@/integrations/mail";
import type { Status } from "@/lib/calc";
import { confirmationLetter, LETTER_STATUSES } from "@/lib/letters";
import { orderCard, orderView, totalsByPct, type Actor } from "./orders";
import { SITE_PCTS } from "./public";

export async function sendConfirmation(orderId: string, actor: Actor | null) {
  const card = await orderCard(orderId);
  if (!card) return { ok: false as const, error: "Заказ не найден" };
  const { order: o, client } = card;
  if (!client.email) return { ok: false as const, error: "У клиента нет почты: добавьте её в карточке клиента" };
  if (!LETTER_STATUSES.includes(o.status)) return { ok: false as const, error: "Письмо уходит для брони и оплаченного заказа" };
  const { subject, text } = confirmationLetter({
    ...orderView(card),
    name: client.name,
    status: o.status,
    options: o.status === "confirmed" ? await totalsByPct(card, SITE_PCTS) : [],
    url: `${process.env.SITE_URL ?? ""}/o/${o.publicToken}`,
  });
  const event = (type: "message_sent" | "notification", payload: Record<string, unknown>) =>
    db.insert(orderEvents).values({ orderId, type, payload, actorType: actor ? "user" : "system", actorId: actor?.id ?? null });
  try {
    const { provider } = await sendMail({ to: client.email, subject, text });
    await event("message_sent", { template: "mail", to: client.email, provider });
    return { ok: true as const, to: client.email };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await event("notification", { template: "mail", to: client.email, error });
    return { ok: false as const, error: `Письмо не ушло: ${error}` };
  }
}

// К23: the letter goes by itself when the order becomes «Бронь» or «Предоплачен». Inside a request it goes after the
// response, so the button doesn't wait for the mail server; outside one (tests, scripts) right away.
export async function mailOnStatus(orderId: string, from: Status | null, to: Status) {
  if (from === to || (to !== "confirmed" && to !== "prepaid")) return;
  const send = () => sendConfirmation(orderId, null).catch((e) => console.error(`[mail] ${orderId}: ${e}`));
  try {
    after(send);
  } catch {
    await send();
  }
}
