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
