// The order confirmation by e-mail (review 09.11.2026, К23, С10): the letter of lib/letters.ts through integrations/mail,
// with a line in the order journal either way
import { after } from "next/server";
import { db } from "@/db";
import { orderEvents } from "@/db/schema";
import { sendMail } from "@/integrations/mail";
import type { Status } from "@/lib/calc";
import { confirmationLetter, LETTER_STATUSES } from "@/lib/letters";
import { orderCard, orderView, totalsByPct, type Actor } from "./orders";
import { letterPdf } from "./pdf";
import { SITE_PCTS } from "./public";

// The letter for the order as it stands, or why there is none; the PDF of the order card is the same text
export async function confirmationOf(orderId: string) {
  const card = await orderCard(orderId);
  if (!card) return { ok: false as const, error: "Заказ не найден" };
  const { order: o, client } = card;
  if (!LETTER_STATUSES.includes(o.status)) return { ok: false as const, error: "Письмо уходит для заявки, брони и оплаченного заказа" };
  const letter = confirmationLetter({
    ...orderView(card),
    name: client.name,
    status: o.status,
    options: o.status === "confirmed" ? await totalsByPct(card, SITE_PCTS) : [],
    url: `${process.env.SITE_URL ?? ""}/o/${o.publicToken}`,
  });
  return { ok: true as const, card, letter, filename: `Guldala-${o.number}.pdf` };
}

export async function sendConfirmation(orderId: string, actor: Actor | null) {
  const c = await confirmationOf(orderId);
  if (!c.ok) return c;
  const { subject, text } = c.letter;
  const to = c.card.client.email;
  if (!to) return { ok: false as const, error: "У клиента нет почты: добавьте её в карточке клиента" };
  const event = (type: "message_sent" | "notification", payload: Record<string, unknown>) =>
    db.insert(orderEvents).values({ orderId, type, payload, actorType: actor ? "user" : "system", actorId: actor?.id ?? null });
  // the letter goes even if the PDF couldn't be made: the text is all in it
  const pdf = await letterPdf(subject, text).catch((e) => void console.error(`[mail] ${orderId}: PDF не собран: ${e}`));
  try {
    const { provider } = await sendMail({ to, subject, text, attachments: pdf ? [{ filename: c.filename, content: pdf }] : [] });
    await event("message_sent", { template: "mail", to, provider, pdf: !!pdf });
    return { ok: true as const, to };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await event("notification", { template: "mail", to, error });
    return { ok: false as const, error: `Письмо не ушло: ${error}` };
  }
}

// К23: the letter goes by itself when a request comes in (П2, 12.11.2026) and when the order becomes «Бронь» or
// «Предоплачен». Inside a request it goes after the response, so the button doesn't wait for the mail server;
// outside one (tests, scripts) right away. No e-mail (the WhatsApp assistant's orders): no letter, nothing logged
export async function mailOnStatus(orderId: string, from: Status | null, to: Status) {
  const created = from === null && to === "new";
  if (from === to || !(created || to === "confirmed" || to === "prepaid")) return;
  const send = () => sendConfirmation(orderId, null).catch((e) => console.error(`[mail] ${orderId}: ${e}`));
  try {
    after(send);
  } catch {
    await send();
  }
}
