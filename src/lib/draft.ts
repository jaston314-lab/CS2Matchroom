import type { DraftStep } from "@/lib/types";

export interface DraftState {
  pool: string[]; // undrafted roomPlayerIds, in stable original order
  steps: DraftStep[]; // pick history so far
  nextTeam: "A" | "B" | null; // whose turn to pick; null once done
  done: boolean;
}

/**
 * No fixed per-team target — captains just alternate picks until the pool
 * empties, however many people showed up. That naturally produces uneven
 * teams when the pool doesn't split evenly (e.g. 7 players in the pool
 * ends up 4/3), which is intentional: team size isn't a configured
 * setting, it's just whatever the room actually has.
 */
export function computeNextTeam(lastPicker: "A" | "B" | null, firstTeam: "A" | "B"): "A" | "B" {
  if (lastPicker === null) return firstTeam;
  return lastPicker === "A" ? "B" : "A";
}

/** Sets up a fresh draft: captains alternately pick from the waiting pool. */
export function startDraft(poolIds: string[], firstTeam: "A" | "B"): DraftState {
  const pool = [...poolIds];
  const done = pool.length === 0;
  return {
    pool,
    steps: [],
    nextTeam: done ? null : firstTeam,
    done,
  };
}

/**
 * Applies one pick. Throws on an out-of-turn or invalid pick so callers
 * (the server action backing the draft UI) can surface a clear error
 * instead of silently corrupting the sequence.
 */
export function applyPick(
  state: DraftState,
  team: "A" | "B",
  roomPlayerId: string,
  firstTeam: "A" | "B",
): DraftState {
  if (state.done) throw new Error("Draft is already complete");
  if (state.nextTeam !== team) throw new Error(`It's Team ${state.nextTeam}'s turn to pick`);
  if (!state.pool.includes(roomPlayerId)) throw new Error("That player isn't available to pick");

  const pool = state.pool.filter((id) => id !== roomPlayerId);
  const steps: DraftStep[] = [...state.steps, { team, roomPlayerId }];
  const done = pool.length === 0;
  const nextTeam = done ? null : computeNextTeam(team, firstTeam);

  return { pool, steps, nextTeam, done };
}
