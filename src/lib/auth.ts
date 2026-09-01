import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession, type SessionOptions } from "iron-session";
import { db } from "@/lib/db";
import { type Role, isRole } from "@/lib/types";

export interface SessionData {
  steamId64?: string;
  /** Set on the callback route when a brand-new SteamID shows up (and
   * it's not the bootstrap admin) — the /invite page reads this to know
   * who's asking, without having created their account yet. */
  pendingSteamId64?: string;
}

function sessionOptions(): SessionOptions {
  const password = process.env.APP_SECRET;
  if (!password || password.length < 32) {
    throw new Error("APP_SECRET must be at least 32 characters (see .env.example)");
  }
  return {
    cookieName: "cs2mm_session",
    password,
    ttl: 60 * 60 * 24 * 30, // 30 days
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export interface CurrentUser {
  id: string;
  steamId64: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  manualRating: number | null;
}

/**
 * Reads the session cookie and looks up the user *fresh* from the DB on
 * every call, so a role change from /admin/users takes effect on the
 * user's very next request rather than being stuck in a stale cookie.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.steamId64) return null;

  const user = await db.user.findUnique({ where: { steamId64: session.steamId64 } });
  if (!user) return null;

  return {
    id: user.id,
    steamId64: user.steamId64,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: isRole(user.role) ? user.role : "PLAYER",
    manualRating: user.manualRating,
  };
}

/** For Server Components/pages: redirects to /login if not authenticated. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For Server Components/pages: redirects if authenticated but wrong role. */
export async function requireRole(roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/matchroom");
  return user;
}
