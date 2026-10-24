import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { handleWebhook } from "@/integrations/wazzup";
import { replyTo } from "@/services/assistant";
import { receiveWebhook } from "@/services/messages";

const hash = (s: string) => createHash("sha256").update(s).digest();

// Wazzup → CRM (spec §12). Open without a session (proxy.ts); the secret in the path is the lock.
// Answers 200 at once — Wazzup waits 30 s at most — and stores, then lets the assistant answer, after the response.
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const secret = process.env.WAZZUP_WEBHOOK_SECRET;
  if (!secret || !timingSafeEqual(hash((await params).secret), hash(secret))) return new NextResponse(null, { status: 404 });
  const w = handleWebhook(await req.json().catch(() => null));
  if (!w.test)
    after(async () => {
      try {
        const fresh = await receiveWebhook(w);
        await Promise.all(fresh.map((m) => replyTo(m)));
      } catch (e) {
        console.error("[wazzup] webhook failed:", e);
      }
    });
  return NextResponse.json({ ok: true });
}
