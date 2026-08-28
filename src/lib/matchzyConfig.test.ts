import { describe, expect, it } from "vitest";
import { buildMatchConfig, type BuildMatchConfigInput } from "./matchzyConfig";

function user(steamId64: string, name: string) {
  return { id: steamId64, steamId64, name, avatarUrl: null, role: "PLAYER", manualRating: null, createdAt: new Date() };
}

function roomPlayer(userId: string, team: "A" | "B" | "UNASSIGNED", overrides: Record<string, unknown> = {}) {
  return {
    id: `rp-${userId}`,
    roomId: "room1",
    userId,
    user: user(userId, `Player ${userId}`),
    team,
    isCaptain: false,
    isReady: true,
    joinedAt: new Date(),
    ...overrides,
  };
}

const baseInput: BuildMatchConfigInput = {
  room: { label: "Friday Night", format: "BO1", knifeRound: true, overtimeEnabled: true, playersPerTeam: 2 },
  roomPlayers: [
    roomPlayer("1", "A") as never,
    roomPlayer("2", "A") as never,
    roomPlayer("3", "B") as never,
    roomPlayer("4", "B") as never,
  ],
  mapList: ["de_mirage"],
  matchzyMatchId: "test-match-1",
};

describe("buildMatchConfig", () => {
  it("builds team rosters keyed by steamId64", () => {
    const config = buildMatchConfig(baseInput);
    expect(config.team1).toEqual({ name: "Friday Night — Team A", players: { "1": "Player 1", "2": "Player 2" } });
    expect(config.team2).toEqual({ name: "Friday Night — Team B", players: { "3": "Player 3", "4": "Player 4" } });
    expect(config.maplist).toEqual(["de_mirage"]);
    expect(config.matchid).toBe("test-match-1");
  });

  it("uses side_type standard when knife round is enabled, no map_sides", () => {
    const config = buildMatchConfig(baseInput);
    expect(config.side_type).toBe("standard");
    expect(config.map_sides).toBeUndefined();
  });

  it("uses never_knife with deterministic map_sides when knife round is disabled", () => {
    const config = buildMatchConfig({
      ...baseInput,
      room: { ...baseInput.room, format: "BO3", knifeRound: false },
      mapList: ["de_mirage", "de_inferno", "de_nuke"],
    });
    expect(config.side_type).toBe("never_knife");
    expect(config.map_sides).toEqual(["team1_ct", "team2_ct", "team1_ct"]);
  });

  it("throws when the resolved map list doesn't match the format's required count", () => {
    expect(() =>
      buildMatchConfig({ ...baseInput, room: { ...baseInput.room, format: "BO3" }, mapList: ["de_mirage"] }),
    ).toThrow(/requires 3/);
  });
});
