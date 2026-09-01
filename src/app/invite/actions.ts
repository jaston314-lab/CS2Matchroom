"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchSteamProfile } from "@/lib/steam";

export async function submitInviteCode(formData: FormData): Promise<void> {
  const session = await getSession();
  const steamId64 = session.pendingSteamId64;
  if (!steamId64) redirect("/login");

  const code = String(formData.get("inviteCode") ?? "")
    .trim()
    .toUpperCase();

  const config = await db.serverConfig.findUnique({ where: { id: "singleton" } });
  if (!config?.inviteCode || !code || code !== config.inviteCode) {
    // Wrong or missing code — clear everything and send them back to square one.
    session.pendingSteamId64 = undefined;
    session.steamId64 = undefined;
    await session.save();
    redirect("/login?error=invalid_invite");
  }

  const profile = await fetchSteamProfile(steamId64);
  await db.user.create({
    data: { steamId64, name: profile.name, avatarUrl: profile.avatarUrl, role: "PLAYER" },
  });

  session.steamId64 = steamId64;
  session.pendingSteamId64 = undefined;
  await session.save();
  redirect("/matchroom");
}
