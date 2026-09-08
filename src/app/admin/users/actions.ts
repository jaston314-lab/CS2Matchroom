"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRole } from "@/lib/types";

export async function updateUserRole(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role"));
  if (!isRole(role)) throw new Error("Invalid role");

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("User not found");

  if (target.role === "ADMIN" && role !== "ADMIN") {
    const otherAdmins = await db.user.count({ where: { role: "ADMIN", id: { not: userId } } });
    if (otherAdmins === 0) {
      throw new Error("Can't demote the last remaining admin");
    }
  }

  await db.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/admin/users");
}

/**
 * Fully removes a user's account — not just a role change. Since the Steam
 * callback only auto-logs someone in when a User row for their SteamID
 * already exists, deleting the row is exactly what makes them need an
 * invite code again if they come back.
 *
 * A user's own RoomPlayer/MatchPlayerStats rows are deleted with them —
 * that's just their own participation record, not the room/match itself,
 * so other players' history is untouched. Any room they hosted gets
 * reassigned to another admin (same placeholder-host pattern used
 * elsewhere) rather than left with a dangling reference.
 */
export async function deleteUserAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Missing userId");

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) return; // already gone

  if (target.role === "ADMIN") {
    const otherAdmins = await db.user.count({ where: { role: "ADMIN", id: { not: userId } } });
    if (otherAdmins === 0) {
      throw new Error("Can't delete the last remaining admin");
    }
  }

  const fallbackHost = await db.user.findFirst({ where: { role: "ADMIN", id: { not: userId } } });

  await db.$transaction(async (tx) => {
    await tx.roomPlayer.deleteMany({ where: { userId } });
    await tx.matchPlayerStats.deleteMany({ where: { userId } });
    if (fallbackHost) {
      await tx.room.updateMany({ where: { hostUserId: userId }, data: { hostUserId: fallbackHost.id } });
    }
    await tx.user.delete({ where: { id: userId } });
  });

  revalidatePath("/admin/users");
  revalidatePath("/lounge");
}
