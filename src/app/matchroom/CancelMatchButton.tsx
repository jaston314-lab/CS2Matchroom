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
export function CancelMatchButton() {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm("Cancel this match? Teams and veto progress will be lost.")) {
      e.preventDefault();
    }
  }

  return (
    <form action={cancelMatchAction}>
      <button
        onClick={handleClick}
        className="rounded-lg border border-red-900 text-red-300 px-3 py-1.5 text-sm hover:border-red-700 transition-colors"
      >
        Cancel match
      </button>
    </form>
  );
}
