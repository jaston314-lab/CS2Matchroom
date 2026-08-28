"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function updateManualRating(formData: FormData): Promise<void> {
  const user = await requireUser();
  const raw = String(formData.get("manualRating") ?? "").trim();

  const manualRating = raw === "" ? null : Number(raw);
  if (manualRating !== null && (!Number.isFinite(manualRating) || manualRating < 0 || manualRating > 40000)) {
    throw new Error("Rating must be a number between 0 and 40000");
  }

  await db.user.update({ where: { id: user.id }, data: { manualRating } });
  revalidatePath("/profile");
}
