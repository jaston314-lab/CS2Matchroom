"use client";

import type { MouseEvent } from "react";
import { cancelMatchAction } from "./actions";

/**
 * Host/admin escape hatch during veto — if teams or map bans are wrong,
 * this bails out of the whole match instead of forcing it through. See
 * cancelMatchAction: if zero rounds were ever played (always true at this
 * phase — the game doesn't even exist on the server yet), the room is
 * deleted outright rather than left behind as a "cancelled" entry in the
 * Players Lounge history.
 */
export function CancelMatchButton({ fullWidth = false }: { fullWidth?: boolean }) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm("Cancel this match? Teams and veto progress will be lost.")) {
      e.preventDefault();
    }
  }

  return (
    <form action={cancelMatchAction} className={fullWidth ? "w-full" : undefined}>
      <button
        onClick={handleClick}
        className={`rounded-lg bg-red-950/50 text-red-300 hover:bg-red-900/60 transition-colors ${
          fullWidth ? "w-full py-2.5 text-sm font-bold" : "px-3 py-1.5 text-sm"
        }`}
      >
        Cancel match
      </button>
    </form>
  );
}
