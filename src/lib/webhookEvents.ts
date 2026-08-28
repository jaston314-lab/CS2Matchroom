import type { MatchStatus } from "@/lib/types";

/**
 * Best-effort interpretation of a MatchZy `matchzy_remote_log_url` webhook
 * payload. MatchZy Enhanced's docs list the event *names* but don't publish
 * exact per-event field schemas, so this reads defensively across the
 * naming conventions Get5/MatchZy commonly use and simply ignores fields it
 * doesn't recognize — nothing here is load-bearing for correctness beyond
 * "best effort live status", and the raw payload is always kept in
 * MatchEvent for a human to check. Once real payloads have been seen from
 * a live server, tighten this up.
 */

export interface MatchUpdate {
  status?: MatchStatus;
  team1Score?: number;
  team2Score?: number;
  currentMap?: string;
  currentMapIndex?: number;
  connectAdd?: string;
  connectRemove?: string;
}

function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function getEventType(payload: unknown): string {
  return asString(pick(payload, "event", "eventType", "event_type", "type")) ?? "unknown";
}

export function getMatchzyMatchId(payload: unknown): string | undefined {
  const raw = pick(payload, "matchid", "match_id", "matchId");
  return raw === undefined ? undefined : String(raw);
}

const STATUS_BY_EVENT: Record<string, MatchStatus> = {
  series_start: "WARMUP",
  match_started: "WARMUP",
  knife_round_started: "KNIFE",
  knife_start: "KNIFE",
  going_live: "LIVE",
  round_started: "LIVE",
  round_ended: "LIVE",
  halftime_started: "PAUSED",
  paused: "PAUSED",
  unpaused: "LIVE",
  series_result: "COMPLETED",
  map_result: "LIVE", // series may continue to the next map
};

export function interpretMatchzyEvent(payload: unknown): MatchUpdate {
  const eventType = getEventType(payload);
  const update: MatchUpdate = {};

  if (STATUS_BY_EVENT[eventType]) {
    update.status = STATUS_BY_EVENT[eventType];
  }

  const team1Score = asNumber(
    pick(payload, "team1_score", "team1Score") ?? pick(pick(payload, "team1"), "score"),
  );
  const team2Score = asNumber(
    pick(payload, "team2_score", "team2Score") ?? pick(pick(payload, "team2"), "score"),
  );
  if (team1Score !== undefined) update.team1Score = team1Score;
  if (team2Score !== undefined) update.team2Score = team2Score;

  const map = asString(pick(payload, "map", "map_name", "mapName"));
  if (map) update.currentMap = map;

  const mapNumber = asNumber(pick(payload, "map_number", "mapNumber"));
  if (mapNumber !== undefined) update.currentMapIndex = mapNumber;

  if (eventType === "player_connect" || eventType === "player_connected") {
    const steamid = asString(pick(payload, "steamid", "steamId", "steam_id"));
    if (steamid) update.connectAdd = steamid;
  }
  if (eventType === "player_disconnect" || eventType === "player_disconnected") {
    const steamid = asString(pick(payload, "steamid", "steamId", "steam_id"));
    if (steamid) update.connectRemove = steamid;
  }

  return update;
}
