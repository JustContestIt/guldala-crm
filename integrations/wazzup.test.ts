import { afterEach, expect, it, vi } from "vitest";
import { handleWebhook, wazzup } from "./wazzup";

const m = { chatId: "77770000001", text: "Здравствуйте", crmMessageId: "c1" };
const repeated = JSON.stringify({ status: 400, error: "REPEATED_CRM_MESSAGE_ID", description: "You have already sent message with same crmMessageId" });

afterEach(() => vi.unstubAllGlobals());

it("returns Wazzup's messageId on 201", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "w1", chatId: m.chatId }), { status: 201 })));
  expect(await wazzup.send(m)).toEqual({ messageId: "w1" });
});

it("treats a repeated crmMessageId on the retry as sent", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(new Response(repeated, { status: 400 }));
  vi.stubGlobal("fetch", fetch);
  expect(await wazzup.send(m)).toEqual({ messageId: "" });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("still fails on a repeated crmMessageId without a lost first attempt", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(repeated, { status: 400 })));
  await expect(wazzup.send(m)).rejects.toThrow("уже отправлено");
});

it("explains Wazzup's errors in words, not JSON", async () => {
  const body = JSON.stringify({ status: 400, requestId: "r1", error: "MESSAGE_CHANNEL_UNAVAILABLE", description: "Channel unavailable" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 400 })));
  await expect(wazzup.send(m)).rejects.toThrow(/^телефон с WhatsApp не в сети$/);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
  await expect(wazzup.send(m)).rejects.toThrow("WAZZUP_API_TOKEN");
});

it("parses a webhook with messages, statuses and channel updates together", () => {
  const w = handleWebhook({
    messages: [
      { messageId: "a", channelId: "ch", chatType: "whatsapp", chatId: "77018884446", type: "text", text: " Здравствуйте ", isEcho: false },
      { messageId: "b", channelId: "ch", chatType: "whatsapp", chatId: "77018884446", type: "audio", contentUri: "https://x/a.ogg", isEcho: false },
      { messageId: "c", channelId: "ch", chatType: "whatsgroup", chatId: "1203630@g.us", type: "text", text: "группа" },
    ],
    statuses: [{ messageId: "a", status: "read" }, { messageId: "b", status: "error", error: { error: "BAD_CONTACT" } }, { messageId: "c", status: "edited" }],
    channelsUpdates: [{ channelId: "ch", state: "phoneUnavailable", timestamp: 1 }],
  });
  expect(w.test).toBe(false);
  expect(w.messages.map((x) => [x.messageId, x.text, x.attachments.length])).toEqual([
    ["a", "Здравствуйте", 0],
    ["b", "[голосовое сообщение]", 1],
  ]);
  expect(w.statuses).toEqual([
    { messageId: "a", status: "read", error: null },
    { messageId: "b", status: "error", error: "этого номера нет в WhatsApp" },
  ]);
  expect(w.channels).toEqual([{ channelId: "ch", state: "phoneUnavailable" }]);
  expect(handleWebhook({ test: true }).test).toBe(true);
  expect(handleWebhook("garbage")).toEqual({ test: false, messages: [], statuses: [], channels: [] });
});
