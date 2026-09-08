import type { VetoStep } from "@/lib/types";

export interface VetoState {
  pool: string[]; // maps not yet banned, in original pool order
  steps: VetoStep[]; // ban history so far
  nextTeam: "A" | "B" | null; // whose turn to ban; null once done
  done: boolean;
  finalMapList: string[] | null; // set once done — the maps to actually play
}

/** Sets up a fresh veto: simple alternating bans down to numMapsNeeded. */
export function startVeto(mapPool: string[], firstTeam: "A" | "B", numMapsNeeded: number): VetoState {
  if (mapPool.length < numMapsNeeded) {
    throw new Error(`Map pool has ${mapPool.length} maps, need at least ${numMapsNeeded}`);
  }
  const pool = [...mapPool];
  const done = pool.length === numMapsNeeded;
  return {
    pool,
    steps: [],
    nextTeam: done ? null : firstTeam,
    done,
    finalMapList: done ? pool : null,
  };
}

/**
 * Applies one ban. Throws on an out-of-turn or invalid ban so callers
 * (the server action backing the veto UI) can surface a clear error
 * instead of silently corrupting the sequence.
 */
export function applyBan(state: VetoState, team: "A" | "B", map: string, numMapsNeeded: number): VetoState {
  if (state.done) throw new Error("Veto is already complete");
  if (state.nextTeam !== team) throw new Error(`It's Team ${state.nextTeam}'s turn to ban`);
  if (!state.pool.includes(map)) throw new Error(`"${map}" is not available to ban`);

  const pool = state.pool.filter((m) => m !== map);
  const steps: VetoStep[] = [...state.steps, { team, map, action: "ban" }];
  const done = pool.length === numMapsNeeded;
  const nextTeam: "A" | "B" | null = done ? null : team === "A" ? "B" : "A";

  return { pool, steps, nextTeam, done, finalMapList: done ? pool : null };
}

/**
 * Only relevant when there's no knife round to decide starting sides.
 * Whoever cast the LAST ban effectively chose what survived (eliminating
 * one of the last two maps is the same as picking the other one) — so
 * their opponent gets the consolation of choosing a side instead. Returns
 * null when the veto resolved with zero bans at all (the pool already
 * matched the format's map count — e.g. a single map picked directly) —
 * there's no "last picker" to react against, so the caller should resolve
 * that case with a coin flip instead.
 */
export function sideChoiceTeamFromSteps(steps: VetoStep[]): "A" | "B" | null {
  if (steps.length === 0) return null;
  const lastBanner = steps[steps.length - 1].team;
  return lastBanner === "A" ? "B" : "A";
}
