import "server-only";

const LEETIFY_BASE_URL = "https://api-public.cs-prod.leetify.com";
const CACHE_TTL_MS = 5 * 60_000;

interface LeetifyProfileResponse {
  privacy_mode?: "public" | "private";
  ranks?: { premier: number | null };
  error?: string;
}

interface CacheEntry {
  value: number | null;
  expires: number;
}

// In-memory only, never written to the DB — Leetify's developer guidelines
// ask that data from their API not be stored, only fetched fresh each time
// (https://leetify.com/blog/leetify-api-developer-guidelines/, #6). This
// cache doesn't violate that: it's ephemeral, resets on every server
// restart, and self-expires — it exists purely so the matchroom page's 3s
// AutoRefresh poll (see AutoRefresh.tsx) doesn't re-fetch every player's
// rating from Leetify on every single tick, which is what actually got us
// rate-limited.
const cache = new Map<string, CacheEntry>();

async function fetchLeetifyRatingUncached(steamId64: string): Promise<number | null> {
  try {
    const url = new URL("/v3/profile", LEETIFY_BASE_URL);
    // The wire format is steam64_id, not steamId — confirmed against
    // Leetify's actual API (their own JS SDK's `steamId` input param gets
    // translated to this before being sent).
    url.searchParams.set("steam64_id", steamId64);

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
    if (data.error || data.privacy_mode === "private") return null;
    return data.ranks?.premier ?? null;
  } catch {
    return null; // network error, timeout, malformed response — treat as "no data"
  }
}

/**
 * Looks up a player's CS2 Premier rating from Leetify's public API
 * (GET /v3/profile?steam64_id=...). Returns null if the player has no
 * Leetify data, their profile is private, or the call fails/times out —
 * callers should fall back to the player's manually-entered rating.
 */
export async function fetchLeetifyRating(steamId64: string): Promise<number | null> {
  const now = Date.now();
  const cached = cache.get(steamId64);
  if (cached && cached.expires > now) return cached.value;

  const value = await fetchLeetifyRatingUncached(steamId64);
  cache.set(steamId64, { value, expires: now + CACHE_TTL_MS });
  return value;
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

// ---- Roster filters for Scramble/Balance (pure, unit-tested in
// rating.test.ts) ----
//
// Both actions.ts's scrambleTeams and balanceTeamsAction used to inline
// their own "who's eligible" filter directly against room.players, and
// both independently forgot to exclude coaches — Balance could reassign a
// team's coach to the other team as a regular player, landing two coaches
// on one side. Pulling the filters out here means there's exactly one
// place that decides "who counts as a movable competitive player", it's
// covered by tests, and a future third caller can't repeat the mistake.

export interface RosterEntry {
  id: string;
  team: string;
  isCaptain: boolean;
  isCoach: boolean;
}

/** Scramble's movable pool: on a team, not a coach, and not a captain
 * (captains stay put as each team's anchor). */
export function scrambleCandidates<T extends RosterEntry>(players: T[]): T[] {
  return players.filter((p) => (p.team === "A" || p.team === "B") && !p.isCaptain && !p.isCoach);
}

/** Balance's rateable pool: on a team, not a coach. Captains ARE included
 * here (unlike scramble) — balanceTeams below anchors on them itself and
 * needs their rating to do it. */
export function balanceCandidates<T extends RosterEntry>(players: T[]): T[] {
  return players.filter((p) => (p.team === "A" || p.team === "B") && !p.isCoach);
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

  // Processing order is jittered (±15% of each player's rating) so mashing
  // the Balance button repeatedly actually explores different splits
  // instead of recomputing the exact same one every time — the greedy
  // assignment below still runs on *real* ratings, so overall balance
  // quality doesn't suffer, only which near-equally-rated player lands on
  // which side. The jitter is computed once per player up front, not
  // inside the comparator, so the sort stays a valid strict-weak-order
  // (recomputing it per-comparison would make .sort's behavior undefined).
  const movable = onATeam
    .filter((e) => e.roomPlayerId !== captainA?.roomPlayerId && e.roomPlayerId !== captainB?.roomPlayerId)
    .map((e) => ({ ...e, rating: e.rating ?? fallback }))
    .map((e) => ({ ...e, sortKey: (e.rating ?? 0) * (1 + (Math.random() - 0.5) * 0.3) }))
    .sort((a, b) => b.sortKey - a.sortKey);

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
