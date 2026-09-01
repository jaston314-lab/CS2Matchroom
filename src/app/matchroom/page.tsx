import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Format, VetoStep, DraftStep } from "@/lib/types";
import { mapLabel, mapImage } from "@/lib/maps";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/roomDefaults";
import { fetchLeetifyMatchStatsForRoom, type LeetifyMatchStats } from "@/lib/leetifyStats";
import { resolveRatingsForRoom, type ResolvedRating } from "@/lib/rating";
import { RoomLive } from "@/components/RoomLive";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LeetifyStatsStrip } from "@/components/LeetifyStatsStrip";
import { PremierRatingBadge } from "@/components/PremierRatingBadge";
import { regenerateInviteCodeAction } from "@/app/admin/server/actions";
import { SettingsForm } from "./SettingsForm";
import { CancelMatchButton } from "./CancelMatchButton";
import {
  renameTeamAction,
  leaveLobby,
  setTeam,
  setReady,
  readyUpAllAction,
  toggleCaptain,
  toggleCoach,
  assignCaptain,
  assignCoach,
  unassignPlayer,
  resetTeamsAction,
  scrambleTeams,
  balanceTeamsAction,
  banMapAction,
  startVetoAction,
  startDraftAction,
  draftPickAction,
  startMatchAction,
  startNewLobbyAction,
} from "./actions";

type PlayerRow = {
  id: string;
  userId: string;
  team: string;
  isCaptain: boolean;
  isCoach: boolean;
  isReady: boolean;
  user: { name: string; avatarUrl: string | null; steamId64: string; manualRating: number | null };
};

async function getOrCreateActiveRoom() {
  const existing = await db.room.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  // Show the just-finished match's result instead of silently recycling
  // into a fresh lobby the moment it completes — a host explicitly starts
  // the next one (see startNewLobbyAction) once everyone's seen the score.
  const recentlyCompleted = await db.room.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  if (recentlyCompleted) return recentlyCompleted;

  // There's always a lobby open, even before any host has configured
  // anything — hostUserId is a required column, satisfied by any admin
  // (guaranteed to exist post-bootstrap) as a placeholder. Any host/admin
  // can edit settings regardless of who's recorded here (see
  // assertCanManage in actions.ts) — it just gets reclaimed automatically.
  const placeholderHost = await db.user.findFirst({ where: { role: "ADMIN" } });
  return db.room.create({
    data: {
      ...DEFAULT_ROOM_SETTINGS,
      mapPool: JSON.stringify(DEFAULT_ROOM_SETTINGS.mapPool),
      hostUserId: placeholderHost!.id,
    },
  });
}

export default async function MatchroomPage() {
  const user = await requireUser();
  const activeRoom = await getOrCreateActiveRoom();

  const room = await db.room.findUniqueOrThrow({
    where: { id: activeRoom.id },
    include: {
      host: true,
      players: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      veto: true,
      draft: true,
      match: true,
    },
  });

  const canHost = user.role === "HOST" || user.role === "ADMIN";
  const isAdmin = user.role === "ADMIN";

  // A completed match is a dead end, not something to join — show the
  // result and let the host explicitly start the next lobby.
  if (room.status === "COMPLETED") {
    return <MatchSummary room={room} canHost={canHost} />;
  }

  if (!room.players.some((p) => p.userId === user.id)) {
    const newPlayer = await db.roomPlayer.upsert({
      where: { roomId_userId: { roomId: room.id, userId: user.id } },
      update: {},
      create: { roomId: room.id, userId: user.id },
      include: { user: true },
    });
    room.players.push(newPlayer);
  }

  const leetifyStats = await fetchLeetifyMatchStatsForRoom(room.players.map((p) => p.user.steamId64));
  const premierRatings = await resolveRatingsForRoom(
    room.players.map((p) => ({ steamId64: p.user.steamId64, manualRating: p.user.manualRating })),
  );
  const inviteCode = canHost
    ? (await db.serverConfig.findUnique({ where: { id: "singleton" } }))?.inviteCode || null
    : null;

  const isSetup = room.status === "SETUP";
  const isVeto = room.status === "VETO";
  const isLive = room.status === "LIVE";
  const isDraft = room.mode === "CAPTAIN_DRAFT";

  const mapPool = JSON.parse(room.mapPool) as string[];
  const format = room.format as Format;

  const vetoSteps = room.veto ? (JSON.parse(room.veto.steps) as VetoStep[]) : [];
  const finalMapList = room.veto?.finalMapList ? (JSON.parse(room.veto.finalMapList) as string[]) : null;
  const remainingPool = mapPool.filter((m) => !vetoSteps.some((s) => s.map === m));
  const nextVetoTeam: "A" | "B" = vetoSteps.length % 2 === 0 ? "A" : "B";

  const draftSteps = room.draft ? (JSON.parse(room.draft.steps) as DraftStep[]) : [];
  const draftInProgress = room.draft?.status === "IN_PROGRESS";
  // No fixed per-team target anymore — captains just alternate until the
  // pool empties (see lib/draft.ts's computeNextTeam, mirrored here).
  const nextDraftTeam: "A" | "B" =
    draftSteps.length === 0 || draftSteps[draftSteps.length - 1].team === "B" ? "A" : "B";

  const teamA = room.players.filter((p) => p.team === "A" && !p.isCoach) as PlayerRow[];
  const teamB = room.players.filter((p) => p.team === "B" && !p.isCoach) as PlayerRow[];
  const coachesA = room.players.filter((p) => p.team === "A" && p.isCoach) as PlayerRow[];
  const coachesB = room.players.filter((p) => p.team === "B" && p.isCoach) as PlayerRow[];
  const pool = room.players.filter((p) => p.team === "UNASSIGNED") as PlayerRow[];
  const captainA = room.players.find((p) => p.team === "A" && p.isCaptain);
  const captainB = room.players.find((p) => p.team === "B" && p.isCaptain);
  const readyA = teamA.filter((p) => p.isReady).length;
  const readyB = teamB.filter((p) => p.isReady).length;
  const canBanNow = canHost || (captainA?.userId === user.id && nextVetoTeam === "A") || (captainB?.userId === user.id && nextVetoTeam === "B");
  const canPickNow =
    draftInProgress &&
    (canHost ||
      (captainA?.userId === user.id && nextDraftTeam === "A") ||
      (captainB?.userId === user.id && nextDraftTeam === "B"));
  // Compact "C" coach button: no cap on coaches per team anymore, so it
  // just points at whichever team currently has fewer (ties go to A).
  const nextCoachTeam: "A" | "B" = coachesA.length <= coachesB.length ? "A" : "B";
  const myPlayer = room.players.find((p) => p.userId === user.id);
  const myTeam = myPlayer?.team ?? "UNASSIGNED";
  const canEditNames = room.status !== "LIVE" && room.status !== "COMPLETED";
  const canRenameA = canEditNames && (canHost || captainA?.userId === user.id);
  const canRenameB = canEditNames && (canHost || captainB?.userId === user.id);
  const canSwitchTeams = !isDraft && isSetup;

  return (
    <div className="space-y-8">
      <AutoRefresh />

      <div className="sm:relative">
        <div className="text-center px-4">
          <h1 className="text-2xl font-semibold">{room.label}</h1>
          <p className="text-sm text-neutral-400">
            Format {format} · Maps Veto · Knife round {room.knifeRound ? "On" : "Off"} · OT{" "}
            {room.overtimeEnabled ? "On" : "Off"}
          </p>
        </div>
        {canHost && (
          <div className="mt-3 flex justify-center sm:mt-0 sm:absolute sm:right-0 sm:top-0">
            <InviteCodeWidget inviteCode={inviteCode} isAdmin={isAdmin} />
          </div>
        )}
      </div>

      {room.status === "READY" && finalMapList && (
        <section className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-5 space-y-3">
          <h2 className="text-lg font-semibold">Maps resolved</h2>
          <p className="text-sm">
            {finalMapList.map(mapLabel).join(" → ")}
            {room.veto?.overriddenByHost && <span className="text-neutral-500"> (host override)</span>}
          </p>
          {canHost && (
            <div className="flex items-center justify-center gap-3">
              <form action={startMatchAction}>
                <button className="rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2.5 text-white font-semibold">
                  Start match
                </button>
              </form>
              <CancelMatchButton />
            </div>
          )}
        </section>
      )}

      {isLive && room.match && (
        <RoomLive
          match={{
            status: room.match.status,
            currentMap: room.match.currentMap,
            currentMapIndex: room.match.currentMapIndex,
            team1Score: room.match.team1Score,
            team2Score: room.match.team2Score,
            connectedPlayers: JSON.parse(room.match.connectedPlayers) as string[],
          }}
          teamAName={room.teamAName}
          teamBName={room.teamBName}
          players={room.players.map((p) => ({ steamId64: p.user.steamId64, name: p.user.name }))}
        />
      )}

      {/* Waiting pool: pinned to the viewport edge on large screens so it
          never competes for width with the centered lobby box below; on
          small screens it just falls back into normal stacked flow. */}
      {isSetup && (
        <>
          <div className="lg:hidden rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-3 text-sm">
            <WaitingPoolList
              pool={pool}
              currentUserId={user.id}
              canHost={canHost}
              isDraft={isDraft}
              hasCaptainA={!!captainA}
              hasCaptainB={!!captainB}
              canPickNow={canPickNow}
              nextCoachTeam={nextCoachTeam}
              premierRatings={premierRatings}
            />
          </div>
          <div className="hidden lg:block fixed left-6 top-24 w-64 rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-3 text-sm">
            <WaitingPoolList
              pool={pool}
              currentUserId={user.id}
              canHost={canHost}
              isDraft={isDraft}
              hasCaptainA={!!captainA}
              hasCaptainB={!!captainB}
              canPickNow={canPickNow}
              nextCoachTeam={nextCoachTeam}
              premierRatings={premierRatings}
            />
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[26rem_20rem_26rem] lg:w-fit lg:mx-auto">
        <TeamPanel
          team="A"
          name={room.teamAName}
          readyCount={readyA}
          totalCount={teamA.length}
          players={teamA}
          coaches={coachesA}
          pool={pool}
          currentUserId={user.id}
          myTeam={myTeam}
          isHost={canHost && isSetup}
          canRenameTeam={canRenameA}
          canSwitchTeams={canSwitchTeams}
          isDraft={isDraft}
          leetifyStats={leetifyStats}
          premierRatings={premierRatings}
        />

        {isSetup && canHost ? (
          <SettingsForm room={room} mapPool={mapPool} isAdmin={isAdmin} />
        ) : (
          <section className="space-y-2 text-xs text-center rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
            <h2 className="text-xs font-medium text-neutral-300 mb-1">
              Match settings
              {isAdmin && room.simulation && (
                <span className="ml-1.5 rounded bg-blue-900/60 text-blue-300 px-1.5 py-0.5">
                  Test mode
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Stat label="Format" value={format} />
              <Stat label="Team split" value={`${teamA.length} v ${teamB.length}`} />
              <Stat label="Knife round" value={room.knifeRound ? "On" : "Off"} />
              <Stat label="Overtime" value={room.overtimeEnabled ? "On" : "Off"} />
            </div>
            {isVeto ? (
              <div>
                <p className="text-neutral-500 mb-1">
                  Map veto — Team {nextVetoTeam}&apos;s turn
                  {!canBanNow && (
                    <span className="block text-neutral-600">
                      waiting on their captain (or the host)
                    </span>
                  )}
                </p>
                <div className="space-y-1.5">
                  {remainingPool.map((m) => (
                    <div
                      key={m}
                      className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950/50 overflow-hidden pr-2"
                    >
                      {mapImage(m) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mapImage(m)!} alt="" className="w-14 h-8 object-cover shrink-0" />
                      )}
                      <span className="flex-1 truncate">{mapLabel(m)}</span>
                      <form action={banMapAction}>
                        <input type="hidden" name="map" value={m} />
                        <button
                          disabled={!canBanNow}
                          className="rounded border border-red-800 text-red-300 px-2 py-0.5 text-[11px] font-semibold hover:bg-red-950/40 hover:border-red-600 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                        >
                          Ban
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
                {canHost && (
                  <div className="pt-2 mt-1.5 border-t border-neutral-800 flex justify-center">
                    <CancelMatchButton />
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="text-neutral-500 mb-1">Map pool</p>
                <div className="flex flex-wrap justify-center gap-1">
                  {mapPool.map((m) => (
                    <span key={m} className="rounded bg-neutral-800 px-1.5 py-0.5">
                      {mapLabel(m)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <TeamPanel
          team="B"
          name={room.teamBName}
          readyCount={readyB}
          totalCount={teamB.length}
          players={teamB}
          coaches={coachesB}
          pool={pool}
          currentUserId={user.id}
          myTeam={myTeam}
          isHost={canHost && isSetup}
          canRenameTeam={canRenameB}
          canSwitchTeams={canSwitchTeams}
          isDraft={isDraft}
          leetifyStats={leetifyStats}
          premierRatings={premierRatings}
        />

        {isSetup && (
          <div className="lg:col-start-2 space-y-2">
            {canHost && !isDraft && (
              <div className="flex flex-wrap justify-center gap-2">
                <form action={scrambleTeams}>
                  <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500">
                    Scramble teams
                  </button>
                </form>
                <form action={balanceTeamsAction}>
                  <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500">
                    Balance by rating
                  </button>
                </form>
              </div>
            )}
            {canHost && room.players.some((p) => p.team !== "UNASSIGNED") && (
              <div className="flex justify-center">
                <form action={resetTeamsAction}>
                  <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-400 hover:border-red-700 hover:text-red-300">
                    Reset teams (move everyone to waiting pool)
                  </button>
                </form>
              </div>
            )}
            {myPlayer && (
              <div className="flex flex-wrap justify-center gap-2">
                <form action={setReady}>
                  <input type="hidden" name="ready" value={(!myPlayer.isReady).toString()} />
                  <button className="rounded-lg bg-emerald-700 hover:bg-emerald-600 px-3 py-1.5 text-sm text-white">
                    {myPlayer.isReady ? "Unready" : "Ready up"}
                  </button>
                </form>
                <form action={leaveLobby}>
                  <button className="rounded-lg border border-red-900 text-red-300 px-3 py-1.5 text-sm hover:border-red-700">
                    Leave lobby
                  </button>
                </form>
              </div>
            )}
            {isAdmin && room.simulation && (
              <div className="flex justify-center">
                <form action={readyUpAllAction}>
                  <button className="rounded-lg border border-blue-700 bg-blue-950/40 text-blue-300 px-3 py-1.5 text-sm hover:border-blue-500">
                    Fill with bots &amp; ready up (test mode)
                  </button>
                </form>
              </div>
            )}
            {canHost && (
              <div className="flex flex-col items-center gap-1 pt-1">
                <form action={startVetoAction}>
                  <button
                    disabled={teamA.length === 0 || teamB.length === 0}
                    className="rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2.5 text-white font-semibold disabled:opacity-40 disabled:hover:bg-blue-600"
                  >
                    Start
                  </button>
                </form>
                {(teamA.length === 0 || teamB.length === 0) && (
                  <p className="text-xs text-neutral-600">Both teams need at least one player</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {isDraft && isSetup && (
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
          <h2 className="text-lg font-medium">Captain draft</h2>
          {!captainA || !captainB ? (
            <p className="text-sm text-neutral-400">
              Assign a captain to each team from the waiting pool above before starting the draft.
            </p>
          ) : !room.draft ? (
            canHost && (
              <form action={startDraftAction}>
                <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500">
                  Start draft
                </button>
              </form>
            )
          ) : draftInProgress ? (
            <p className="text-sm text-neutral-400">
              Team {nextDraftTeam}&apos;s turn to pick
              {!canPickNow && " — waiting on their captain (or the host)"}
              {canPickNow && " — use the + next to a player in the waiting pool"}
            </p>
          ) : (
            <p className="text-sm text-neutral-400">Draft complete.</p>
          )}
        </section>
      )}
    </div>
  );
}

function InviteCodeWidget({ inviteCode, isAdmin }: { inviteCode: string | null; isAdmin: boolean }) {
  return (
    <div className="text-right text-xs text-neutral-500 shrink-0">
      <p>Invite code</p>
      {inviteCode ? (
        <p className="font-mono tracking-widest text-neutral-300">{inviteCode}</p>
      ) : (
        <p className="text-yellow-500">Not set</p>
      )}
      {isAdmin && (
        <form action={regenerateInviteCodeAction}>
          <button className="mt-1 text-blue-400 hover:text-blue-300 underline underline-offset-2">
            {inviteCode ? "Regenerate" : "Generate"}
          </button>
        </form>
      )}
      {!isAdmin && !inviteCode && <p className="text-yellow-500">Ask an admin</p>}
    </div>
  );
}

function WaitingPoolList({
  pool,
  currentUserId,
  canHost,
  isDraft,
  hasCaptainA,
  hasCaptainB,
  canPickNow,
  nextCoachTeam,
  premierRatings,
}: {
  pool: PlayerRow[];
  currentUserId: string;
  canHost: boolean;
  isDraft: boolean;
  hasCaptainA: boolean;
  hasCaptainB: boolean;
  canPickNow: boolean;
  nextCoachTeam: "A" | "B";
  premierRatings: Map<string, ResolvedRating>;
}) {
  return (
    <>
      <h3 className="text-xs font-medium text-neutral-400 mb-2">
        Waiting pool{pool.length > 0 ? ` (${pool.length})` : ""}
      </h3>
      <ul className="space-y-2">
        {pool.map((p) => (
          <li key={p.id}>
            <span className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5 min-w-0 flex-1">
                {p.user.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.user.avatarUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
                )}
                <span className="truncate">
                  {p.user.name}
                  {p.userId === currentUserId && <span className="text-neutral-500"> (you)</span>}
                </span>
                <PlayerRatingBadge resolved={premierRatings.get(p.user.steamId64)} />
              </span>
              {canPickNow && (
                <form action={draftPickAction}>
                  <input type="hidden" name="roomPlayerId" value={p.id} />
                  <button
                    title={`Pick ${p.user.name}`}
                    className="w-5 h-5 flex items-center justify-center rounded-md border border-blue-700 text-blue-400 hover:border-blue-500 hover:text-blue-300 hover:bg-blue-950/40 transition-colors shrink-0"
                  >
                    +
                  </button>
                </form>
              )}
            </span>
            {canHost && isDraft && (
              <span className="flex gap-1 mt-1">
                {!hasCaptainA && (
                  <HostButton
                    action={assignCaptain}
                    roomPlayerId={p.id}
                    extra={{ team: "A" }}
                    title="Make captain of Team A"
                    compact
                  >
                    A
                  </HostButton>
                )}
                {!hasCaptainB && (
                  <HostButton
                    action={assignCaptain}
                    roomPlayerId={p.id}
                    extra={{ team: "B" }}
                    title="Make captain of Team B"
                    compact
                  >
                    B
                  </HostButton>
                )}
                <HostButton
                  action={assignCoach}
                  roomPlayerId={p.id}
                  extra={{ team: nextCoachTeam }}
                  title={`Make coach of Team ${nextCoachTeam}`}
                  compact
                >
                  C
                </HostButton>
              </span>
            )}
          </li>
        ))}
        {pool.length === 0 && <li className="text-neutral-600">Empty</li>}
      </ul>
    </>
  );
}

/**
 * Shown in place of the whole SETUP/VETO/READY/LIVE flow once a match
 * finishes — the closing screen that used to not exist at all (the room
 * would just silently recycle into a fresh empty lobby within one
 * AutoRefresh tick). Deliberately limited to what we can actually source
 * right now (final score, winner, final map) — no MVP or box-score detail
 * until there's a demo-parsing pipeline to pull that from.
 */
function MatchSummary({
  room,
  canHost,
}: {
  room: {
    label: string;
    teamAName: string;
    teamBName: string;
    match: {
      team1Score: number;
      team2Score: number;
      winnerTeam: string | null;
      currentMap: string | null;
    } | null;
  };
  canHost: boolean;
}) {
  const winnerName =
    room.match?.winnerTeam === "A"
      ? room.teamAName
      : room.match?.winnerTeam === "B"
        ? room.teamBName
        : null;

  return (
    <div className="max-w-md mx-auto space-y-6 text-center">
      <AutoRefresh />
      <div>
        <p className="text-xs font-medium tracking-[0.2em] text-blue-500 uppercase">Match complete</p>
        <h1 className="text-2xl font-semibold mt-1">{room.label}</h1>
      </div>

      <div className="rounded-xl border border-blue-800/60 bg-blue-950/10 p-6 space-y-3">
        {winnerName && <p className="text-lg font-semibold text-emerald-400">{winnerName} won</p>}
        {room.match && (
          <div className="text-4xl font-bold tabular-nums">
            {room.match.team1Score} – {room.match.team2Score}
          </div>
        )}
        {room.match?.currentMap && (
          <p className="text-sm text-neutral-400">{mapLabel(room.match.currentMap)}</p>
        )}
      </div>

      <p className="text-xs text-neutral-600">
        Full match history is in{" "}
        <a
          href="/lounge?tab=games"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
        >
          Players Lounge → Previous games
        </a>
        .
      </p>

      {canHost ? (
        <form action={startNewLobbyAction}>
          <button className="rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2.5 text-white font-semibold transition-colors">
            Start new lobby
          </button>
        </form>
      ) : (
        <p className="text-sm text-neutral-500">Waiting for the host to start a new lobby…</p>
      )}
    </div>
  );
}

function PlayerRatingBadge({ resolved }: { resolved: ResolvedRating | undefined }) {
  if (resolved?.rating == null) return null;
  return <PremierRatingBadge rating={resolved.rating} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-neutral-400">{label}</p>
      <p>{value}</p>
    </div>
  );
}

function HostButton({
  action,
  roomPlayerId,
  extra,
  title,
  compact,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  roomPlayerId: string;
  extra?: Record<string, string>;
  title?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="roomPlayerId" value={roomPlayerId} />
      {extra &&
        Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button
        title={title}
        className={
          compact
            ? "w-5 h-5 flex items-center justify-center rounded-md border border-neutral-700 text-xs text-neutral-300 hover:border-blue-500 hover:text-blue-300 transition-colors"
            : "text-xs rounded-lg border border-neutral-700 px-2 py-1 hover:border-blue-500"
        }
      >
        {children}
      </button>
    </form>
  );
}

type TeamSlot = { type: "captain" | "player"; player: PlayerRow | null };

function EmptySlot({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 min-h-[4.5rem] text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-lg px-2 py-1.5">
      <span className="w-5 h-5 rounded-full border border-dashed border-neutral-700 shrink-0" />
      {label}
    </div>
  );
}

function TeamPanel({
  team,
  name,
  readyCount,
  totalCount,
  players,
  coaches,
  pool,
  currentUserId,
  myTeam,
  isHost,
  canRenameTeam,
  canSwitchTeams,
  isDraft,
  leetifyStats,
  premierRatings,
}: {
  team: "A" | "B";
  name: string;
  readyCount: number;
  totalCount: number;
  players: PlayerRow[];
  coaches: PlayerRow[];
  pool: PlayerRow[];
  currentUserId: string;
  myTeam: string;
  isHost: boolean;
  canRenameTeam: boolean;
  canSwitchTeams: boolean;
  isDraft: boolean;
  leetifyStats: Map<string, LeetifyMatchStats | null>;
  premierRatings: Map<string, ResolvedRating>;
}) {
  const onThisTeam = myTeam === team;

  // No fixed team size — show the captain slot (empty if unassigned), then
  // every actual player, then one trailing empty slot as a standing
  // invitation for the next person to join. Teams can end up uneven and
  // that's fine; there's no target to fill toward.
  const captain = players.find((p) => p.isCaptain) ?? null;
  const others = players.filter((p) => !p.isCaptain);
  const slots: TeamSlot[] = [
    { type: "captain", player: captain },
    ...others.map((p) => ({ type: "player" as const, player: p })),
    { type: "player", player: null },
  ];

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        {canRenameTeam ? (
          <form action={renameTeamAction} className="flex items-center gap-1 min-w-0">
            <input type="hidden" name="team" value={team} />
            <input
              name="name"
              defaultValue={name}
              maxLength={30}
              className="min-w-0 w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-0.5 text-sm font-medium focus:border-blue-500 focus:outline-none"
            />
            <button className="shrink-0 text-xs text-blue-400 hover:text-blue-300">Save</button>
          </form>
        ) : (
          <h3 className="text-sm font-medium text-neutral-300 truncate">{name}</h3>
        )}
        <span className="shrink-0 text-xs text-neutral-500">
          {readyCount}/{totalCount}
        </span>
      </div>
      <ul className="space-y-2">
        {slots.map((slot, i) =>
          slot.player ? (
            <li
              key={slot.player.id}
              className="rounded-lg border border-neutral-800/70 bg-neutral-950/40 p-2 min-h-[4.5rem] space-y-1.5"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="flex items-center gap-2 min-w-0 flex-1">
                  {slot.player.user.avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={slot.player.user.avatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0" />
                  )}
                  <span className={slot.player.isReady ? "text-emerald-400 shrink-0" : "text-neutral-500 shrink-0"}>
                    ●
                  </span>
                  <span className="truncate">
                    {slot.player.isCaptain && "⭐ "}
                    {slot.player.user.name}
                    {slot.player.userId === currentUserId && (
                      <span className="text-neutral-500"> (you)</span>
                    )}
                  </span>
                </span>
                <PlayerRatingBadge resolved={premierRatings.get(slot.player.user.steamId64)} />
                {isHost && (
                  <span className="flex items-center gap-1 shrink-0">
                    {!isDraft && (
                      <form action={toggleCaptain}>
                        <input type="hidden" name="roomPlayerId" value={slot.player.id} />
                        <button
                          title={slot.player.isCaptain ? "Unmake captain" : "Make captain"}
                          className={`w-6 h-6 flex items-center justify-center rounded-md border transition-colors ${
                            slot.player.isCaptain
                              ? "border-yellow-600 text-yellow-400 hover:border-yellow-500"
                              : "border-neutral-700 text-neutral-500 hover:border-yellow-600 hover:text-yellow-400"
                          }`}
                        >
                          {slot.player.isCaptain ? "★" : "☆"}
                        </button>
                      </form>
                    )}
                    <form action={unassignPlayer}>
                      <input type="hidden" name="roomPlayerId" value={slot.player.id} />
                      <button
                        title="Bench"
                        className="w-6 h-6 flex items-center justify-center rounded-md border border-red-900 text-red-400 hover:border-red-600 hover:text-red-300 transition-colors"
                      >
                        ✕
                      </button>
                    </form>
                  </span>
                )}
              </div>
              <div className="sm:pl-7 overflow-x-auto">
                <LeetifyStatsStrip
                  stats={leetifyStats.get(slot.player.user.steamId64) ?? null}
                  compact
                />
              </div>
            </li>
          ) : (
            <li key={`empty-${team}-${i}`}>
              <EmptySlot label={slot.type === "captain" ? "Captain" : "Player"} />
            </li>
          ),
        )}
      </ul>

      {coaches.length > 0 && (
        <div className="pt-2 border-t border-neutral-800 space-y-1.5">
          <p className="text-xs text-neutral-500">Coach{coaches.length > 1 ? "es" : ""}</p>
          {coaches.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 min-w-0">
                {c.user.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.user.avatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0" />
                )}
                <span className="truncate">{c.user.name}</span>
              </span>
              {isHost && (
                <HostButton action={toggleCoach} roomPlayerId={c.id}>
                  remove
                </HostButton>
              )}
            </div>
          ))}
        </div>
      )}

      {isHost && pool.length > 0 && (
        <p className="text-xs text-neutral-600">Assign players from the waiting pool</p>
      )}

      {canSwitchTeams && (
        <form action={setTeam} className="pt-2 border-t border-neutral-800">
          <input type="hidden" name="team" value={team} />
          <button
            disabled={onThisTeam}
            className={`w-full rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              onThisTeam
                ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                : "bg-emerald-700 hover:bg-emerald-600 text-white"
            }`}
          >
            {onThisTeam ? "You're here" : `Switch to ${name}`}
          </button>
        </form>
      )}
    </div>
  );
}
