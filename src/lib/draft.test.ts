import { describe, expect, it } from "vitest";
import { applyPick, startDraft } from "./draft";

describe("draft", () => {
  it("resolves immediately when the pool is empty", () => {
    const state = startDraft([], "A");
    expect(state.done).toBe(true);
    expect(state.nextTeam).toBeNull();
  });

  it("alternates picks starting with the given team until the pool empties", () => {
    const pool = ["p1", "p2", "p3", "p4"];
    let state = startDraft(pool, "A");
    expect(state.nextTeam).toBe("A");

    state = applyPick(state, "A", "p1", "A");
    expect(state.nextTeam).toBe("B");
    expect(state.pool).not.toContain("p1");

    state = applyPick(state, "B", "p2", "A");
    expect(state.nextTeam).toBe("A");
    expect(state.done).toBe(false);

    state = applyPick(state, "A", "p3", "A");
    expect(state.nextTeam).toBe("B");

    state = applyPick(state, "B", "p4", "A");
    expect(state.done).toBe(true);
    expect(state.nextTeam).toBeNull();
    expect(state.pool).toHaveLength(0);
  });

  it("produces uneven teams when the pool doesn't split evenly — no fixed target anymore", () => {
    // 7 players (odd) — with no per-team cap, alternation just keeps going
    // until the pool is empty, so team A (which picks first) ends up with
    // one more than team B.
    const pool = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    let state = startDraft(pool, "A");
    for (const id of pool) {
      state = applyPick(state, state.nextTeam!, id, "A");
    }
    expect(state.done).toBe(true);
    expect(state.steps.filter((s) => s.team === "A")).toHaveLength(4);
    expect(state.steps.filter((s) => s.team === "B")).toHaveLength(3);
  });

  it("rejects a pick when it's not that team's turn", () => {
    const state = startDraft(["p1", "p2"], "A");
    expect(() => applyPick(state, "B", "p1", "A")).toThrow(/turn/);
  });

  it("rejects picking a player who isn't in the pool", () => {
    const state = startDraft(["p1", "p2"], "A");
    expect(() => applyPick(state, "A", "ghost", "A")).toThrow(/isn't available/);
  });

  it("rejects further picks once the draft is done", () => {
    let state = startDraft(["p1"], "A");
    state = applyPick(state, "A", "p1", "A");
    expect(state.done).toBe(true);
    expect(() => applyPick(state, "B", "p1", "A")).toThrow(/already complete/);
  });
});
