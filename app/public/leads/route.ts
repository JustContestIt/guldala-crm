import { NextResponse } from "next/server";
import { recordLead, type Segment } from "@/services/public";
import { body, refuse, str, TOO_MANY, tooMany } from "../lib";

const SEGMENTS: Segment[] = ["private", "office", "horeca"];

export async function POST(req: Request) {
  const b = await body(req);
  const phone = str(b.phone, 30);
  if (tooMany(req, phone)) return refuse(TOO_MANY, 429);
  const segment = SEGMENTS.find((s) => s === b.segment) ?? "private";
  const r = await recordLead({ segment, phone, company: str(b.company), message: str(b.message, 1000) });
  return r.ok ? NextResponse.json(r) : refuse(r.error);
}
