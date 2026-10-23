import { afterEach, expect, it, vi } from "vitest";
import { wazzup } from "./wazzup";

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
  await expect(wazzup.send(m)).rejects.toThrow("Wazzup 400");
});
