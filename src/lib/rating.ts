import "server-only";

const LEETIFY_BASE_URL = "https://api-public.cs-prod.leetify.com";

interface LeetifyProfileResponse {
  privacy_mode: "public" | "private";
  ranks: { premier: number | null };
}

/**
 * Looks up a player's CS2 Premier rating from Leetify's public API
 * (GET /v3/profile?steamId=...). Returns null if the player has no
 * Leetify data, their profile is private, or the call fails/times out —
 * callers should fall back to the player's manually-entered rating.
 *
 * Per Leetify's API guidelines this value must not be persisted — always
 * fetch fresh, never cache in the DB.
 */
export async function fetchLeetifyRating(steamId64: string): Promise<number | null> {
  try {
    const url = new URL("/v3/profile", LEETIFY_BASE_URL);
    url.searchParams.set("steamId", steamId64);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.LEETIFY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.LEETIFY_API_KEY}`;
    }

    let res: Response;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) return null;
    const data = (await res.json()) as LeetifyProfileResponse;
    if (data.privacy_mode === "private") return null;
    return data.ranks?.premier ?? null;
  } catch {
    return null; // network error, timeout, malformed response — treat as "no data"
  }
}

export interface RatedPlayer {
  steamId64: string;
  manualRating: number | null;
}

export interface ResolvedRating {
  steamId64: string;
  rating: number | null;
  source: "leetify" | "manual" | "none";
}

/** Leetify first, self-reported manual rating as fallback. */
export async function resolvePlayerRating(player: RatedPlayer): Promise<ResolvedRating> {
  const leetify = await fetchLeetifyRating(player.steamId64);
  if (leetify !== null) {
    return { steamId64: player.steamId64, rating: leetify, source: "leetify" };
  }
  if (player.manualRating !== null) {
    return { steamId64: player.steamId64, rating: player.manualRating, source: "manual" };
  }
  return { steamId64: player.steamId64, rating: null, source: "none" };
}

export async function resolveRatingsForRoom(
  players: RatedPlayer[],
): Promise<Map<string, ResolvedRating>> {
  const resolved = await Promise.all(players.map(resolvePlayerRating));
  return new Map(resolved.map((r) => [r.steamId64, r]));
}

// ---- Balance algorithm (pure, unit-tested in rating.test.ts) ----

export interface BalanceEntry {
  roomPlayerId: string;
  steamId64: string;
  isCaptain: boolean;
  team: "A" | "B" | "UNASSIGNED";
  rating: number | null;
}

/**
 * Rebalances players currently on Team A/B to minimize the rating gap
 * between teams, leaving captains in place as anchors. Players with no
 * resolved rating are filled in with the average of known ratings among
 * the pool (neutral guess) so one unrated friend doesn't get treated as a
 * zero and dumped onto whichever team is "winning". UNASSIGNED players are
 * left untouched — they haven't picked a side yet.
 *
 * Returns a Map of roomPlayerId -> "A" | "B" for every player that was on
 * a team (captains included, unchanged).
 */
export function balanceTeams(entries: BalanceEntry[]): Map<string, "A" | "B"> {
  const onATeam = entries.filter((e) => e.team === "A" || e.team === "B");
  const known = onATeam.map((e) => e.rating).filter((r): r is number => r !== null);
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1000;

  const result = new Map<string, "A" | "B">();

  const captainA = onATeam.find((e) => e.isCaptain && e.team === "A");
  const captainB = onATeam.find((e) => e.isCaptain && e.team === "B");
  if (captainA) result.set(captainA.roomPlayerId, "A");
  if (captainB) result.set(captainB.roomPlayerId, "B");

  let totalA = captainA ? (captainA.rating ?? fallback) : 0;
  let totalB = captainB ? (captainB.rating ?? fallback) : 0;

  const movable = onATeam
    .filter((e) => e.roomPlayerId !== captainA?.roomPlayerId && e.roomPlayerId !== captainB?.roomPlayerId)
    .map((e) => ({ ...e, rating: e.rating ?? fallback }))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  for (const player of movable) {
    if (totalA <= totalB) {
      result.set(player.roomPlayerId, "A");
      totalA += player.rating ?? fallback;
    } else {
      result.set(player.roomPlayerId, "B");
      totalB += player.rating ?? fallback;
    }
  }

  return result;
}
