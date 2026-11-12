import { requireUser } from "@/lib/auth";
import { confirmationOf } from "@/services/confirmations";
import { letterPdf } from "@/services/pdf";

// «PDF» in the order card: the confirmation letter as a file, to send the client in WhatsApp (review 12.11.2026, П3)
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const c = /^[0-9a-f-]{36}$/i.test(id) ? await confirmationOf(id) : null;
  if (!c?.ok) return new Response(c?.error ?? "Заказ не найден", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const pdf = await letterPdf(c.letter.subject, c.letter.text);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      // inline: the phone opens it, and «Поделиться» from there sends it on
      "content-disposition": `inline; filename="${c.filename}"`,
    },
  });
}
