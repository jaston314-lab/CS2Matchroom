"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Deletes a completed/cancelled room from Previous games — cascades to its
 * Match/RoomPlayer/Veto/Draft/MatchEvent/MatchPlayerStats rows via the
 * schema's onDelete: Cascade, same as cancelMatchAction's early-cancel
 * cleanup. Admin-only: unlike the live matchroom (any host can manage),
 * deleting history is destructive and permanent.
 */
export async function deleteGameAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const roomId = String(formData.get("roomId") ?? "");
  if (!roomId) throw new Error("Missing roomId");

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room) return; // already gone
  if (room.status !== "COMPLETED" && room.status !== "CANCELLED") {
    throw new Error("Can only delete a finished or cancelled game");
  }

  await db.room.delete({ where: { id: roomId } });
  revalidatePath("/lounge");
}
