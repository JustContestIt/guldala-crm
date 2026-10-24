"use server";

import { after } from "next/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { oneOf, str, type FormState } from "@/lib/form";
import { runBroadcast, startBroadcast, stopBroadcast } from "@/services/broadcast";
import { CLIENT_TYPES, createClient, importClients, type ClientType } from "@/services/clients";

const IDS = /^[0-9a-f-]{36}$/i;

export async function createClientAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const r = await createClient({
    phone: str(fd, "phone", 30),
    name: str(fd, "name", 100),
    company: str(fd, "company", 150),
    clientType: oneOf(fd, "clientType", Object.keys(CLIENT_TYPES) as ClientType[], "flower_shop"),
    notes: str(fd, "notes", 2000),
  });
  if (r.ok) redirect(`/clients/${r.id}`);
  return { error: r.error };
}

// A pasted list or a .csv / .txt file; both at once are joined
export async function importClientsAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const file = fd.get("file");
  const fromFile = file instanceof File && file.size ? (await file.text()).slice(0, 500_000) : "";
  const r = await importClients([str(fd, "text", 500_000), fromFile].filter(Boolean).join("\n"));
  if (!r.ok) return { error: r.error };
  refresh();
  return { ok: `Добавлено ${r.added}, дополнено ${r.updated}, уже были ${r.same}${r.skipped ? `, строк без телефона ${r.skipped}` : ""}` };
}

export async function broadcastAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const ids = fd.getAll("ids").map(String).filter((x) => IDS.test(x));
  const r = await startBroadcast(str(fd, "text", 2000), ids);
  if (!r.ok) return { error: r.error };
  after(() => runBroadcast(r.key)); // goes on after the answer, one message at a time
  redirect("/clients/broadcast?started=1");
}

// «Остановить» drops what is still queued; «Продолжить» picks up a broadcast a restart cut off
export async function broadcastControlAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireOwner();
  const key = str(fd, "key", 60);
  if (fd.get("op") === "resume") {
    after(() => runBroadcast(key));
    return (refresh(), { ok: "Рассылка продолжается" });
  }
  const r = await stopBroadcast(key);
  if (!r.ok) return { error: r.error };
  refresh();
  return { ok: `Остановлено, не отправлено: ${r.removed}` };
}
