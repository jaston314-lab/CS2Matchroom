import type { DraftStep } from "@/lib/types";

export interface DraftState {
  pool: string[]; // undrafted roomPlayerIds, in stable original order
  steps: DraftStep[]; // pick history so far
  nextTeam: "A" | "B" | null; // whose turn to pick; null once done
  done: boolean;
}

function countOn(steps: DraftStep[], team: "A" | "B"): number {
  return steps.filter((s) => s.team === team).length;
}

/**
 * Unlike veto's plain alternation, a team that's already hit
 * targetPerTeam stops getting turns even if the pool isn't empty yet
 * (e.g. more than 10 people signed up) — the other captain just keeps
 * picking until their side is full too.
 */
export function computeNextTeam(
  countA: number,
  countB: number,
  targetPerTeam: number,
  lastPicker: "A" | "B" | null,
): "A" | "B" | null {
  const aOpen = countA < targetPerTeam;
  const bOpen = countB < targetPerTeam;
  if (!aOpen && !bOpen) return null;
  if (aOpen && bOpen) return lastPicker === "A" ? "B" : "A";
  return aOpen ? "A" : "B";
}

/** Sets up a fresh draft: captains alternately pick from the waiting pool. */
export function startDraft(poolIds: string[], firstTeam: "A" | "B", targetPerTeam: number): DraftState {
  const pool = [...poolIds];
  const done = pool.length === 0 || targetPerTeam === 0;
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
  targetPerTeam: number,
): DraftState {
  if (state.done) throw new Error("Draft is already complete");
  if (state.nextTeam !== team) throw new Error(`It's Team ${state.nextTeam}'s turn to pick`);
  if (!state.pool.includes(roomPlayerId)) throw new Error("That player isn't available to pick");

  const pool = state.pool.filter((id) => id !== roomPlayerId);
  const steps: DraftStep[] = [...state.steps, { team, roomPlayerId }];
  const countA = countOn(steps, "A");
  const countB = countOn(steps, "B");
  const nextTeam = computeNextTeam(countA, countB, targetPerTeam, team);
  const done = nextTeam === null || pool.length === 0;

  return { pool, steps, nextTeam: done ? null : nextTeam, done };
}
