import "server-only";

const LEETIFY_BASE_URL = "https://api-public.cs-prod.leetify.com";
const MATCH_SAMPLE_SIZE = 30;
const CACHE_TTL_MS = 5 * 60_000;

interface MatchPlayerStats {
  steam64_id: string;
  total_kills: number;
  total_deaths: number;
  total_assists: number;
  total_damage: number;
  rounds_count: number;
  rounds_won: number;
  rounds_lost: number;
  leetify_rating: number;
}

interface MatchDetailsResponse {
  stats?: MatchPlayerStats[];
}

export interface LeetifyMatchStats {
  matchesCounted: number;
  winPct: number;
  /** 1 + average per-match rating delta — 1.00 is dead average, same read as HLTV Rating 2.0. */
  rating: number;
  /** That same average delta, shown as a percentage (Leetify's own "swing" framing). */
  swingPct: number;
  /** Per-match averages (rounded), not totals across the sample — e.g. "16/16/5", not "480/480/150". */
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  kpr: number | null;
  adr: number | null;
}

interface CacheEntry {
  value: LeetifyMatchStats | null;
  expires: number;
}

// In-memory only, never written to the DB — Leetify's developer guidelines
// ask that data from their API not be stored, only fetched fresh each time
// (https://leetify.com/blog/leetify-api-developer-guidelines/, #6). This
// cache doesn't violate that: it's ephemeral, resets on every server
// restart, and self-expires. It exists because the matchroom page
// re-renders every viewer's tree every 3s (see AutoRefresh.tsx) — without
// it, every poll tick from every viewer would re-fetch every player's full
// match history from Leetify, which is exactly what got us rate-limited.
const cache = new Map<string, CacheEntry>();

async function fetchRecentMatches(steamId64: string): Promise<MatchDetailsResponse[] | null> {
  const url = new URL("/v3/profile/matches", LEETIFY_BASE_URL);
  url.searchParams.set("steam64_id", steamId64);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.LEETIFY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.LEETIFY_API_KEY}`;
  }

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as MatchDetailsResponse[]) : null;
  } catch {
    return null; // network error, timeout, malformed response — treat as "no data"
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aggregate box-score stats over a player's last 30 matches (whatever mix
 * of matchmaking/Faceit/wingman Leetify has ingested for them) — the same
 * "last N matches" strip Leetify shows on their own site. Leetify's public
 * API doesn't expose an official "Rating"/"Swing" field, so those two are
 * our own read of their per-match `leetify_rating` delta (see the
 * `LeetifyMatchStats` doc comments) — everything else (K/D/A, K/D, K/R,
 * ADR, win%) is a direct sum/average of real box-score fields.
 */
export async function fetchLeetifyMatchStats(steamId64: string): Promise<LeetifyMatchStats | null> {
  const now = Date.now();
  const cached = cache.get(steamId64);
  if (cached && cached.expires > now) return cached.value;

  const matches = await fetchRecentMatches(steamId64);
  let value: LeetifyMatchStats | null = null;

  if (matches && matches.length > 0) {
    const sample = matches.slice(0, MATCH_SAMPLE_SIZE);
    let wins = 0;
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    let damage = 0;
    let rounds = 0;
    let ratingSum = 0;
    let counted = 0;

    for (const match of sample) {
      const mine = match.stats?.find((s) => s.steam64_id === steamId64);
      if (!mine) continue;
      counted++;
      if (mine.rounds_won > mine.rounds_lost) wins++;
      totalKills += mine.total_kills;
      totalDeaths += mine.total_deaths;
      totalAssists += mine.total_assists;
      damage += mine.total_damage;
      rounds += mine.rounds_count;
      ratingSum += mine.leetify_rating;
    }

    if (counted > 0) {
      const avgSwing = ratingSum / counted;
      value = {
        matchesCounted: counted,
        winPct: (wins / counted) * 100,
        rating: 1 + avgSwing,
        swingPct: avgSwing * 100,
        kills: Math.round(totalKills / counted),
        deaths: Math.round(totalDeaths / counted),
        assists: Math.round(totalAssists / counted),
        kd: totalDeaths > 0 ? totalKills / totalDeaths : totalKills,
        kpr: rounds > 0 ? totalKills / rounds : null,
        adr: rounds > 0 ? damage / rounds : null,
      };
    }
  }

  cache.set(steamId64, { value, expires: now + CACHE_TTL_MS });
  return value;
}

export async function fetchLeetifyMatchStatsForRoom(
  steamId64s: string[],
): Promise<Map<string, LeetifyMatchStats | null>> {
  const unique = Array.from(new Set(steamId64s));
  const resolved = await Promise.all(
    unique.map(async (id) => [id, await fetchLeetifyMatchStats(id)] as const),
  );
  return new Map(resolved);
}
