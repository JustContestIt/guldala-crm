import { NextResponse } from "next/server";
import { orderByToken } from "@/services/public";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const o = await orderByToken((await params).token);
  return o ? NextResponse.json(o) : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
}
