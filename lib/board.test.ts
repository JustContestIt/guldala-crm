import { describe, expect, it } from "vitest";
import type { Status } from "./calc";
import { groupBoard } from "./board";

describe("groupBoard", () => {
  const rows = (["confirmed", "new", "expired", "confirmed", "issued", "cancelled", "prepaid"] as Status[]).map((status, i) => ({ status, i }));

  it("puts every status in its own column and hides expired / cancelled", () => {
    const cols = groupBoard(rows, false);
    expect(cols.map((c) => c.status)).toEqual(["new", "confirmed", "prepaid", "ready", "issued"]);
    expect(cols.map((c) => c.rows.map((r) => r.i))).toEqual([[1], [0, 3], [6], [], [4]]);
  });

  it("shows expired and cancelled on request", () => {
    const cols = groupBoard(rows, true);
    expect(cols.slice(5).map((c) => [c.status, c.rows.map((r) => r.i)])).toEqual([
      ["expired", [2]],
      ["cancelled", [5]],
    ]);
    expect(cols.flatMap((c) => c.rows)).toHaveLength(rows.length);
  });
});
