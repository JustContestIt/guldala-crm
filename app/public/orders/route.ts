import { NextResponse } from "next/server";
import { createSiteOrder } from "@/services/public";
import { body, num, obj, refuse, str, TOO_MANY, tooMany } from "../lib";

export async function POST(req: Request) {
  const b = await body(req);
  const client = obj(b.client);
  const phone = str(client.phone, 30);
  if (tooMany(req, phone)) return refuse(TOO_MANY, 429);
  // the site asks for an e-mail: the confirmation goes there (review 12.11.2026, П1); the WhatsApp assistant books without one
  if (!str(client.email, 200)) return refuse("Укажите почту: на неё придёт подтверждение заказа");
  const r = await createSiteOrder({
    items: (Array.isArray(b.items) ? b.items : []).map((i) => ({ productId: str(obj(i).productId, 40), packs: num(obj(i).packs) })),
    prepaymentPct: num(b.prepaymentPct),
    payNow: b.payNow === true,
    pickupDate: str(b.pickupDate, 10),
    pickupSlot: str(b.pickupSlot, 20),
    pickupMethod: str(b.pickupMethod, 20),
    storage: b.storage === true,
    client: { company: str(client.company), name: str(client.name), phone, email: str(client.email, 200), legalType: str(client.legalType, 6), bin: str(client.bin, 12), orgName: str(client.orgName) },
    comment: str(b.comment, 2000), // the client's comment (≤ 1000) plus the varieties they picked
    prefillToken: str(b.prefillToken, 40),
  });
  return r.ok ? NextResponse.json(r) : refuse(r.error);
}
