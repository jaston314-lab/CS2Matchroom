import type { Room, RoomPlayer, User } from "@/generated/prisma/client";
import { mapsRequiredForFormat, type Format } from "@/lib/types";

type RoomPlayerWithUser = RoomPlayer & { user: User };

export interface BuildMatchConfigInput {
  room: Pick<Room, "label" | "format" | "knifeRound" | "overtimeEnabled" | "playersPerTeam">;
  roomPlayers: RoomPlayerWithUser[];
  mapList: string[];
  matchzyMatchId: string;
}

/** SteamID64 -> display name, for the players a given team roster needs. */
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
  const { room, roomPlayers, mapList, matchzyMatchId } = input;
  const format = room.format as Format;
  const numMaps = mapsRequiredForFormat(format);

  if (mapList.length !== numMaps) {
    throw new Error(`${format} requires ${numMaps} map(s), got ${mapList.length}`);
  }

  const config: Record<string, unknown> = {
    matchid: matchzyMatchId,
    match_title: room.label,
    num_maps: numMaps,
    players_per_team: room.playersPerTeam,
    min_players_to_ready: room.playersPerTeam,
    clinch_series: true,
    veto_first: "random",
    skip_veto: true, // map order is already resolved by our own veto/override UI
    team1: { name: `${room.label} — Team A`, players: playerMap(roomPlayers, "A") },
    team2: { name: `${room.label} — Team B`, players: playerMap(roomPlayers, "B") },
    maplist: mapList,
    cvars: {
      hostname: `${room.label} — CS2 Matchroom`,
      mp_overtime_enable: room.overtimeEnabled ? "1" : "0",
    },
  };

  if (room.knifeRound) {
    config.side_type = "standard"; // knife round decides starting sides each map
  } else {
    config.side_type = "never_knife";
    // Deterministic alternating sides per map since there's no knife round.
    config.map_sides = mapList.map((_, i) => (i % 2 === 0 ? "team1_ct" : "team2_ct"));
  }

  return config;
}
