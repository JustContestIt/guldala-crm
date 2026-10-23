import { NextResponse } from "next/server";
import { prefill } from "@/services/public";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const p = await prefill((await params).token);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "Ссылка устарела" }, { status: 404 });
}
