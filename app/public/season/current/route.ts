import { NextResponse } from "next/server";
import { seasonCurrent } from "@/services/public";

export async function GET() {
  const s = await seasonCurrent();
  return s ? NextResponse.json(s) : NextResponse.json({ error: "Сезона нет" }, { status: 404 });
}
