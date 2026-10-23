import { expect, it } from "vitest";
import { allow } from "./ratelimit";

it("lets `limit` hits through per window and forgets them after it", () => {
  const t0 = 1_000_000;
  expect([allow("a", 2, 100, t0), allow("a", 2, 100, t0 + 1), allow("a", 2, 100, t0 + 2)]).toEqual([true, true, false]);
  expect(allow("b", 2, 100, t0 + 2)).toBe(true); // another key is counted apart
  expect(allow("a", 2, 100, t0 + 101)).toBe(true);
});
