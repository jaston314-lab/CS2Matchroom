"use client";

import type { MouseEvent } from "react";
import { deleteUserAction } from "./actions";

export function DeleteUserButton({ userId, name }: { userId: string; name: string }) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(`Remove ${name}'s account? They'll need a new invite code to join again.`)) {
      e.preventDefault();
    }
  }

  return (
    <form action={deleteUserAction}>
      <input type="hidden" name="userId" value={userId} />
      <button
        onClick={handleClick}
        title="Remove account"
        className="rounded border border-line text-muted hover:text-red-300 hover:border-red-800 px-2 py-1 text-xs transition-colors"
      >
        Remove
      </button>
    </form>
  );
}
