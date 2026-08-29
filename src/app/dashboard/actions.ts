"use server";

import { revalidatePath } from "next/cache";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  mapsRequiredForFormat,
  FORMATS,
  TEAM_FORMATION_MODES,
  type Format,
  type Team,
  type TeamFormationMode,
  type VetoStep,
  type DraftStep,
} from "@/lib/types";
import { AVAILABLE_MAPS } from "@/lib/maps";
import { startVeto, applyBan } from "@/lib/veto";
import { startDraft, applyPick, computeNextTeam } from "@/lib/draft";
import { balanceTeams, resolveRatingsForRoom, type BalanceEntry } from "@/lib/rating";
import { buildMatchConfig } from "@/lib/matchzyConfig";
import { getServerConfig, loadMatch, endMatch } from "@/lib/rcon";
import type { Room } from "@/generated/prisma/client";

/** There's always exactly one non-terminal room — this resolves it. */
async function getActiveRoom() {
  const room = await db.room.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    include: { players: true },
    orderBy: { createdAt: "desc" },
  });
  if (!room) throw new Error("There's no active match right now");
  return room;
}

/** With one persistent lobby, any host/admin can run it — not just
 * whoever happens to be recorded as its hostUserId. */
function assertCanManage(user: CurrentUser) {
  if (user.role !== "HOST" && user.role !== "ADMIN") {
    throw new Error("Only a host can do that");
  }
}

/** Settings-changing actions stamp hostUserId so "Hosted by X" reflects
 * whoever's actually running the lobby right now. */
async function claimHost(roomId: string, user: CurrentUser) {
  await db.room.update({ where: { id: roomId }, data: { hostUserId: user.id } });
}

function revalidateDashboard() {
  revalidatePath("/dashboard");
}

async function startVetoForRoom(room: Pick<Room, "id" | "mapPool" | "format">) {
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
  await db.room.update({
    where: { id: room.id },
    data: { status: state.done ? "READY" : "VETO" },
  });
}

export async function updateSettingsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.status !== "SETUP") {
    throw new Error("Settings lock once teams start readying up");
  }

  const label = String(formData.get("label") ?? "").trim();
  const formatRaw = String(formData.get("format") ?? "BO1");
  const modeRaw = String(formData.get("mode") ?? "SELF_SELECT");
  const mapPool = formData.getAll("mapPool").map(String);
  const knifeRound = formData.get("knifeRound") === "on";
  const overtimeEnabled = formData.get("overtimeEnabled") === "on";
  const minPlayersToStart = Number(formData.get("minPlayersToStart") ?? 10);
  const playersPerTeam = Number(formData.get("playersPerTeam") ?? 5);
  const coachesPerTeam = Number(formData.get("coachesPerTeam") ?? 1);
  const simulation = formData.get("simulation") === "on";

  if (!label) throw new Error("Match name is required");
  if (!(FORMATS as readonly string[]).includes(formatRaw)) throw new Error("Invalid format");
  if (!(TEAM_FORMATION_MODES as readonly string[]).includes(modeRaw)) throw new Error("Invalid mode");
  const format = formatRaw as Format;
  const mode = modeRaw as TeamFormationMode;

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
  if (!Number.isInteger(coachesPerTeam) || coachesPerTeam < 0 || coachesPerTeam > 2) {
    throw new Error("Coaches per team must be between 0 and 2");
  }

  await db.room.update({
    where: { id: room.id },
    data: {
      label,
      format,
      mode,
      mapPool: JSON.stringify(cleanPool),
      knifeRound,
      overtimeEnabled,
      minPlayersToStart,
      playersPerTeam,
      coachesPerTeam,
      simulation,
      hostUserId: user.id,
    },
  });
  revalidateDashboard();
}

export async function leaveLobby(): Promise<void> {
  const user = await requireUser();
  const room = await getActiveRoom();
  await db.roomPlayer.deleteMany({ where: { roomId: room.id, userId: user.id } });
  revalidateDashboard();
}

export async function setTeam(formData: FormData): Promise<void> {
  const user = await requireUser();
  const team = String(formData.get("team")) as Team;
  const room = await getActiveRoom();
  if (room.mode !== "SELF_SELECT") {
    throw new Error("Teams are set by the captain draft for this match");
  }
  if (room.status !== "SETUP") {
    throw new Error("Teams are locked once ready-up is complete");
  }
  await db.roomPlayer.update({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    data: { team },
  });
  revalidateDashboard();
}

/** Host/admin can rename either team; a captain can rename only their own. */
export async function renameTeamAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const team = String(formData.get("team")) as "A" | "B";
  const name = String(formData.get("name") ?? "").trim();
  const room = await getActiveRoom();

  if (room.status === "LIVE" || room.status === "COMPLETED") {
    throw new Error("Team names are locked once the match has started");
  }
  const isManager = user.role === "HOST" || user.role === "ADMIN";
  const isCaptainOfTeam = room.players.some(
    (p) => p.userId === user.id && p.team === team && p.isCaptain,
  );
  if (!isManager && !isCaptainOfTeam) {
    throw new Error("Only the host or that team's captain can rename it");
  }
  if (!name) throw new Error("Team name can't be empty");
  if (name.length > 30) throw new Error("Team name is too long");

  await db.room.update({
    where: { id: room.id },
    data: team === "A" ? { teamAName: name } : { teamBName: name },
  });
  revalidateDashboard();
}

/**
 * Once both teams have enough ready players, advance out of SETUP: jump
 * straight to READY if maps were already host-overridden, otherwise
 * auto-start the veto. Shared by setReady and the test-mode bulk-ready
 * shortcut below.
 */
async function maybeAdvancePastSetup(room: Pick<Room, "id" | "status" | "playersPerTeam" | "mapPool" | "format">) {
  if (room.status !== "SETUP") return;
  const players = await db.roomPlayer.findMany({ where: { roomId: room.id } });
  const readyA = players.filter((p) => p.team === "A" && p.isReady && !p.isCoach).length;
  const readyB = players.filter((p) => p.team === "B" && p.isReady && !p.isCoach).length;
  if (readyA >= room.playersPerTeam && readyB >= room.playersPerTeam) {
    const veto = await db.veto.findUnique({ where: { roomId: room.id } });
    if (veto?.finalMapList) {
      // Maps were already host-overridden before everyone readied up.
      await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
    } else if (!veto) {
      await startVetoForRoom(room);
    }
  }
}

export async function setReady(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ready = formData.get("ready") === "true";
  const room = await getActiveRoom();
  await db.roomPlayer.update({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    data: { isReady: ready },
  });

  await maybeAdvancePastSetup(room);
  revalidateDashboard();
}

/**
 * Test-mode shortcut: force every seated player ready so a host testing
 * solo (with matchzy simulation mode on) can actually reach veto/start
 * without needing real players to fill both teams and ready up.
 */
/**
 * Clearly outside the real Steam64 ID range (which starts around
 * 76561197960265728) — just needs to be unique in our DB. Bots never log
 * in, so it doesn't need to look like a real SteamID beyond that.
 */
function generateFakeSteamId(): string {
  return "9" + Math.floor(Math.random() * 1e17)
    .toString()
    .padStart(17, "0");
}

export async function readyUpAllAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (!room.simulation) throw new Error("Only available in test mode");
  if (room.status !== "SETUP") throw new Error("Nothing to fill/ready right now");

  // A single real account can only ever occupy one team, so "ready up
  // everyone" alone can never satisfy both teams' thresholds — fill any
  // remaining empty slots with placeholder bot players first. Simulation
  // mode doesn't need real Steam accounts to connect, so this is safe:
  // MatchZy just spawns bots representing whatever SteamIDs are configured.
  const countA = room.players.filter((p) => p.team === "A" && !p.isCoach).length;
  const countB = room.players.filter((p) => p.team === "B" && !p.isCoach).length;
  const neededA = Math.max(0, room.playersPerTeam - countA);
  const neededB = Math.max(0, room.playersPerTeam - countB);

  let botIndex = (await db.user.count({ where: { isBot: true } })) + 1;
  const slots: ("A" | "B")[] = [
    ...Array(neededA).fill("A" as const),
    ...Array(neededB).fill("B" as const),
  ];
  for (const team of slots) {
    const bot = await db.user.create({
      data: { steamId64: generateFakeSteamId(), name: `Bot ${botIndex}`, isBot: true },
    });
    botIndex++;
    await db.roomPlayer.create({
      data: { roomId: room.id, userId: bot.id, team, isReady: true },
    });
  }

  await db.roomPlayer.updateMany({
    where: { roomId: room.id, team: { in: ["A", "B"] } },
    data: { isReady: true },
  });

  await maybeAdvancePastSetup(room);
  revalidateDashboard();
}

export async function toggleCaptain(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const targetRoomPlayerId = String(formData.get("roomPlayerId"));
  const room = await getActiveRoom();

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
      data: { isCaptain: !target.isCaptain, isCoach: false }, // captain/coach are mutually exclusive
    });
  });
  await claimHost(room.id, user);
  revalidateDashboard();
}

export async function toggleCoach(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const targetRoomPlayerId = String(formData.get("roomPlayerId"));
  const room = await getActiveRoom();

  const target = room.players.find((p) => p.id === targetRoomPlayerId);
  if (!target || target.team === "UNASSIGNED") {
    throw new Error("Player must be on a team to be made coach");
  }

  if (!target.isCoach) {
    const currentCoaches = room.players.filter((p) => p.team === target.team && p.isCoach).length;
    if (currentCoaches >= room.coachesPerTeam) {
      throw new Error(`Team ${target.team} already has ${room.coachesPerTeam} coach(es)`);
    }
  }

  await db.roomPlayer.update({
    where: { id: target.id },
    data: { isCoach: !target.isCoach, isCaptain: false }, // captain/coach are mutually exclusive
  });
  await claimHost(room.id, user);
  revalidateDashboard();
}

/**
 * Draft mode only: pulls a player straight from the pool onto a team as
 * its captain (unlike toggleCaptain, which requires already being on a
 * team — in draft mode nobody's on a team yet until picked).
 */
export async function assignCaptain(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const targetRoomPlayerId = String(formData.get("roomPlayerId"));
  const team = String(formData.get("team")) as "A" | "B";
  const room = await getActiveRoom();
  if (room.mode !== "CAPTAIN_DRAFT") throw new Error("This match isn't using captain draft");

  await db.$transaction(async (tx) => {
    await tx.roomPlayer.updateMany({
      where: { roomId: room.id, team, isCaptain: true },
      data: { isCaptain: false, team: "UNASSIGNED" },
    });
    await tx.roomPlayer.update({
      where: { id: targetRoomPlayerId },
      data: { team, isCaptain: true, isCoach: false },
    });
  });
  await claimHost(room.id, user);
  revalidateDashboard();
}

/**
 * Pulls a player straight from the pool onto a team as its coach — used in
 * captain draft mode where nobody's on a team until picked/assigned.
 * (In self-select mode, hosts use toggleCoach on a player who already
 * picked a team instead.)
 */
export async function assignCoach(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const targetRoomPlayerId = String(formData.get("roomPlayerId"));
  const team = String(formData.get("team")) as "A" | "B";
  const room = await getActiveRoom();

  const currentCoaches = room.players.filter((p) => p.team === team && p.isCoach).length;
  if (currentCoaches >= room.coachesPerTeam) {
    throw new Error(`Team ${team} already has ${room.coachesPerTeam} coach(es)`);
  }

  await db.roomPlayer.update({
    where: { id: targetRoomPlayerId },
    data: { team, isCoach: true, isCaptain: false },
  });
  await claimHost(room.id, user);
  revalidateDashboard();
}

/** Safety valve for host mistakes: sends a player back to the waiting pool. */
export async function unassignPlayer(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const targetRoomPlayerId = String(formData.get("roomPlayerId"));
  const room = await getActiveRoom();

  await db.roomPlayer.update({
    where: { id: targetRoomPlayerId },
    data: { team: "UNASSIGNED", isCaptain: false, isCoach: false },
  });
  await claimHost(room.id, user);
  revalidateDashboard();
}

export async function scrambleTeams(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.mode !== "SELF_SELECT") throw new Error("Scramble isn't available in captain draft mode");

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
  await claimHost(room.id, user);
  revalidateDashboard();
}

export async function balanceTeamsAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.mode !== "SELF_SELECT") throw new Error("Balance isn't available in captain draft mode");

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
  await claimHost(room.id, user);
  revalidateDashboard();
}

export async function startVetoAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  await startVetoForRoom(room);
  await claimHost(room.id, user);
  revalidateDashboard();
}

export async function banMapAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const map = String(formData.get("map"));
  const room = await getActiveRoom();
  const veto = await db.veto.findUnique({ where: { roomId: room.id } });
  if (!veto || veto.status !== "IN_PROGRESS") throw new Error("Veto isn't in progress");

  const required = mapsRequiredForFormat(room.format as Format);
  const stepsSoFar = JSON.parse(veto.steps) as VetoStep[];
  const fullPool = JSON.parse(room.mapPool) as string[];
  const bannedSoFar = new Set(stepsSoFar.map((s) => s.map));
  const remainingPool = fullPool.filter((m) => !bannedSoFar.has(m));
  const nextTeam: "A" | "B" = stepsSoFar.length % 2 === 0 ? "A" : "B";

  const isHost = user.role === "HOST" || user.role === "ADMIN";
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
  revalidateDashboard();
}

export async function overrideMapsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();

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
  // Deliberately doesn't touch room.status: if this happens during SETUP
  // (before everyone's ready), settings should stay editable — setReady
  // is what actually advances the phase once ready-up completes. If the
  // room's already past SETUP (e.g. overriding mid-veto as an escape
  // hatch), resolve straight to READY.
  if (room.status !== "SETUP" && room.status !== "LIVE") {
    await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
  }
  await claimHost(room.id, user);
  revalidateDashboard();
}

export async function startDraftAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.mode !== "CAPTAIN_DRAFT") throw new Error("This match isn't using captain draft");

  const captainA = room.players.find((p) => p.team === "A" && p.isCaptain);
  const captainB = room.players.find((p) => p.team === "B" && p.isCaptain);
  if (!captainA || !captainB) throw new Error("Assign a captain to each team before starting the draft");

  const pool = room.players.filter((p) => p.team === "UNASSIGNED").map((p) => p.id);
  // Captains already fill one slot each, so the draft only needs to fill
  // the rest.
  const targetPicksPerTeam = room.playersPerTeam - 1;
  const state = startDraft(pool, "A", targetPicksPerTeam);

  await db.draft.upsert({
    where: { roomId: room.id },
    update: { status: state.done ? "DONE" : "IN_PROGRESS", steps: JSON.stringify(state.steps) },
    create: {
      roomId: room.id,
      status: state.done ? "DONE" : "IN_PROGRESS",
      steps: JSON.stringify(state.steps),
    },
  });
  await claimHost(room.id, user);
  revalidateDashboard();
}

export async function draftPickAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const targetRoomPlayerId = String(formData.get("roomPlayerId"));
  const room = await getActiveRoom();
  const draft = await db.draft.findUnique({ where: { roomId: room.id } });
  if (!draft || draft.status !== "IN_PROGRESS") throw new Error("Draft isn't in progress");

  const stepsSoFar = JSON.parse(draft.steps) as DraftStep[];
  const captainA = room.players.find((p) => p.team === "A" && p.isCaptain);
  const captainB = room.players.find((p) => p.team === "B" && p.isCaptain);
  if (!captainA || !captainB) throw new Error("Both captains must be assigned");

  const targetPicksPerTeam = room.playersPerTeam - 1;
  const countA = stepsSoFar.filter((s) => s.team === "A").length;
  const countB = stepsSoFar.filter((s) => s.team === "B").length;
  const lastPicker = stepsSoFar.length > 0 ? stepsSoFar[stepsSoFar.length - 1].team : null;
  const nextTeam = computeNextTeam(countA, countB, targetPicksPerTeam, lastPicker);
  if (!nextTeam) throw new Error("Draft is already complete");

  const isHost = user.role === "HOST" || user.role === "ADMIN";
  const actingCaptain = nextTeam === "A" ? captainA : captainB;
  if (!isHost && actingCaptain.userId !== user.id) {
    throw new Error(`Only Team ${nextTeam}'s captain (or the host) can pick right now`);
  }

  const pool = room.players.filter((p) => p.team === "UNASSIGNED").map((p) => p.id);
  const next = applyPick(
    { pool, steps: stepsSoFar, nextTeam, done: false },
    nextTeam,
    targetRoomPlayerId,
    targetPicksPerTeam,
  );

  await db.$transaction([
    db.roomPlayer.update({ where: { id: targetRoomPlayerId }, data: { team: nextTeam } }),
    db.draft.update({
      where: { roomId: room.id },
      data: { status: next.done ? "DONE" : "IN_PROGRESS", steps: JSON.stringify(next.steps) },
    }),
  ]);
  revalidateDashboard();
}

export async function startMatchAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await db.room.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    include: { players: { include: { user: true } }, veto: true },
    orderBy: { createdAt: "desc" },
  });
  if (!room) throw new Error("There's no active match right now");

  if (room.status !== "SETUP" && room.status !== "VETO" && room.status !== "READY") {
    throw new Error("This room isn't in a startable state");
  }

  const teamACount = room.players.filter((p) => p.team === "A" && p.isReady && !p.isCoach).length;
  const teamBCount = room.players.filter((p) => p.team === "B" && p.isReady && !p.isCoach).length;
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

  const matchzyMatchId = `match-${Date.now()}`;
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

  await db.room.update({ where: { id: room.id }, data: { status: "LIVE", hostUserId: user.id } });
  revalidateDashboard();
}

export async function cancelMatchAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await db.room.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    include: { match: true },
    orderBy: { createdAt: "desc" },
  });
  if (!room) throw new Error("There's no active match to cancel");

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
  revalidatePath("/admin/rooms");
  revalidateDashboard();
}
