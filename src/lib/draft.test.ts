import { describe, expect, it } from "vitest";
import { applyPick, startDraft } from "./draft";

describe("draft", () => {
  it("resolves immediately when the pool is empty", () => {
    const state = startDraft([], "A", 5);
    expect(state.done).toBe(true);
    expect(state.nextTeam).toBeNull();
  });

  it("alternates picks starting with the given team", () => {
    const pool = ["p1", "p2", "p3", "p4"];
    let state = startDraft(pool, "A", 2);
    expect(state.nextTeam).toBe("A");

    state = applyPick(state, "A", "p1", 2);
    expect(state.nextTeam).toBe("B");
    expect(state.pool).not.toContain("p1");

    state = applyPick(state, "B", "p2", 2);
    expect(state.nextTeam).toBe("A");
    expect(state.done).toBe(false);

    state = applyPick(state, "A", "p3", 2);
    expect(state.nextTeam).toBe("B");

    state = applyPick(state, "B", "p4", 2);
    expect(state.done).toBe(true);
    expect(state.nextTeam).toBeNull();
    expect(state.pool).toHaveLength(0);
  });

  it("keeps a still-open team picking once the other team is full", () => {
    // 6 players, target 2 per team — team A fills after 2 picks, team B
    // should keep getting turns for the remaining 2 players in the pool.
    const pool = ["p1", "p2", "p3", "p4", "p5", "p6"];
    let state = startDraft(pool, "A", 2);

    state = applyPick(state, "A", "p1", 2); // A: 1
    state = applyPick(state, "B", "p2", 2); // B: 1
    state = applyPick(state, "A", "p3", 2); // A: 2 — now full
    expect(state.nextTeam).toBe("B");

    state = applyPick(state, "B", "p4", 2); // B: 2 — now full too
    expect(state.done).toBe(true);
    expect(state.pool).toEqual(["p5", "p6"]); // leftover, undrafted
  });

  it("finishes early if the pool runs out before either team is full", () => {
    const state0 = startDraft(["p1"], "A", 5);
    const state1 = applyPick(state0, "A", "p1", 5);
    expect(state1.done).toBe(true);
    expect(state1.nextTeam).toBeNull();
  });

  it("rejects a pick when it's not that team's turn", () => {
    const state = startDraft(["p1", "p2"], "A", 5);
    expect(() => applyPick(state, "B", "p1", 5)).toThrow(/turn/);
  });

  it("rejects picking a player who isn't in the pool", () => {
    const state = startDraft(["p1", "p2"], "A", 5);
    expect(() => applyPick(state, "A", "ghost", 5)).toThrow(/isn't available/);
  });

  it("rejects further picks once the draft is done", () => {
    let state = startDraft(["p1"], "A", 1);
    state = applyPick(state, "A", "p1", 1);
    expect(state.done).toBe(true);
    expect(() => applyPick(state, "B", "p1", 1)).toThrow(/already complete/);
  });
});
