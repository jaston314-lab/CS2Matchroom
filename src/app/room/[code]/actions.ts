"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mapsRequiredForFormat, type Format, type Team, type VetoStep } from "@/lib/types";
import { startVeto, applyBan } from "@/lib/veto";
import { balanceTeams, resolveRatingsForRoom, type BalanceEntry } from "@/lib/rating";
import { buildMatchConfig } from "@/lib/matchzyConfig";
import { getServerConfig, loadMatch, endMatch } from "@/lib/rcon";

async function loadRoomOrThrow(code: string) {
  const room = await db.room.findUnique({ where: { code }, include: { players: true } });
  if (!room) throw new Error("Room not found");
  return room;
}

function assertHost(room: { hostUserId: string }, user: CurrentUser) {
  if (room.hostUserId !== user.id && user.role !== "ADMIN") {
    throw new Error("Only the host can do that");
  }
}

function revalidateRoom(code: string) {
  revalidatePath(`/room/${code}`);
}

export async function joinRoom(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await loadRoomOrThrow(code);
  if (room.status === "COMPLETED" || room.status === "CANCELLED") {
    throw new Error("This room has already ended");
  }
  await db.roomPlayer.upsert({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    update: {},
    create: { roomId: room.id, userId: user.id },
  });
  revalidateRoom(code);
}

export async function leaveRoom(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await loadRoomOrThrow(code);
  await db.roomPlayer.deleteMany({ where: { roomId: room.id, userId: user.id } });
  revalidateRoom(code);
}

export async function setTeam(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const team = String(formData.get("team")) as Team;
  const room = await loadRoomOrThrow(code);
  if (room.status === "LIVE" || room.status === "COMPLETED") {
    throw new Error("Teams are locked once the match has started");
  }
  await db.roomPlayer.update({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    data: { team },
  });
  revalidateRoom(code);
}

export async function setReady(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const ready = formData.get("ready") === "true";
  const room = await loadRoomOrThrow(code);
  await db.roomPlayer.update({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    data: { isReady: ready },
  });
  revalidateRoom(code);
}

export async function toggleCaptain(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const targetRoomPlayerId = String(formData.get("roomPlayerId"));
  const room = await loadRoomOrThrow(code);
  assertHost(room, user);

  const target = room.players.find((p) => p.id === targetRoomPlayerId);
  if (!target || target.team === "UNASSIGNED") {
    throw new Error("Player must be on a team to be made captain");
  }

  await db.$transaction(async (tx) => {
    if (!target.isCaptain) {
      // Only one captain per team — demote whoever currently holds it.
      await tx.roomPlayer.updateMany({
        where: { roomId: room.id, team: target.team, isCaptain: true },
        data: { isCaptain: false },
      });
    }
    await tx.roomPlayer.update({
      where: { id: target.id },
      data: { isCaptain: !target.isCaptain },
    });
  });
  revalidateRoom(code);
}

export async function scrambleTeams(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await loadRoomOrThrow(code);
  assertHost(room, user);

  const movable = room.players.filter(
    (p) => (p.team === "A" || p.team === "B") && !p.isCaptain,
  );
  const shuffled = [...movable].sort(() => Math.random() - 0.5);
  const half = Math.ceil(shuffled.length / 2);
  const teamA = shuffled.slice(0, half);
  const teamB = shuffled.slice(half);

  await db.$transaction([
    ...teamA.map((p) => db.roomPlayer.update({ where: { id: p.id }, data: { team: "A" } })),
    ...teamB.map((p) => db.roomPlayer.update({ where: { id: p.id }, data: { team: "B" } })),
  ]);
  revalidateRoom(code);
}

export async function balanceTeamsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await loadRoomOrThrow(code);
  assertHost(room, user);

  const onTeam = room.players.filter((p) => p.team === "A" || p.team === "B");
  const users = await db.user.findMany({ where: { id: { in: onTeam.map((p) => p.userId) } } });
  const userById = new Map(users.map((u) => [u.id, u]));

  const ratings = await resolveRatingsForRoom(
    users.map((u) => ({ steamId64: u.steamId64, manualRating: u.manualRating })),
  );

  const entries: BalanceEntry[] = onTeam.map((p) => {
    const u = userById.get(p.userId)!;
    return {
      roomPlayerId: p.id,
      steamId64: u.steamId64,
      isCaptain: p.isCaptain,
      team: p.team as "A" | "B",
      rating: ratings.get(u.steamId64)?.rating ?? null,
    };
  });

  const assignment = balanceTeams(entries);
  await db.$transaction(
    [...assignment.entries()].map(([roomPlayerId, team]) =>
      db.roomPlayer.update({ where: { id: roomPlayerId }, data: { team } }),
    ),
  );
  revalidateRoom(code);
}

export async function startVetoAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await loadRoomOrThrow(code);
  assertHost(room, user);

  const mapPool = JSON.parse(room.mapPool) as string[];
  const required = mapsRequiredForFormat(room.format as Format);
  const state = startVeto(mapPool, "A", required);

  await db.veto.upsert({
    where: { roomId: room.id },
    update: {
      status: state.done ? "DONE" : "IN_PROGRESS",
      steps: JSON.stringify(state.steps),
      finalMapList: state.finalMapList ? JSON.stringify(state.finalMapList) : null,
      overriddenByHost: false,
    },
    create: {
      roomId: room.id,
      status: state.done ? "DONE" : "IN_PROGRESS",
      steps: JSON.stringify(state.steps),
      finalMapList: state.finalMapList ? JSON.stringify(state.finalMapList) : null,
    },
  });
  if (room.status === "LOBBY") {
    await db.room.update({
      where: { id: room.id },
      data: { status: state.done ? "READY" : "VETO" },
    });
  }
  revalidateRoom(code);
}

export async function banMapAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const map = String(formData.get("map"));
  const room = await loadRoomOrThrow(code);
  const veto = await db.veto.findUnique({ where: { roomId: room.id } });
  if (!veto || veto.status !== "IN_PROGRESS") throw new Error("Veto isn't in progress");

  const required = mapsRequiredForFormat(room.format as Format);
  const stepsSoFar = JSON.parse(veto.steps) as VetoStep[];
  // Reconstruct the remaining pool: original pool minus maps already banned.
  const fullPool = JSON.parse(room.mapPool) as string[];
  const bannedSoFar = new Set(stepsSoFar.map((s) => s.map));
  const remainingPool = fullPool.filter((m) => !bannedSoFar.has(m));
  const nextTeam: "A" | "B" = stepsSoFar.length % 2 === 0 ? "A" : "B";

  const isHost = room.hostUserId === user.id || user.role === "ADMIN";
  const captain = room.players.find((p) => p.team === nextTeam && p.isCaptain);
  const isActingCaptain = captain?.userId === user.id;
  if (!isHost && !isActingCaptain) {
    throw new Error(`Only Team ${nextTeam}'s captain (or the host) can ban right now`);
  }

  const next = applyBan(
    { pool: remainingPool, steps: stepsSoFar, nextTeam, done: false, finalMapList: null },
    nextTeam,
    map,
    required,
  );

  await db.veto.update({
    where: { roomId: room.id },
    data: {
      status: next.done ? "DONE" : "IN_PROGRESS",
      steps: JSON.stringify(next.steps),
      finalMapList: next.finalMapList ? JSON.stringify(next.finalMapList) : null,
    },
  });
  if (next.done) {
    await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
  }
  revalidateRoom(code);
}

export async function overrideMapsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await loadRoomOrThrow(code);
  assertHost(room, user);

  const required = mapsRequiredForFormat(room.format as Format);
  const maps = Array.from({ length: required }, (_, i) => formData.get(`map_${i}`)).map(String);
  if (maps.some((m) => !m)) throw new Error("Choose a map for every slot");

  await db.veto.upsert({
    where: { roomId: room.id },
    update: { status: "DONE", finalMapList: JSON.stringify(maps), overriddenByHost: true },
    create: {
      roomId: room.id,
      status: "DONE",
      finalMapList: JSON.stringify(maps),
      overriddenByHost: true,
    },
  });
  if (room.status !== "LIVE") {
    await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
  }
  revalidateRoom(code);
}

export async function startMatchAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await db.room.findUnique({
    where: { code },
    include: { players: { include: { user: true } }, veto: true },
  });
  if (!room) throw new Error("Room not found");
  assertHost(room, user);

  if (room.status !== "LOBBY" && room.status !== "VETO" && room.status !== "READY") {
    throw new Error("This room isn't in a startable state");
  }

  const teamACount = room.players.filter((p) => p.team === "A" && p.isReady).length;
  const teamBCount = room.players.filter((p) => p.team === "B" && p.isReady).length;
  if (teamACount < room.playersPerTeam || teamBCount < room.playersPerTeam) {
    throw new Error(
      `Need ${room.playersPerTeam} ready players on each team (have ${teamACount} vs ${teamBCount})`,
    );
  }

  if (!room.veto?.finalMapList) {
    throw new Error("Resolve the map list (run veto or override) before starting");
  }
  const mapList = JSON.parse(room.veto.finalMapList) as string[];

  const config = await getServerConfig();
  if (!config) throw new Error("Server RCON isn't configured yet — ask an admin to set it up");

  const matchzyMatchId = `${room.code}-${Date.now()}`;
  const configJson = buildMatchConfig({ room, roomPlayers: room.players, mapList, matchzyMatchId });

  const match = await db.match.create({
    data: {
      roomId: room.id,
      matchzyMatchId,
      status: "LOADING",
      configJson: JSON.stringify(configJson),
    },
  });

  const configUrl = `${config.appPublicUrl.replace(/\/$/, "")}/api/matchzy/config/${match.id}`;
  try {
    await loadMatch(config, configUrl);
  } catch (error) {
    await db.match.update({ where: { id: match.id }, data: { status: "CANCELLED" } });
    throw new Error(`Failed to push match to the server via RCON: ${(error as Error).message}`);
  }

  await db.room.update({ where: { id: room.id }, data: { status: "LIVE" } });
  revalidateRoom(code);
}

export async function cancelRoomAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const code = String(formData.get("code"));
  const room = await db.room.findUnique({ where: { code }, include: { match: true } });
  if (!room) throw new Error("Room not found");
  assertHost(room, user);

  if (room.match && room.status === "LIVE") {
    const config = await getServerConfig();
    if (config) {
      await endMatch(config).catch((error) => {
        console.error("Failed to end match on the server via RCON:", error);
      });
    }
    await db.match.update({ where: { id: room.match.id }, data: { status: "CANCELLED" } });
  }

  await db.room.update({ where: { id: room.id }, data: { status: "CANCELLED" } });
  revalidatePath("/dashboard");
  revalidatePath("/admin/rooms");
  revalidateRoom(code);
}
