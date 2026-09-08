import type { Room, RoomPlayer, User } from "@/generated/prisma/client";
import { mapsRequiredForFormat, type Format } from "@/lib/types";

type RoomPlayerWithUser = RoomPlayer & { user: User };

export interface BuildMatchConfigInput {
  room: Pick<
    Room,
    "label" | "format" | "knifeRound" | "overtimeEnabled" | "teamAName" | "teamBName" | "simulation"
  >;
  roomPlayers: RoomPlayerWithUser[];
  mapList: string[];
  matchzyMatchId: string;
  /** Who won the "didn't get the last map pick" side choice (or the
   * coin flip, if there was no veto to react to) and which side they
   * picked — see chooseSideAction/sideChoiceTeamFromSteps. Only used when
   * the room has no knife round; null falls back to the old fixed
   * alternation (team1 starts CT on map 1) — e.g. a host starting the
   * match before anyone actually made a choice. */
  sideChoice?: { team: "A" | "B"; side: "CT" | "T" } | null;
}

/**
 * SteamID64 -> display name, for everyone (players and coaches alike) a
 * given team roster needs. Unlike Get5, MatchZy has no separate "coaches"
 * config key it actually reads — its own docs say so explicitly: a coach
 * has to be listed under "players" like anyone else, and only becomes a
 * coach in-game by running `.coach <side>` after connecting. Listing a
 * coach only in a "coaches" key (as this used to do) means their SteamID
 * never appears anywhere MatchZy checks, so they get kicked on connect
 * regardless of what they type.
 */
function playerMap(players: RoomPlayerWithUser[], team: "A" | "B"): Record<string, string> {
  return Object.fromEntries(
    players.filter((p) => p.team === team).map((p) => [p.user.steamId64, p.user.name]),
  );
}

/**
 * Builds the Get5-style match config JSON that MatchZy fetches via
 * `matchzy_loadmatch_url`. See docs verified against splewis.github.io/get5
 * and me.sivert.io for the schema/side_type semantics.
 */
export function buildMatchConfig(input: BuildMatchConfigInput): Record<string, unknown> {
  const { room, roomPlayers, mapList, matchzyMatchId, sideChoice } = input;
  const format = room.format as Format;
  const numMaps = mapsRequiredForFormat(format);

  if (mapList.length !== numMaps) {
    throw new Error(`${format} requires ${numMaps} map(s), got ${mapList.length}`);
  }

  // Team size isn't a configured setting — it's whatever actually showed
  // up and readied. MatchZy still wants a single "how many players make a
  // full team" number for its own ready-check, so use the larger of the
  // two real rosters (an uneven match, e.g. 4v3, just means team B's
  // "full" is reached at 3).
  const playersA = roomPlayers.filter((p) => p.team === "A" && !p.isCoach).length;
  const playersB = roomPlayers.filter((p) => p.team === "B" && !p.isCoach).length;
  const playersPerTeam = Math.max(playersA, playersB, 1);
  const coachesA = roomPlayers.filter((p) => p.team === "A" && p.isCoach).length;
  const coachesB = roomPlayers.filter((p) => p.team === "B" && p.isCoach).length;
  const coachesPerTeam = Math.max(coachesA, coachesB);

  const config: Record<string, unknown> = {
    // Sent as a real JSON number, not a string — MatchZy's LoadMatchDataCommand
    // rejects a quoted matchid with "matchid should be an integer!".
    matchid: Number(matchzyMatchId),
    match_title: room.label,
    num_maps: numMaps,
    players_per_team: playersPerTeam,
    coaches_per_team: coachesPerTeam,
    min_players_to_ready: playersPerTeam,
    clinch_series: true,
    veto_first: "random",
    skip_veto: true, // map order is already resolved by our own veto/override UI
    team1: {
      name: room.teamAName,
      players: playerMap(roomPlayers, "A"),
    },
    team2: {
      name: room.teamBName,
      players: playerMap(roomPlayers, "B"),
    },
    maplist: mapList,
    cvars: {
      hostname: `${room.label} — CS2 Matchroom`,
      mp_overtime_enable: room.overtimeEnabled ? "1" : "0",
      // Skips CS2's own team-choice menu on connect — players get
      // auto-assigned a side instead of having to pick one. MatchZy's own
      // roster-based ChangeTeam() (it already runs on every connect once a
      // match is loaded) then corrects anyone onto their actual configured
      // team1/team2 side shortly after, so the auto-assignment here never
      // needs to be "correct", just immediate — the knife round is what
      // actually decides starting sides anyway.
      mp_force_assign_teams: "1",
      // Marks each player ready the moment they connect instead of
      // requiring everyone to type .ready — once both teams hit
      // min_players_to_ready below, MatchZy moves out of warmup on its
      // own, so this is what turns "wait for everyone to ready up" into
      // "wait for everyone to join".
      matchzy_autoready_enabled: "1",
    },
  };

  if (room.knifeRound) {
    config.side_type = "standard"; // knife round decides starting sides each map
  } else {
    config.side_type = "never_knife";
    // Whoever won the side choice (see BuildMatchConfigInput.sideChoice)
    // picked CT or T for map 1 — team1StartsCt says whether that lands
    // team1 (Team A) on CT for that map. No choice recorded (e.g. host
    // started before anyone picked) falls back to the old fixed default:
    // team1 starts CT on map 1. Later maps just keep alternating from
    // whichever side map 1 landed on.
    const team1StartsCt = sideChoice ? (sideChoice.team === "A") === (sideChoice.side === "CT") : true;
    config.map_sides = mapList.map((_, i) => ((i % 2 === 0) === team1StartsCt ? "team1_ct" : "team2_ct"));
  }

  if (room.simulation) {
    // MatchZy Enhanced test feature: spawns bots mapped to the configured
    // SteamIDs and auto-plays the whole match, so the RCON/webhook
    // pipeline can be exercised without real players connecting.
    config.simulation = true;
    config.simulation_timescale = 5;
  }

  return config;
}
