"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { day, int, oneOf, str, uuid, type FormState } from "@/lib/form";
import { fromForm, TYPES } from "@/lib/grid";
import type { SeasonSettings } from "@/lib/settings";
import { CHANNEL_STATE } from "@/integrations/messaging";
import { EFFORTS } from "@/integrations/openai";
import { MODES, saveAssistantSettings } from "@/services/assistant";
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
  const settings: Omit<SeasonSettings, "pack_size"> = {
    min_order_stems: int(fd, "min_order_stems"),
    min_order_scope: oneOf(fd, "min_order_scope", ["total", "per_color"], "total"),
    hold_days: int(fd, "hold_days"),
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
    storage_fee_per_day: 0, // the fridge is gone (review 09.11.2026, С2): nobody can ask for it, a saved season charges nothing
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

export async function packSizeAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const seasonId = uuid(fd, "seasonId");
  if (!seasonId) return { error: "Сезон не найден" };
  return answer(await svc.setPackSize(seasonId, int(fd, "packSize")), "Размер пачки сохранён");
}

export async function deleteProductAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const id = uuid(fd, "id");
  if (!id) return { error: "Товар не найден" };
  return answer(await svc.deleteProduct(id), "Товар удалён");
}

export async function saveProductAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireOwner();
  const r = await svc.saveProduct(uuid(fd, "id"), {
    name: str(fd, "name", 100),
    tulipType: oneOf(fd, "tulipType", TYPES, "classic"),
    color: oneOf(fd, "color", Object.keys(svc.COLORS) as svc.Color[], "red"),
    varieties: str(fd, "varieties", 500),
    isActive: fd.get("isActive") === "on",
    sortOrder: int(fd, "sortOrder"),
  });
  if (!r.ok) return { error: r.error };
  // the product's stock in the same form: a new one gets its plan, an existing one an adjustment by the difference
  const seasonId = uuid(fd, "seasonId");
  if (!seasonId || str(fd, "packs") === "") return done("Сохранено");
  return answer(await svc.setStockTotal(seasonId, r.id, int(fd, "packs"), str(fd, "reason", 300), user.id), "Сохранено");
}

// «Настройки → WhatsApp»: subscribe Wazzup's webhooks to this CRM and read the channel state
export async function connectWhatsappAction(): Promise<FormState> {
  await requireOwner();
  const r = await connectChannel();
  return r.ok ? done(`Вебхуки подписаны. Канал: ${CHANNEL_STATE[r.state] ?? r.state}`) : (refresh(), { error: r.error });
}

// «Настройки → Ассистент»: saved only after the chosen model answered a short question
export async function assistantAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const r = await saveAssistantSettings({ mode: oneOf(fd, "mode", MODES, "off"), model: str(fd, "model", 100), effort: oneOf(fd, "effort", EFFORTS, "") });
  if (!r.ok) return { error: r.error };
  return done(r.checked ? "Сохранено: модель ответила на проверку" : "Сохранено (ключа OpenAI нет — модель не проверялась)");
}
