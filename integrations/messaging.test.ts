import { afterEach, expect, it, vi } from "vitest";
import { chatAllowed, messaging, testOnly } from "./messaging";

const to = (chatId: string) => ({ chatId, text: "Здравствуйте", crmMessageId: "c1" });

afterEach(() => vi.unstubAllEnvs());

it("sends only to the test numbers while the whitelist is set", async () => {
  vi.stubEnv("WAZZUP_TEST_PHONES", "+77771006667");
  const inner = { name: "x", send: vi.fn().mockResolvedValue({ messageId: "w1" }), channelStatus: vi.fn(), subscribe: vi.fn() };
  const p = testOnly(inner);
  await expect(p.send(to("77771006667"))).resolves.toEqual({ messageId: "w1" });
  await expect(p.send(to("77770000001"))).rejects.toThrow("не тестовый номер");
  expect(inner.send).toHaveBeenCalledTimes(1);
});

it("reads the whitelist from WAZZUP_TEST_PHONES and sends to everyone without it", async () => {
  vi.stubEnv("WAZZUP_API_TOKEN", "");
  vi.stubEnv("WAZZUP_TEST_PHONES", " +77771006667 ,");
  await expect(messaging().send(to("77770000001"))).rejects.toThrow("не тестовый номер");
  await expect(messaging().send(to("77771006667"))).resolves.toEqual({ messageId: "fake-c1" });
  expect(chatAllowed("77770000001")).toBe(false);
  vi.stubEnv("WAZZUP_TEST_PHONES", "");
  await expect(messaging().send(to("77770000001"))).resolves.toEqual({ messageId: "fake-c1" });
  expect(chatAllowed("77770000001")).toBe(true);
});
