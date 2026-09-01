"use client";

import type { MouseEvent } from "react";
import { deleteGameAction } from "./actions";

export function DeleteGameButton({ roomId }: { roomId: string }) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm("Delete this game? This can't be undone.")) {
      e.preventDefault();
    }
  }

  return (
    <form action={deleteGameAction}>
      <input type="hidden" name="roomId" value={roomId} />
      <button
        onClick={handleClick}
        title="Delete game"
        className="rounded border border-neutral-800 text-neutral-500 hover:text-red-300 hover:border-red-800 px-2 py-1 text-xs transition-colors"
      >
        Delete
      </button>
    </form>
  );
}
