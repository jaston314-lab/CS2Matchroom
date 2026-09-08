"use client";

import type { ChangeEvent } from "react";
import { assignCoach } from "./actions";

/**
 * The empty coach slot, for hosts: a dashed "+" placeholder that's also a
 * native <select> of everyone eligible (this team's own roster, plus
 * anyone still in the waiting pool) — picking a name assigns them as coach
 * in one step. assignCoach already sets both `team` and `isCoach` in one
 * write, so this works identically whether the pick came from the team's
 * own players or from the pool — no separate "promote" vs "pull in" action
 * needed.
 */
export function CoachPicker({
  team,
  candidates,
}: {
  team: "A" | "B";
  candidates: { id: string; name: string }[];
}) {
  async function handleChange(e: ChangeEvent<HTMLSelectElement>) {
    const roomPlayerId = e.target.value;
    if (!roomPlayerId) return;
    e.target.value = ""; // reset right away so picking the same name twice still fires onChange
    const formData = new FormData();
    formData.set("roomPlayerId", roomPlayerId);
    formData.set("team", team);
    try {
      await assignCoach(formData);
    } catch (err) {
      console.error("Failed to assign coach:", err);
    }
  }

  if (candidates.length === 0) {
    // Nobody eligible to pick from right now — plain empty slot, not a
    // dropdown with nothing in it.
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-input/50 px-2.5 py-1.5 text-xs text-muted">
        <span className="w-7 h-7 rounded-full border border-dashed border-line shrink-0" />
        Empty · Coach
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-input/50 px-2.5 py-1.5">
      <span className="w-7 h-7 rounded-full border border-dashed border-line shrink-0 flex items-center justify-center text-muted text-sm leading-none">
        +
      </span>
      <select
        defaultValue=""
        onChange={handleChange}
        title="Assign coach"
        className="min-w-0 flex-1 bg-transparent text-xs text-muted focus:outline-none cursor-pointer"
      >
        <option value="" disabled>
          Assign coach…
        </option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id} className="bg-input text-ink">
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
