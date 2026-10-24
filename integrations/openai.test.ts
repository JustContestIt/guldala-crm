import { expect, it } from "vitest";
import { chatModels } from "./openai";

it("keeps chat models for the assistant and drops snapshots, audio, images, pro and shut down ones", () => {
  const ids = [
    "gpt-6-luna",
    "gpt-6.1-sol",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "o4-mini",
    "gpt-4o-2024-05-13",
    "gpt-4-0613",
    "gpt-4",
    "gpt-3.5-turbo",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-4o-mini-tts",
    "gpt-4o-transcribe",
    "gpt-4o-search-preview",
    "gpt-image-1",
    "text-embedding-3-small",
    "omni-moderation-latest",
    "gpt-5-pro",
    "gpt-5-chat-latest",
    "dall-e-3",
    "whisper-1",
    "gpt-live-1",
  ].map((id) => ({ id }));
  const kept = chatModels([...ids, { id: "gpt-5-nano", shutdown_date: "2026-10-01" }, { id: "gpt-5-mini", shutdown_date: "2027-01-14" }], "2026-10-24");
  expect(kept.map((m) => m.id)).toEqual(["gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "gpt-5-mini", "gpt-6-luna", "gpt-6.1-sol", "o4-mini"]);
  expect(kept.find((m) => m.id === "gpt-5-mini")?.shutdown).toBe("2027-01-14"); // shown next to the name
});
