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
  // A row can already exist here as an isPlaceholder:true placeholder
  // (created by demoImport.ts or a bot-simulation match to attribute
  // historical stats to this SteamID) — a plain create() would crash on
  // the unique constraint. Promote it to a real member instead of creating
  // a duplicate, so any of their existing stats stay correctly attributed.
  // isBot gets cleared too on principle — a successful real Steam login is
  // definitive proof this was never actually a synthetic bot identity.
  await db.user.upsert({
    where: { steamId64 },
    update: { name: profile.name, avatarUrl: profile.avatarUrl, isPlaceholder: false, isBot: false },
    create: { steamId64, name: profile.name, avatarUrl: profile.avatarUrl, role: "PLAYER" },
  });

  session.steamId64 = steamId64;
  session.pendingSteamId64 = undefined;
  await session.save();
  redirect("/matchroom");
}
