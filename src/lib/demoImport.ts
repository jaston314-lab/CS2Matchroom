import "server-only";
import fs from "node:fs";
import zlib from "node:zlib";
import { parseHeader, parsePlayerInfo, parseTicks } from "@laihoe/demoparser2";
import { db } from "@/lib/db";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/roomDefaults";

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// @types/node in this project predates Node's zstd support (added in
// Node 22.15/23.8 — we're on Node 24 at runtime, the types just haven't
// caught up), so this one call needs a narrow type escape hatch.
const zstdDecompressSync = (zlib as unknown as { zstdDecompressSync: (buf: Buffer) => Buffer })
  .zstdDecompressSync;

function decompressIfNeeded(buf: Buffer): Buffer {
  if (buf.length > 4 && buf.subarray(0, 4).equals(ZSTD_MAGIC)) {
    return zstdDecompressSync(buf);
  }
  return buf;
}

interface FinalPlayerRow {
  steamid: string;
  name: string;
  team_num: number;
  team_clan_name?: string;
  team_rounds_total: number;
  kills_total: number;
  deaths_total: number;
  assists_total: number;
  headshot_kills_total: number;
  damage_total: number;
  mvps: number;
  score: number;
}

/** Strips FACEIT's "team_<captain-name>" auto-naming down to something readable. */
function prettyTeamName(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  return raw.startsWith("team_") ? raw.slice("team_".length) : raw;
}

export interface ParsedDemoPlayer {
  steamId64: string;
  name: string;
  team: "A" | "B";
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  damage: number;
  mvps: number;
  score: number;
}

export interface ParsedDemo {
  mapName: string;
  teamAName: string;
  teamBName: string;
  teamAScore: number;
  teamBScore: number;
  winnerTeam: "A" | "B" | null;
  roundsPlayed: number;
  players: ParsedDemoPlayer[];
}

/**
 * Parses a CS2 demo (.dem, or .dem.zst — decompressed with Node's built-in
 * zstd support) into box-score stats. Numbers come straight from CS2's own
 * networked player-state props (kills_total, deaths_total, mvps, score,
 * etc.) rather than being reconstructed from game events — those are the
 * same values the in-game scoreboard uses, so they're authoritative.
 */
export function parseDemo(raw: Buffer): ParsedDemo {
  const demo = decompressIfNeeded(raw);

  const header = parseHeader(demo) as { map_name?: string };
  const mapName = header.map_name ?? "unknown";

  const rows = parseTicks(demo, [
    "team_num",
    "team_clan_name",
    "team_rounds_total",
    "kills_total",
    "deaths_total",
    "assists_total",
    "headshot_kills_total",
    "damage_total",
    "mvps",
    "score",
  ]) as FinalPlayerRow[] & { tick: number }[];

  let lastTick = 0;
  for (const r of rows as unknown as { tick: number }[]) {
    if (r.tick > lastTick) lastTick = r.tick;
  }
  const finalRows = (rows as unknown as (FinalPlayerRow & { tick: number })[]).filter(
    (r) => r.tick === lastTick,
  );
  if (finalRows.length === 0) {
    throw new Error("Couldn't read final player state from this demo — is it a valid CS2 match demo?");
  }

  const teamNums = Array.from(new Set(finalRows.map((r) => r.team_num))).sort((a, b) => a - b);
  if (teamNums.length !== 2) {
    throw new Error(`Expected exactly 2 teams in the demo, found ${teamNums.length}`);
  }
  // Arbitrary but consistent mapping — CS2's team_num (2/3) tracks
  // T-side/CT-side, which isn't meaningful post-match since sides swap at
  // half. The higher team_num becomes "A" just to have a fixed rule.
  const [teamNumB, teamNumA] = teamNums;

  const rowsA = finalRows.filter((r) => r.team_num === teamNumA);
  const rowsB = finalRows.filter((r) => r.team_num === teamNumB);
  const teamAScore = rowsA[0]?.team_rounds_total ?? 0;
  const teamBScore = rowsB[0]?.team_rounds_total ?? 0;
  const roundsPlayed = teamAScore + teamBScore;
  const teamAName = prettyTeamName(rowsA[0]?.team_clan_name, "Team A");
  const teamBName = prettyTeamName(rowsB[0]?.team_clan_name, "Team B");
  const winnerTeam = teamAScore === teamBScore ? null : teamAScore > teamBScore ? "A" : "B";

  const playerInfo = parsePlayerInfo(demo) as { steamid: string; name: string }[];
  const nameBySteamId = new Map(playerInfo.map((p) => [p.steamid, p.name]));

  const players: ParsedDemoPlayer[] = finalRows.map((row) => ({
    steamId64: row.steamid,
    name: nameBySteamId.get(row.steamid) ?? row.name,
    team: row.team_num === teamNumA ? "A" : "B",
    kills: row.kills_total,
    deaths: row.deaths_total,
    assists: row.assists_total,
    headshotKills: row.headshot_kills_total,
    damage: row.damage_total,
    mvps: row.mvps,
    score: row.score,
  }));

  return { mapName, teamAName, teamBName, teamAScore, teamBScore, winnerTeam, roundsPlayed, players };
}

export interface DemoImportResult {
  roomId: string;
  mapName: string;
  teamAName: string;
  teamBName: string;
  teamAScore: number;
  teamBScore: number;
}

/**
 * Parses a standalone demo file and creates a synthetic COMPLETED Room/
 * Match/MatchPlayerStats so it shows up in Players Lounge's "Previous
 * games" exactly like a match played through this app. Used for one-off
 * imports of demos that didn't come from a match this app ran (e.g. a
 * FACEIT demo) — for demos from our own live matches, see
 * attachDemoToMatch below instead, which links stats to the match that
 * already exists rather than fabricating a new room.
 *
 * Players who aren't already app members are created as isBot:true users
 * (real Steam name/id, just excluded from the Players Lounge leaderboard
 * and Admin > Users the same way test-mode bots already are) — reusing
 * that flag is a shortcut rather than a perfect semantic fit, but it gets
 * the exclusion behavior for free.
 */
export async function importDemoFile(pathOrBuffer: string | Buffer): Promise<DemoImportResult> {
  const raw = typeof pathOrBuffer === "string" ? fs.readFileSync(pathOrBuffer) : pathOrBuffer;
  const parsed = parseDemo(raw);
  const { mapName, teamAName, teamBName, teamAScore, teamBScore, winnerTeam, roundsPlayed, players } = parsed;

  const existingUsers = await db.user.findMany({
    where: { steamId64: { in: players.map((p) => p.steamId64) } },
  });
  const existingBySteamId = new Map(existingUsers.map((u) => [u.steamId64, u]));

  const hostUser =
    existingUsers.find((u) => u.role === "ADMIN") ?? (await db.user.findFirst({ where: { role: "ADMIN" } }));
  if (!hostUser) throw new Error("No admin account exists to attribute the imported match to");

  const result = await db.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: {
        ...DEFAULT_ROOM_SETTINGS,
        label: `${mapName.replace(/^de_/, "").replace(/^(.)/, (c) => c.toUpperCase())} — imported demo`,
        mapPool: JSON.stringify([mapName]),
        status: "COMPLETED",
        teamAName,
        teamBName,
        hostUserId: hostUser.id,
      },
    });

    const match = await tx.match.create({
      data: {
        roomId: room.id,
        matchzyMatchId: `demo-import-${room.id}`,
        status: "COMPLETED",
        currentMap: mapName,
        team1Score: teamAScore,
        team2Score: teamBScore,
        winnerTeam,
        connectedPlayers: JSON.stringify(players.map((p) => p.steamId64)),
        configJson: JSON.stringify({ importedFromDemo: true }),
      },
    });

    for (const p of players) {
      let user = existingBySteamId.get(p.steamId64);
      if (!user) {
        user = await tx.user.create({
          data: { steamId64: p.steamId64, name: p.name, isBot: true }, // not an app member — see doc comment above
        });
      }

      await tx.roomPlayer.create({
        data: { roomId: room.id, userId: user.id, team: p.team, isReady: true },
      });

      await tx.matchPlayerStats.create({
        data: {
          matchId: match.id,
          userId: user.id,
          team: p.team,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          headshotKills: p.headshotKills,
          damage: p.damage,
          roundsPlayed,
          mvps: p.mvps,
          score: p.score,
        },
      });
    }

    return { roomId: room.id };
  });

  return { ...result, mapName, teamAName, teamBName, teamAScore, teamBScore };
}

/**
 * Attaches parsed demo stats to a Match this app already knows about (one
 * it started itself via startMatchAction) — used by the
 * matchzy_demo_upload_url pipeline once a live match's demo comes back
 * from the server. Unlike importDemoFile, this never creates a new
 * Room/Match: it matches parsed players against the room's existing
 * roster by steamId64 (using the team they were actually assigned in the
 * lobby, not the demo's own team_num split, which isn't meaningful
 * post-match since sides swap at half). A parsed player with no matching
 * roster entry (e.g. a MatchZy-simulated bot) still gets a stats row,
 * under a lightweight isBot:true placeholder user, using the demo's own
 * team split as a fallback.
 *
 * Idempotent per (matchId, userId) — upserts rather than creates, so a
 * retried upload just overwrites with the same numbers. Note: for a BO3+
 * match, MatchZy uploads one demo per map, and this only keeps one row
 * per player per match — a second map's upload overwrites the first's
 * stats rather than aggregating across the series. Fine for the BO1
 * testing this was built for; would need a mapNumber column to do BO3+
 * properly.
 */
export async function attachDemoToMatch(matchId: string, raw: Buffer): Promise<ParsedDemo> {
  const parsed = parseDemo(raw);
  const { roundsPlayed, players } = parsed;

  const match = await db.match.findUnique({ where: { id: matchId }, include: { room: { include: { players: { include: { user: true } } } } } });
  if (!match) throw new Error(`No match found with id ${matchId}`);

  const rosterBySteamId = new Map(match.room.players.map((rp) => [rp.user.steamId64, rp]));
  const unmatched = players.filter((p) => !rosterBySteamId.has(p.steamId64));
  const newBotUsers =
    unmatched.length > 0
      ? await Promise.all(
          unmatched.map((p) =>
            db.user.upsert({
              where: { steamId64: p.steamId64 },
              update: {},
              create: { steamId64: p.steamId64, name: p.name, isBot: true },
            }),
          ),
        )
      : [];
  const botUserBySteamId = new Map(newBotUsers.map((u) => [u.steamId64, u]));

  await db.$transaction(
    players.map((p) => {
      const rosterEntry = rosterBySteamId.get(p.steamId64);
      const userId = rosterEntry?.userId ?? botUserBySteamId.get(p.steamId64)!.id;
      const team = rosterEntry?.team === "A" || rosterEntry?.team === "B" ? rosterEntry.team : p.team;
      return db.matchPlayerStats.upsert({
        where: { matchId_userId: { matchId, userId } },
        update: {
          team,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          headshotKills: p.headshotKills,
          damage: p.damage,
          roundsPlayed,
          mvps: p.mvps,
          score: p.score,
        },
        create: {
          matchId,
          userId,
          team,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          headshotKills: p.headshotKills,
          damage: p.damage,
          roundsPlayed,
          mvps: p.mvps,
          score: p.score,
        },
      });
    }),
  );

  return parsed;
}
