"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateRoomCode } from "@/lib/roomCode";
import { FORMATS, mapsRequiredForFormat, type Format } from "@/lib/types";
import { AVAILABLE_MAPS } from "@/lib/maps";

export async function createRoom(formData: FormData): Promise<void> {
  const user = await requireRole(["HOST", "ADMIN"]);

  const label = String(formData.get("label") ?? "").trim();
  const formatRaw = String(formData.get("format") ?? "BO1");
  const mapPool = formData.getAll("mapPool").map(String);
  const knifeRound = formData.get("knifeRound") === "on";
  const overtimeEnabled = formData.get("overtimeEnabled") === "on";
  const minPlayersToStart = Number(formData.get("minPlayersToStart") ?? 10);
  const playersPerTeam = Number(formData.get("playersPerTeam") ?? 5);

  if (!label) throw new Error("Room name is required");
  if (!(FORMATS as readonly string[]).includes(formatRaw)) throw new Error("Invalid format");
  const format = formatRaw as Format;

  const validMapIds = new Set<string>(AVAILABLE_MAPS.map((m) => m.id));
  const cleanPool = mapPool.filter((m) => validMapIds.has(m));
  const required = mapsRequiredForFormat(format);
  if (cleanPool.length < required) {
    throw new Error(`Pick at least ${required} map(s) for ${format}`);
  }

  if (!Number.isInteger(minPlayersToStart) || minPlayersToStart < 2 || minPlayersToStart > 20) {
    throw new Error("Min players to start must be between 2 and 20");
  }
  if (!Number.isInteger(playersPerTeam) || playersPerTeam < 1 || playersPerTeam > 10) {
    throw new Error("Players per team must be between 1 and 10");
  }

  let code = "";
  let attempts = 0;
  // Extremely unlikely to collide, but retry a few times rather than crash.
  while (attempts < 5) {
    const candidate = generateRoomCode();
    const existing = await db.room.findUnique({ where: { code: candidate } });
    if (!existing) {
      code = candidate;
      break;
    }
    attempts++;
  }
  if (!code) throw new Error("Couldn't generate a unique room code, try again");

  const room = await db.room.create({
    data: {
      code,
      label,
      hostUserId: user.id,
      format,
      mapPool: JSON.stringify(cleanPool),
      knifeRound,
      overtimeEnabled,
      minPlayersToStart,
      playersPerTeam,
    },
  });

  redirect(`/room/${room.code}`);
}
