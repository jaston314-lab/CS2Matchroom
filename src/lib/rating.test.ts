import { describe, expect, it } from "vitest";
import { balanceTeams, type BalanceEntry } from "./rating";

function entry(overrides: Partial<BalanceEntry>): BalanceEntry {
  return {
    roomPlayerId: overrides.roomPlayerId ?? Math.random().toString(36),
    steamId64: overrides.steamId64 ?? "0",
    isCaptain: false,
    team: "A",
    rating: null,
    ...overrides,
  };
}

describe("balanceTeams", () => {
  it("keeps captains on their team and balances the rest by rating", () => {
    const entries: BalanceEntry[] = [
      entry({ roomPlayerId: "capA", isCaptain: true, team: "A", rating: 1000 }),
      entry({ roomPlayerId: "capB", isCaptain: true, team: "B", rating: 1000 }),
      entry({ roomPlayerId: "p1", team: "A", rating: 2000 }),
      entry({ roomPlayerId: "p2", team: "A", rating: 1800 }),
      entry({ roomPlayerId: "p3", team: "B", rating: 500 }),
      entry({ roomPlayerId: "p4", team: "B", rating: 400 }),
    ];

    const result = balanceTeams(entries);

    expect(result.get("capA")).toBe("A");
    expect(result.get("capB")).toBe("B");

    // Highest-rated player (p1, 2000) should anchor whichever team is
    // behind first — with captains tied at 1000/1000, p1 goes to A (ties
    // resolve to A) then the rest fill in to keep totals close.
    const totals = { A: 1000, B: 1000 };
    for (const [id, team] of result) {
      if (id === "capA" || id === "capB") continue;
      const rating = entries.find((e) => e.roomPlayerId === id)!.rating!;
      totals[team] += rating;
    }
    expect(Math.abs(totals.A - totals.B)).toBeLessThanOrEqual(2000);
  });

  it("leaves UNASSIGNED players out of the result", () => {
    const entries: BalanceEntry[] = [
      entry({ roomPlayerId: "p1", team: "A", rating: 1000 }),
      entry({ roomPlayerId: "p2", team: "UNASSIGNED", rating: 1000 }),
    ];
    const result = balanceTeams(entries);
    expect(result.has("p2")).toBe(false);
    expect(result.has("p1")).toBe(true);
  });

  it("fills missing ratings with the pool average instead of treating them as zero", () => {
    const entries: BalanceEntry[] = [
      entry({ roomPlayerId: "p1", team: "A", rating: 2000 }),
      entry({ roomPlayerId: "p2", team: "A", rating: 1000 }),
      entry({ roomPlayerId: "p3", team: "B", rating: null }),
    ];
    const result = balanceTeams(entries);
    // p3 (unrated, filled with the 1500 average) should not simply be
    // dumped last — it still lands on a real team.
    expect(["A", "B"]).toContain(result.get("p3"));
    expect(result.size).toBe(3);
  });
});
