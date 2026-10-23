import { NextResponse } from "next/server";
import { recordLead } from "@/services/public";
import { body, refuse, str, TOO_MANY, tooMany } from "../lib";

export async function POST(req: Request) {
  const b = await body(req);
  const phone = str(b.phone, 30);
  if (tooMany(req, phone)) return refuse(TOO_MANY, 429);
  const r = await recordLead({ segment: "designer", phone, company: str(b.company), message: "" });
  return r.ok ? NextResponse.json(r) : refuse(r.error);
}
