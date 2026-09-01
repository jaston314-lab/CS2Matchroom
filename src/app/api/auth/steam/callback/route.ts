import { NextRequest, NextResponse } from "next/server";
import { verifySteamCallback, fetchSteamProfile } from "@/lib/steam";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

function redirectTo(path: string) {
  const base = (process.env.APP_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return NextResponse.redirect(`${base}${path}`);
}

export async function GET(request: NextRequest) {
  // Rebuild the callback URL from APP_PUBLIC_URL (not request.url) so it
  // exactly matches the returnUrl used to start the login, even behind a
  // reverse proxy that might otherwise change host/scheme.
  const base = (process.env.APP_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const incoming = new URL(request.url);
  const callbackUrl = `${base}/api/auth/steam/callback${incoming.search}`;

  let steamId64: string | null;
  try {
    steamId64 = await verifySteamCallback(callbackUrl);
  } catch (error) {
    console.error("Steam OpenID verification failed:", error);
    return redirectTo("/login?error=verification_failed");
  }

  if (!steamId64) {
    return redirectTo("/login?error=not_authenticated");
  }

  const existing = await db.user.findUnique({ where: { steamId64 } });
  const session = await getSession();

  if (existing) {
    const profile = await fetchSteamProfile(steamId64);
    await db.user.update({
      where: { steamId64 },
      data: { name: profile.name, avatarUrl: profile.avatarUrl },
    });
    session.steamId64 = steamId64;
    session.pendingSteamId64 = undefined;
    await session.save();
    return redirectTo("/matchroom");
  }

  // Bootstrap: whoever logs in first becomes admin, so there's no manual
  // DB edit needed on a fresh install, and no invite code is required for
  // it. Tiny race if two people somehow log in for the very first time
  // simultaneously — not worth guarding against for a small friend-group app.
  const isFirstUserEver = (await db.user.count()) === 0;
  if (isFirstUserEver) {
    const profile = await fetchSteamProfile(steamId64);
    await db.user.create({
      data: { steamId64, name: profile.name, avatarUrl: profile.avatarUrl, role: "ADMIN" },
    });
    session.steamId64 = steamId64;
    session.pendingSteamId64 = undefined;
    await session.save();
    return redirectTo("/matchroom");
  }

  // Unknown SteamID, not the bootstrap case — don't create an account yet,
  // send them to enter an invite code first.
  session.pendingSteamId64 = steamId64;
  session.steamId64 = undefined;
  await session.save();
  return redirectTo("/invite");
}
