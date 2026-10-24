"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { day, int, oneOf, prefixed, str, uuid, type FormState } from "@/lib/form";
import { fromForm, TYPES } from "@/lib/grid";
import type { SeasonSettings } from "@/lib/settings";
import { CHANNEL_STATE } from "@/integrations/messaging";
import { connectChannel } from "@/services/messages";
import * as svc from "@/services/settings";

const done = (ok: string): FormState => (refresh(), { ok });
const answer = (r: { ok: boolean; error?: string }, ok: string): FormState => (r.ok ? done(ok) : { error: r.error });

const seasonFields = (fd: FormData): svc.SeasonFields => ({
  name: str(fd, "name", 100),
  ordersOpenFrom: day(fd, "ordersOpenFrom") ?? "",
  peakDate: day(fd, "peakDate") ?? "",
  pickupFrom: day(fd, "pickupFrom") ?? "",
  pickupTo: day(fd, "pickupTo") ?? "",
});

export async function createSeasonAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const r = await svc.createSeason(seasonFields(fd));
  if (!r.ok) return { error: r.error };
  redirect(`/settings/seasons/${r.id}`);
}

export async function updateSeasonAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const id = uuid(fd, "id");
  if (!id) return { error: "Сезон не найден" };
  const settings: SeasonSettings = {
    pack_size: int(fd, "pack_size"),
    min_order_stems: int(fd, "min_order_stems"),
    min_order_scope: oneOf(fd, "min_order_scope", ["total", "per_color"], "total"),
    hold_days: int(fd, "hold_days"),
    check_threshold_amount: int(fd, "check_threshold_amount"),
    prepayment_min_pct: int(fd, "prepayment_min_pct"),
    prepayment_max_pct: int(fd, "prepayment_max_pct"),
    prepayment_step: int(fd, "prepayment_step"),
    pickup_hours: str(fd, "pickup_hours", 20),
    pickup_hours_peak: str(fd, "pickup_hours_peak", 20),
    peak_hours_from: day(fd, "peak_hours_from") ?? "",
    ready_status_enabled: fd.get("ready_status_enabled") === "on",
    issue_on_full_payment_allowed: fd.get("issue_on_full_payment_allowed") === "on",
    price_lock_on: oneOf(fd, "price_lock_on", ["prepaid", "confirmed"], "prepaid"),
    client_notifications: oneOf(fd, "client_notifications", ["manual", "auto"], "manual"),
    stock_few_below_pct: int(fd, "stock_few_below_pct"),
    assistant_mode: oneOf(fd, "assistant_mode", ["off", "draft", "auto"], "off"),
  };
  return answer(await svc.updateSeason(id, seasonFields(fd), settings), "Сохранено");
}

export async function seasonStatusAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const id = uuid(fd, "id");
  if (!id) return { error: "Сезон не найден" };
  return answer(await svc.setSeasonStatus(id, oneOf(fd, "status", ["planning", "open", "closed"], "planning")), "Статус сезона изменён");
}

export async function saveGridAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const seasonId = uuid(fd, "seasonId");
  if (!seasonId) return { error: "Сезон не найден" };
  const r = fromForm(fd);
  return "error" in r ? { error: r.error } : answer(await svc.saveGrid(seasonId, r.rows), "Сетка сохранена");
}

export async function setPlansAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const seasonId = uuid(fd, "seasonId");
  if (!seasonId) return { error: "Сезон не найден" };
  const plans = prefixed(fd, "plan:").filter((p) => /^[0-9a-f-]{36}$/i.test(p.key) && str(fd, `plan:${p.key}`) !== "");
  if (!plans.length) return { error: "Нечего сохранять" };
  return answer(await svc.setPlans(seasonId, new Map(plans.map((p) => [p.key, p.value]))), "План сохранён");
}

export async function addAdjustmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireOwner();
  const seasonId = uuid(fd, "seasonId");
  const productId = uuid(fd, "productId");
  if (!seasonId || !productId) return { error: "Выберите цвет" };
  return answer(await svc.addAdjustment(seasonId, productId, int(fd, "delta"), str(fd, "reason", 300), user.id), "Корректировка записана");
}

export async function saveProductAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const r = await svc.saveProduct(uuid(fd, "id"), {
    name: str(fd, "name", 100),
    tulipType: oneOf(fd, "tulipType", TYPES, "classic"),
    color: str(fd, "color", 50),
    varieties: str(fd, "varieties", 500),
    isActive: fd.get("isActive") === "on",
    sortOrder: int(fd, "sortOrder"),
  });
  return answer(r, "Сохранено");
}

// «Настройки → WhatsApp»: subscribe Wazzup's webhooks to this CRM and read the channel state
export async function connectWhatsappAction(): Promise<FormState> {
  await requireOwner();
  const r = await connectChannel();
  return r.ok ? done(`Вебхуки подписаны. Канал: ${CHANNEL_STATE[r.state] ?? r.state}`) : (refresh(), { error: r.error });
}
