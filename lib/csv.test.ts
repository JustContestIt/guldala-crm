import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes only cells with a separator, a quote or a line break", () => {
    expect(toCsv(["А", "Б"], [["просто", 5], ['да; "нет"', "две\nстроки"]])).toBe('\uFEFFА;Б\r\nпросто;5\r\n"да; ""нет""";"две\nстроки"');
  });
});
