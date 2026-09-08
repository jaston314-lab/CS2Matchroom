import { describe, expect, it } from "vitest";
import { applyBan, startVeto, sideChoiceTeamFromSteps } from "./veto";
import type { VetoStep } from "@/lib/types";

describe("veto", () => {
  it("resolves immediately when the pool already matches the required count", () => {
    const state = startVeto(["de_mirage"], "A", 1);
    expect(state.done).toBe(true);
    expect(state.finalMapList).toEqual(["de_mirage"]);
    expect(state.nextTeam).toBeNull();
  });

  it("alternates bans starting with the given team down to the required count", () => {
    const pool = ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis"];
    let state = startVeto(pool, "A", 3);
    expect(state.nextTeam).toBe("A");

    state = applyBan(state, "A", "de_mirage", 3);
    expect(state.nextTeam).toBe("B");
    expect(state.pool).not.toContain("de_mirage");
    expect(state.done).toBe(false);

    state = applyBan(state, "B", "de_inferno", 3);
    expect(state.done).toBe(true);
    expect(state.nextTeam).toBeNull();
    expect(state.finalMapList).toEqual(["de_nuke", "de_ancient", "de_anubis"]);
    expect(state.steps).toHaveLength(2);
  });

  it("rejects a ban when it's not that team's turn", () => {
    const state = startVeto(["a", "b", "c"], "A", 1);
    expect(() => applyBan(state, "B", "a", 1)).toThrow(/turn/);
  });

  it("rejects banning a map that isn't in the remaining pool", () => {
    const state = startVeto(["a", "b", "c"], "A", 1);
    expect(() => applyBan(state, "A", "z", 1)).toThrow(/not available/);
  });

  it("rejects further bans once veto is done", () => {
    let state = startVeto(["a", "b"], "A", 1);
    state = applyBan(state, "A", "a", 1);
    expect(state.done).toBe(true);
    expect(() => applyBan(state, "B", "b", 1)).toThrow(/already complete/);
  });
});

describe("sideChoiceTeamFromSteps", () => {
  it("returns null when the veto resolved with zero bans — caller should coin-flip instead", () => {
    expect(sideChoiceTeamFromSteps([])).toBeNull();
  });

  it("gives side choice to the opponent of whoever cast the last ban", () => {
    expect(sideChoiceTeamFromSteps([{ team: "A", map: "de_mirage", action: "ban" }])).toBe("B");
    expect(sideChoiceTeamFromSteps([{ team: "B", map: "de_mirage", action: "ban" }])).toBe("A");
  });

  it("only looks at the last step, not who started the veto", () => {
    const steps: VetoStep[] = [
      { team: "A", map: "de_mirage", action: "ban" },
      { team: "B", map: "de_inferno", action: "ban" },
      { team: "A", map: "de_nuke", action: "ban" },
    ];
    // A cast the last ban here, so B gets the side choice.
    expect(sideChoiceTeamFromSteps(steps)).toBe("B");
  });
});
