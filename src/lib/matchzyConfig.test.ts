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
    isCoach: false,
    isReady: true,
    joinedAt: new Date(),
    ...overrides,
  };
}

const baseInput: BuildMatchConfigInput = {
  room: {
    label: "Friday Night",
    format: "BO1",
    knifeRound: true,
    overtimeEnabled: true,
    teamAName: "Team A",
    teamBName: "Team B",
    simulation: false,
  },
  roomPlayers: [
    roomPlayer("1", "A") as never,
    roomPlayer("2", "A") as never,
    roomPlayer("3", "B") as never,
    roomPlayer("4", "B") as never,
  ],
  mapList: ["de_mirage"],
  matchzyMatchId: "1700000000",
};

describe("buildMatchConfig", () => {
  it("builds team rosters keyed by steamId64", () => {
    const config = buildMatchConfig(baseInput);
    expect(config.team1).toEqual({
      name: "Team A",
      players: { "1": "Player 1", "2": "Player 2" },
    });
    expect(config.team2).toEqual({
      name: "Team B",
      players: { "3": "Player 3", "4": "Player 4" },
    });
    expect(config.maplist).toEqual(["de_mirage"]);
    expect(config.matchid).toBe(1700000000);
    expect(config.players_per_team).toBe(2);
    expect(config.min_players_to_ready).toBe(2);
    expect(config.coaches_per_team).toBe(0);
  });

  it("derives players_per_team from the larger real roster — teams aren't a configured setting", () => {
    const config = buildMatchConfig({
      ...baseInput,
      roomPlayers: [
        ...baseInput.roomPlayers,
        roomPlayer("5", "A") as never, // Team A now has 3, Team B still has 2
      ],
    });
    expect(config.players_per_team).toBe(3);
    expect(config.min_players_to_ready).toBe(3);
  });

  it("includes a coach in the players map too — MatchZy has no separate coaches key, coaches must be listed as players and use .coach in-game", () => {
    const config = buildMatchConfig({
      ...baseInput,
      roomPlayers: [
        ...baseInput.roomPlayers,
        roomPlayer("5", "A", { isCoach: true }) as never,
      ],
    });
    expect(config.team1).toEqual({
      name: "Team A",
      players: { "1": "Player 1", "2": "Player 2", "5": "Player 5" },
    });
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

  it("uses the winning team's actual side choice for map 1, alternating from there, when there's no knife round", () => {
    const noKnife = { ...baseInput, room: { ...baseInput.room, format: "BO3" as const, knifeRound: false }, mapList: ["de_mirage", "de_inferno", "de_nuke"] };

    // Team A (team1) chose CT — same as the old fixed default.
    expect(
      buildMatchConfig({ ...noKnife, sideChoice: { team: "A", side: "CT" } }).map_sides,
    ).toEqual(["team1_ct", "team2_ct", "team1_ct"]);

    // Team A chose T instead — team2 (Team B) starts CT on map 1, flipping every map after.
    expect(
      buildMatchConfig({ ...noKnife, sideChoice: { team: "A", side: "T" } }).map_sides,
    ).toEqual(["team2_ct", "team1_ct", "team2_ct"]);

    // Team B chose CT — team2 starts CT on map 1, same result as Team A choosing T.
    expect(
      buildMatchConfig({ ...noKnife, sideChoice: { team: "B", side: "CT" } }).map_sides,
    ).toEqual(["team2_ct", "team1_ct", "team2_ct"]);

    // Team B chose T — team1 (Team A) starts CT on map 1.
    expect(
      buildMatchConfig({ ...noKnife, sideChoice: { team: "B", side: "T" } }).map_sides,
    ).toEqual(["team1_ct", "team2_ct", "team1_ct"]);
  });

  it("throws when the resolved map list doesn't match the format's required count", () => {
    expect(() =>
      buildMatchConfig({ ...baseInput, room: { ...baseInput.room, format: "BO3" }, mapList: ["de_mirage"] }),
    ).toThrow(/requires 3/);
  });

  it("forces team auto-assign and player auto-ready, so no manual choose-team menu or .ready is needed", () => {
    const config = buildMatchConfig(baseInput);
    const cvars = config.cvars as Record<string, string>;
    expect(cvars.mp_force_assign_teams).toBe("1");
    expect(cvars.matchzy_autoready_enabled).toBe("1");
  });

  it("omits simulation fields by default, includes them when the room has simulation on", () => {
    const off = buildMatchConfig(baseInput);
    expect(off.simulation).toBeUndefined();

    const on = buildMatchConfig({ ...baseInput, room: { ...baseInput.room, simulation: true } });
    expect(on.simulation).toBe(true);
    expect(on.simulation_timescale).toBe(5);
  });
});
