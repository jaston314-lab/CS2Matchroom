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
import { DEFAULT_ROOM_SETTINGS } from "@/lib/roomDefaults";
import { startVeto, applyBan, sideChoiceTeamFromSteps } from "@/lib/veto";
import { startDraft, applyPick, computeNextTeam } from "@/lib/draft";
import {
  balanceTeams,
  resolveRatingsForRoom,
  scrambleCandidates,
  balanceCandidates,
  type BalanceEntry,
} from "@/lib/rating";
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

function revalidateMatchroom() {
  revalidatePath("/matchroom");
}

async function startVetoForRoom(room: Pick<Room, "id" | "mapPool" | "format" | "knifeRound">) {
  const mapPool = JSON.parse(room.mapPool) as string[];
  const required = mapsRequiredForFormat(room.format as Format);
  const state = startVeto(mapPool, "A", required);

  // No knife round to decide starting sides — if this resolved with zero
  // bans (the pool already matched the format's map count, e.g. a single
  // map picked directly), there's no "last picker" to react against, so
  // flip a coin instead. See sideChoiceTeamFromSteps.
  const sideChoiceTeam =
    state.done && !room.knifeRound
      ? (sideChoiceTeamFromSteps(state.steps) ?? (Math.random() < 0.5 ? "A" : "B"))
      : null;

  await db.veto.upsert({
    where: { roomId: room.id },
    update: {
      status: state.done ? "DONE" : "IN_PROGRESS",
      steps: JSON.stringify(state.steps),
      finalMapList: state.finalMapList ? JSON.stringify(state.finalMapList) : null,
      overriddenByHost: false,
      sideChoiceTeam,
      chosenSide: null,
    },
    create: {
      roomId: room.id,
      status: state.done ? "DONE" : "IN_PROGRESS",
      steps: JSON.stringify(state.steps),
      finalMapList: state.finalMapList ? JSON.stringify(state.finalMapList) : null,
      sideChoiceTeam,
    },
  });
  await db.room.update({
    where: { id: room.id },
    data: { status: state.done ? "READY" : "VETO" },
  });
}

export interface UpdateSettingsInput {
  label: string;
  format: string;
  mode: string;
  mapPool: string[];
  knifeRound: boolean;
  overtimeEnabled: boolean;
  /** Only ever applied if the caller turns out to be an admin — see below. */
  simulation?: boolean;
}

/**
 * Called directly from SettingsForm (not wired to a <form action>) so the
 * client can debounce and serialize saves itself — see the doc comment on
 * SettingsForm's save queue for why that matters. Taking a plain object
 * instead of FormData is also what lets "test mode" be admin-only cleanly:
 * a host's client never includes `simulation` at all, so there's no
 * FormData ambiguity between "not submitted" and "unchecked" to work
 * around anymore.
 */
export async function updateSettingsAction(input: UpdateSettingsInput): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.status !== "SETUP") {
    throw new Error("Settings lock once teams start readying up");
  }

  const label = input.label.trim();
  if (!label) throw new Error("Match name is required");
  if (!(FORMATS as readonly string[]).includes(input.format)) throw new Error("Invalid format");
  if (!(TEAM_FORMATION_MODES as readonly string[]).includes(input.mode)) throw new Error("Invalid mode");
  const format = input.format as Format;
  const mode = input.mode as TeamFormationMode;

  const validMapIds = new Set<string>(AVAILABLE_MAPS.map((m) => m.id));
  const cleanPool = input.mapPool.filter((m) => validMapIds.has(m));
  const required = mapsRequiredForFormat(format);
  if (cleanPool.length < required) {
    throw new Error(`Pick at least ${required} map(s) for ${format}`);
  }

  // Never trust the client on who's allowed to touch this, regardless of
  // what it sent.
  const simulation = user.role === "ADMIN" ? input.simulation : undefined;

  await db.room.update({
    where: { id: room.id },
    data: {
      label,
      format,
      mode,
      mapPool: JSON.stringify(cleanPool),
      knifeRound: input.knifeRound,
      overtimeEnabled: input.overtimeEnabled,
      simulation,
      hostUserId: user.id,
    },
  });
  revalidateMatchroom();
}

export async function resetSettingsAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.status !== "SETUP") {
    throw new Error("Settings lock once teams start readying up");
  }

  await db.room.update({
    where: { id: room.id },
    data: {
      ...DEFAULT_ROOM_SETTINGS,
      mapPool: JSON.stringify(DEFAULT_ROOM_SETTINGS.mapPool),
      hostUserId: user.id,
    },
  });
  revalidateMatchroom();
}

export async function leaveLobby(): Promise<void> {
  const user = await requireUser();
  const room = await getActiveRoom();
  await db.roomPlayer.deleteMany({ where: { roomId: room.id, userId: user.id } });
  revalidateMatchroom();
}

/**
 * Called from PresenceHeartbeat.tsx on an interval while the matchroom page
 * is open — bumps lastSeenAt so the waiting-pool display can tell "closed
 * the tab" apart from "still here" (there's no websocket/live-connection
 * layer to detect that any other way). Silent and cheap: updateMany rather
 * than update so it's a no-op (not an error) if the caller isn't currently
 * a RoomPlayer yet, and no revalidation — AutoRefresh's own polling already
 * re-fetches the page on its own schedule.
 */
export async function heartbeatAction(): Promise<void> {
  const user = await requireUser();
  const room = await db.room.findFirst({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  if (!room) return;
  await db.roomPlayer.updateMany({
    where: { roomId: room.id, userId: user.id },
    data: { lastSeenAt: new Date() },
  });
}

const CHAT_MESSAGE_MAX_LENGTH = 500;

/**
 * Room-scoped chat — no websocket layer, other viewers see a new message on
 * their next AutoRefresh poll (a few seconds, not instant). Called directly
 * from RoomChat.tsx rather than via a <form action>, so it can clear the
 * input and scroll the list itself right after a successful send.
 */
export async function sendChatMessageAction(body: string): Promise<void> {
  const user = await requireUser();
  const room = await getActiveRoom();
  const trimmed = body.trim();
  if (!trimmed) return;
  if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error(`Message is too long (${CHAT_MESSAGE_MAX_LENGTH} characters max)`);
  }
  await db.chatMessage.create({ data: { roomId: room.id, userId: user.id, body: trimmed } });
  revalidateMatchroom();
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
  if (room.teamsLocked) {
    throw new Error("The host has locked teams");
  }

  // First player onto an empty team becomes its captain. Switching teams
  // always drops whatever captain/coach status you held on your previous
  // team, so it can't linger stuck on the wrong side (or in the pool).
  const isFirstOnTeam = (team === "A" || team === "B") && !room.players.some((p) => p.team === team);

  await db.roomPlayer.update({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    data: { team, isCaptain: isFirstOnTeam, isCoach: false },
  });
  revalidateMatchroom();
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
  revalidateMatchroom();
}

/**
 * Ready-up is just a signal for the host to look at — it's not what moves
 * the room out of SETUP. Team size isn't a configured setting, so there's
 * no fixed target to auto-detect "everyone's here" against; the host
 * decides when to press Start (see startVetoAction) once they're happy
 * with however the teams have shaken out, even/uneven, 1v1 or 5v5.
 */
export async function setReady(formData: FormData): Promise<void> {
  const user = await requireUser();
  const ready = formData.get("ready") === "true";
  const room = await getActiveRoom();
  await db.roomPlayer.update({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
    data: { isReady: ready },
  });
  revalidateMatchroom();
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

/** A plausible CS2 Premier rating range, for bots' manualRating — real
 * players' ratings run roughly 0-30,000, so bots read as a believable mix
 * of skill levels instead of all showing no rating badge at all. */
function randomBotRating(): number {
  return Math.round(3000 + Math.random() * 24000);
}

// Team size isn't a configured setting anymore, but this test-mode
// shortcut still needs *some* target to fill toward — a standard 5v5 is
// the obvious "give me a full test match" default.
const TEST_MODE_PLAYERS_PER_TEAM = 5;
const TEST_MODE_COACHES_PER_TEAM = 1;

/**
 * Tops up whichever team/coach slots are still empty with placeholder bot
 * players, up to the standard 5+1 lineup per side. Shared by the two
 * test-mode entry points: readyUpAllAction (fill, ready everyone, and
 * jump straight into veto) and fillTestBotsAction (fill only, so a host
 * can eyeball a fully-populated SETUP screen before going any further).
 */
async function fillEmptySlotsWithBots(room: { id: string; players: { team: string; isCoach: boolean }[] }) {
  const countA = room.players.filter((p) => p.team === "A" && !p.isCoach).length;
  const countB = room.players.filter((p) => p.team === "B" && !p.isCoach).length;
  const coachesA = room.players.filter((p) => p.team === "A" && p.isCoach).length;
  const coachesB = room.players.filter((p) => p.team === "B" && p.isCoach).length;

  const slots: { team: "A" | "B"; isCoach: boolean }[] = [
    ...Array(Math.max(0, TEST_MODE_PLAYERS_PER_TEAM - countA)).fill({ team: "A", isCoach: false }),
    ...Array(Math.max(0, TEST_MODE_PLAYERS_PER_TEAM - countB)).fill({ team: "B", isCoach: false }),
    ...Array(Math.max(0, TEST_MODE_COACHES_PER_TEAM - coachesA)).fill({ team: "A", isCoach: true }),
    ...Array(Math.max(0, TEST_MODE_COACHES_PER_TEAM - coachesB)).fill({ team: "B", isCoach: true }),
  ];
  if (slots.length === 0) return;

  // Reuse bots left over from earlier test rooms (they're not tied to
  // *this* room yet) instead of always minting new User rows — otherwise
  // every test run permanently adds 9-10 more bot accounts.
  const reusableBots = await db.user.findMany({
    where: { isBot: true, roomPlayers: { none: { roomId: room.id } } },
    take: slots.length,
  });

  let botIndex = (await db.user.count({ where: { isBot: true } })) + 1;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const bot =
      reusableBots[i] ??
      (await db.user.create({
        data: {
          steamId64: generateFakeSteamId(),
          name: `Bot ${botIndex++}`,
          isBot: true,
          isPlaceholder: true,
          manualRating: randomBotRating(),
        },
      }));
    // A bot reused from before this rating existed — top it up rather than
    // leaving it as the one player with no rating badge.
    if (bot.manualRating === null) {
      await db.user.update({ where: { id: bot.id }, data: { manualRating: randomBotRating() } });
    }
    await db.roomPlayer.create({
      data: { roomId: room.id, userId: bot.id, team: slot.team, isCoach: slot.isCoach },
    });
  }
}

/**
 * Admin-only, fires the instant Test mode is switched on in the floating
 * debug panel — fills empty slots with bots but stops there (no ready-up,
 * no veto) so the host can actually see what a full SETUP screen looks
 * like instead of being dropped straight into veto.
 */
export async function fillTestBotsAction(): Promise<void> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("Admin only");
  const room = await getActiveRoom();
  if (room.status !== "SETUP") throw new Error("Nothing to fill right now");
  await fillEmptySlotsWithBots(room);
  await claimHost(room.id, user);
  revalidateMatchroom();
}

/**
 * The other half of the Test mode toggle — switching it off removes
 * whatever bot players fillTestBotsAction (or readyUpAllAction) added, so
 * the room goes back to just its real players instead of leaving bots
 * behind. Only ever touches RoomPlayer rows for bot users (never a real
 * player), and leaves the underlying bot User rows alone so they're still
 * there to reuse next time Test mode goes back on.
 */
export async function clearTestBotsAction(): Promise<void> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("Admin only");
  const room = await getActiveRoom();
  if (room.status !== "SETUP") throw new Error("Nothing to clear right now");
  await db.roomPlayer.deleteMany({ where: { roomId: room.id, user: { isBot: true } } });
  // Bot User rows themselves are never deleted when they're removed from a
  // room (fillEmptySlotsWithBots reuses them next time), so across enough
  // test-mode cycles they'd otherwise just accumulate forever. Toggling
  // Test mode off is a natural moment to also sweep any bot left with zero
  // RoomPlayer rows anywhere — including ones freed up by a room getting
  // deleted outright (see cancelMatchAction) — without touching bots still
  // tied to a real match history.
  await db.user.deleteMany({ where: { isBot: true, roomPlayers: { none: {} } } });
  revalidateMatchroom();
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
  await fillEmptySlotsWithBots(room);

  await db.roomPlayer.updateMany({
    where: { roomId: room.id, team: { in: ["A", "B"] } },
    data: { isReady: true },
  });

  // This single click is the host's explicit "start" trigger for test
  // mode — same as pressing the real Start-veto button, just bundled with
  // the fill/ready step for convenience.
  await startVetoForRoom(room);
  revalidateMatchroom();
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
  revalidateMatchroom();
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

  await db.roomPlayer.update({
    where: { id: target.id },
    data: { isCoach: !target.isCoach, isCaptain: false }, // captain/coach are mutually exclusive
  });
  await claimHost(room.id, user);
  revalidateMatchroom();
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
  revalidateMatchroom();
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

  await db.roomPlayer.update({
    where: { id: targetRoomPlayerId },
    data: { team, isCoach: true, isCaptain: false },
  });
  await claimHost(room.id, user);
  revalidateMatchroom();
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
  revalidateMatchroom();
}

/**
 * Bulk version of unassignPlayer — sends everyone back to the waiting pool
 * in one go and clears any in-progress draft (its team-by-team picks would
 * otherwise reference a team formation that no longer exists). A fresh
 * start for team formation without unassigning one player at a time.
 */
export async function resetTeamsAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();

  await db.$transaction([
    db.roomPlayer.updateMany({
      where: { roomId: room.id },
      data: { team: "UNASSIGNED", isCaptain: false, isCoach: false, isReady: false },
    }),
    db.draft.deleteMany({ where: { roomId: room.id } }),
  ]);
  await claimHost(room.id, user);
  revalidateMatchroom();
}

/** Toggles whether players can self-switch teams via setTeam — host tools
 * (unassignPlayer, assignCaptain, assignCoach) always still work regardless,
 * same as every other host override in this app. */
export async function toggleTeamsLockedAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  await db.room.update({ where: { id: room.id }, data: { teamsLocked: !room.teamsLocked } });
  await claimHost(room.id, user);
  revalidateMatchroom();
}

export async function scrambleTeams(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.mode !== "SELF_SELECT") throw new Error("Scramble isn't available in captain draft mode");

  const shuffled = [...scrambleCandidates(room.players)].sort(() => Math.random() - 0.5);
  const half = Math.ceil(shuffled.length / 2);
  const teamA = shuffled.slice(0, half);
  const teamB = shuffled.slice(half);

  await db.$transaction([
    ...teamA.map((p) => db.roomPlayer.update({ where: { id: p.id }, data: { team: "A" } })),
    ...teamB.map((p) => db.roomPlayer.update({ where: { id: p.id }, data: { team: "B" } })),
  ]);
  await claimHost(room.id, user);
  revalidateMatchroom();
}

export async function balanceTeamsAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.mode !== "SELF_SELECT") throw new Error("Balance isn't available in captain draft mode");

  const onTeam = balanceCandidates(room.players);
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
  revalidateMatchroom();
}

/**
 * The host's manual "go" — the actual trigger out of SETUP, now that
 * there's no fixed team size to auto-detect against. Works with whatever
 * split the teams have ended up with, even 1v1.
 */
export async function startVetoAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const room = await getActiveRoom();
  if (room.status !== "SETUP") {
    throw new Error("This room has already moved past team setup");
  }
  const countA = room.players.filter((p) => p.team === "A" && !p.isCoach).length;
  const countB = room.players.filter((p) => p.team === "B" && !p.isCoach).length;
  if (countA === 0 || countB === 0) {
    throw new Error("Both teams need at least one player before starting");
  }
  await startVetoForRoom(room);
  await claimHost(room.id, user);
  revalidateMatchroom();
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

  // Hosts run the lobby but aren't a veto participant — only an admin can
  // override and act for either team here, same as a captain can only act
  // for their own team. A host who isn't also an admin/captain can't ban.
  const isAdmin = user.role === "ADMIN";
  const captain = room.players.find((p) => p.team === nextTeam && p.isCaptain);
  const isActingCaptain = captain?.userId === user.id;
  if (!isAdmin && !isActingCaptain) {
    throw new Error(`Only Team ${nextTeam}'s captain (or an admin) can ban right now`);
  }

  const next = applyBan(
    { pool: remainingPool, steps: stepsSoFar, nextTeam, done: false, finalMapList: null },
    nextTeam,
    map,
    required,
  );

  // No knife round — the team that DIDN'T cast this final ban gets to
  // choose their starting side, since they didn't get the last map pick.
  const sideChoiceTeam = next.done && !room.knifeRound ? sideChoiceTeamFromSteps(next.steps) : null;

  await db.veto.update({
    where: { roomId: room.id },
    data: {
      status: next.done ? "DONE" : "IN_PROGRESS",
      steps: JSON.stringify(next.steps),
      finalMapList: next.finalMapList ? JSON.stringify(next.finalMapList) : null,
      ...(next.done ? { sideChoiceTeam, chosenSide: null } : {}),
    },
  });
  if (next.done) {
    await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
  }
  revalidateMatchroom();
}

/**
 * The payoff for not getting the last map pick (or for winning the
 * coin flip when there was no veto to react to) — lets that team's
 * captain, or the host, lock in CT or T for map 1. Only meaningful when
 * the room has no knife round; startVetoForRoom/banMapAction never set
 * veto.sideChoiceTeam otherwise, so this always has nothing to act on
 * there. Can be re-picked freely up until the match actually starts.
 */
export async function chooseSideAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const side = String(formData.get("side"));
  if (side !== "CT" && side !== "T") throw new Error("Invalid side");

  const room = await getActiveRoom();
  const veto = await db.veto.findUnique({ where: { roomId: room.id } });
  if (!veto?.sideChoiceTeam) throw new Error("No side choice is pending");

  // Same rule as banMapAction: hosts don't get a veto vote, only admins do.
  const isAdmin = user.role === "ADMIN";
  const captain = room.players.find((p) => p.team === veto.sideChoiceTeam && p.isCaptain);
  const isActingCaptain = captain?.userId === user.id;
  if (!isAdmin && !isActingCaptain) {
    throw new Error(`Only Team ${veto.sideChoiceTeam}'s captain (or an admin) can choose the side`);
  }

  await db.veto.update({ where: { roomId: room.id }, data: { chosenSide: side } });
  revalidateMatchroom();
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
  const state = startDraft(pool, "A");

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
  revalidateMatchroom();
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

  const lastPicker = stepsSoFar.length > 0 ? stepsSoFar[stepsSoFar.length - 1].team : null;
  const nextTeam = computeNextTeam(lastPicker, "A");

  // Same rule as the map veto: a host isn't a draft participant, so only
  // an admin can override and pick for either team.
  const isAdmin = user.role === "ADMIN";
  const actingCaptain = nextTeam === "A" ? captainA : captainB;
  if (!isAdmin && actingCaptain.userId !== user.id) {
    throw new Error(`Only Team ${nextTeam}'s captain (or an admin) can pick right now`);
  }

  const pool = room.players.filter((p) => p.team === "UNASSIGNED").map((p) => p.id);
  const next = applyPick(
    { pool, steps: stepsSoFar, nextTeam, done: false },
    nextTeam,
    targetRoomPlayerId,
    "A",
  );

  await db.$transaction([
    db.roomPlayer.update({ where: { id: targetRoomPlayerId }, data: { team: nextTeam } }),
    db.draft.update({
      where: { roomId: room.id },
      data: { status: next.done ? "DONE" : "IN_PROGRESS", steps: JSON.stringify(next.steps) },
    }),
  ]);
  revalidateMatchroom();
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

  // No fixed team size to check against — just make sure nobody's about
  // to start a 0-a-side match. The host pressing Start is the actual
  // "we're ready" signal now, not a per-player ready checkbox tally.
  const teamACount = room.players.filter((p) => p.team === "A" && !p.isCoach).length;
  const teamBCount = room.players.filter((p) => p.team === "B" && !p.isCoach).length;
  if (teamACount === 0 || teamBCount === 0) {
    throw new Error(`Both teams need at least one player (have ${teamACount} vs ${teamBCount})`);
  }

  if (!room.veto?.finalMapList) {
    throw new Error("Resolve the map list (run veto or override) before starting");
  }
  const mapList = JSON.parse(room.veto.finalMapList) as string[];

  const config = await getServerConfig();
  if (!config) throw new Error("Server RCON isn't configured yet — ask an admin to set it up");

  // MatchZy requires `matchid` to be a genuine (small) JSON integer — a
  // millisecond timestamp overflows a 32-bit int, and a "match-" prefix
  // makes it a string, not a number. Seconds-since-epoch stays under the
  // 32-bit signed ceiling (~2.147bn) until 2038, and is precise enough
  // that two matches starting the same second is a non-issue in practice.
  const matchzyMatchId = String(Math.floor(Date.now() / 1000));
  const sideChoice =
    room.veto?.sideChoiceTeam && room.veto?.chosenSide
      ? { team: room.veto.sideChoiceTeam as "A" | "B", side: room.veto.chosenSide as "CT" | "T" }
      : null;
  const configJson = buildMatchConfig({ room, roomPlayers: room.players, mapList, matchzyMatchId, sideChoice });

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
  revalidateMatchroom();
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

  const roundsPlayed = room.match ? room.match.team1Score + room.match.team2Score : 0;

  if (room.match && room.status === "LIVE") {
    const config = await getServerConfig();
    if (config) {
      await endMatch(config).catch((error) => {
        console.error("Failed to end match on the server via RCON:", error);
      });
    }
  }

  if (roundsPlayed === 0) {
    // Nothing was actually played (most cancels happen during SETUP/VETO,
    // before a Match row even exists) — deleting the room outright instead
    // of marking it CANCELLED keeps the Players Lounge's match history
    // free of empty entries nobody actually played. Cascades to
    // RoomPlayer/Veto/Draft/Match/MatchEvent via the schema's onDelete:
    // Cascade, so nothing needs cleaning up separately.
    await db.room.delete({ where: { id: room.id } });
  } else {
    if (room.match) {
      await db.match.update({ where: { id: room.match.id }, data: { status: "CANCELLED" } });
    }
    await db.room.update({ where: { id: room.id }, data: { status: "CANCELLED" } });
  }

  revalidatePath("/lounge");
  revalidateMatchroom();
}

/**
 * A finished match no longer auto-recycles into a fresh lobby (see
 * getOrCreateActiveRoom in page.tsx) — the host presses this once everyone
 * has seen the result.
 */
export async function startNewLobbyAction(): Promise<void> {
  const user = await requireUser();
  assertCanManage(user);
  const stillActive = await db.room.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
  });
  if (stillActive) throw new Error("There's already an active lobby");

  await db.room.create({
    data: {
      ...DEFAULT_ROOM_SETTINGS,
      mapPool: JSON.stringify(DEFAULT_ROOM_SETTINGS.mapPool),
      hostUserId: user.id,
    },
  });
  revalidateMatchroom();
}
