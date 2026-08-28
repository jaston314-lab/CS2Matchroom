"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function joinRoomByCode(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase();
  if (!code) throw new Error("Enter a room code");

  const room = await db.room.findUnique({ where: { code } });
  if (!room) throw new Error("No room found with that code");
  if (room.status === "COMPLETED" || room.status === "CANCELLED") {
    throw new Error("That room has already ended");
  }

  await db.roomPlayer.upsert({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    update: {},
    create: { roomId: room.id, userId: user.id },
  });

  redirect(`/room/${room.code}`);
}
