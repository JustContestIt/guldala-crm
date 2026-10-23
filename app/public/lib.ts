// Readers for the site's JSON bodies: everything is text or a number until checked here
import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";

export const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
export const num = (v: unknown) => (typeof v === "number" ? v : NaN);
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function body(req: Request) {
  try {
    return obj(await req.json());
  } catch {
    return {};
  }
}

// The site forwards the visitor's address (X-Forwarded-For); limits are per hour
export const tooMany = (req: Request, phone: string, perPhone = 5, perIp = 20) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "?";
  return !allow(`ip:${ip}`, perIp) || !allow(`phone:${phone}`, perPhone);
};

export const refuse = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const TOO_MANY = "Слишком много заявок с этого номера или адреса. Попробуйте через час или напишите Татьяне в WhatsApp.";
