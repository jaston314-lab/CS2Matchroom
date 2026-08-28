import { NextResponse } from "next/server";
import { getSteamLoginUrl } from "@/lib/steam";

export async function GET() {
  try {
    const url = await getSteamLoginUrl();
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Failed to start Steam login:", error);
    return NextResponse.redirect(
      new URL("/login?error=steam_unavailable", process.env.APP_PUBLIC_URL ?? "http://localhost:3000"),
    );
  }
}
