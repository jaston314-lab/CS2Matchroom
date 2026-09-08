"use client";

import { useEffect, useState } from "react";
import { chooseSideAction } from "./actions";

/**
 * Shown once maps are resolved on a room with no knife round — something
 * has to decide starting sides instead. Two cases, both ending in the same
 * "pick CT or T" step:
 *
 *  - A real veto happened (wasCoinFlip=false): the team that DIDN'T cast
 *    the deciding ban gets the choice — they didn't get the last map
 *    pick, so they get the side pick instead (sideChoiceTeamFromSteps).
 *  - No veto happened at all — a single map was picked directly, so
 *    there's no "last picker" to react against (wasCoinFlip=true): a
 *    coin flip decides who chooses instead. The flip itself is already
 *    resolved server-side by the time this renders (so every viewer sees
 *    the same real outcome, whenever they load the page) — the spin here
 *    is just a local, cosmetic reveal of that already-decided result.
 */
export function SideChoice({
  sideChoiceTeam,
  chosenSide,
  teamAName,
  teamBName,
  wasCoinFlip,
  canChoose,
}: {
  sideChoiceTeam: "A" | "B";
  chosenSide: "CT" | "T" | null;
  teamAName: string;
  teamBName: string;
  wasCoinFlip: boolean;
  canChoose: boolean;
}) {
  const chooserName = sideChoiceTeam === "A" ? teamAName : teamBName;
  // Only the coin-flip case gets the little spin-then-reveal moment — a
  // real veto's outcome was already visible step by step as bans landed,
  // there's nothing to "reveal" there.
  const [revealed, setRevealed] = useState(!wasCoinFlip);

  useEffect(() => {
    if (!wasCoinFlip) return;
    const t = setTimeout(() => setRevealed(true), 1600);
    return () => clearTimeout(t);
  }, [wasCoinFlip]);

  async function pick(side: "CT" | "T") {
    const formData = new FormData();
    formData.set("side", side);
    try {
      await chooseSideAction(formData);
    } catch (err) {
      console.error("Failed to choose side:", err);
    }
  }

  if (wasCoinFlip && !revealed) {
    return (
      <div className="rounded-lg border border-line bg-input/50 px-3 py-3 text-center space-y-2">
        <div className="mx-auto w-9 h-9 rounded-full border-2 border-line bg-accent-gray animate-spin flex items-center justify-center text-base leading-none">
          🪙
        </div>
        <p className="text-xs text-muted">No veto happened — flipping a coin for side choice…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-input/50 px-3 py-2.5 text-center space-y-1.5">
      {wasCoinFlip ? (
        <p className="text-[11px] text-muted/70">
          Coin flip: <span className="text-white font-semibold">{chooserName}</span> won
        </p>
      ) : (
        <p className="text-[11px] text-muted/70">
          No knife round — <span className="text-white font-semibold">{chooserName}</span> didn&apos;t get the
          last map pick, so they choose a side
        </p>
      )}
      {chosenSide ? (
        <p className="text-xs text-ink">
          <span className="text-white font-semibold">{chooserName}</span> chose to start{" "}
          <span className="font-semibold">{chosenSide}</span>
        </p>
      ) : canChoose ? (
        <div className="flex gap-2 justify-center pt-0.5">
          <button
            type="button"
            onClick={() => pick("CT")}
            className="rounded-md bg-accent-blue hover:bg-accent-blue-hover text-white text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            Start CT
          </button>
          <button
            type="button"
            onClick={() => pick("T")}
            className="rounded-md bg-accent-gray hover:bg-accent-gray-hover text-white text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            Start T
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">Waiting on {chooserName}&apos;s captain (or an admin)</p>
      )}
    </div>
  );
}
