import { NextResponse } from "next/server";
import { getSteamLoginUrl } from "@/lib/steam";

function redirectTo(path: string) {
  const base = (process.env.APP_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return NextResponse.redirect(`${base}${path}`);
}

export async function GET() {
  try {
    const url = await getSteamLoginUrl();
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Failed to start Steam login:", error);
    return redirectTo("/login?error=steam_unavailable");
  }
}
