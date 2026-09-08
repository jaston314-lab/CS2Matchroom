import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Format, VetoStep, DraftStep } from "@/lib/types";
import { mapLabel, mapImage } from "@/lib/maps";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/roomDefaults";
import { fetchLeetifyMatchStatsForRoom, type LeetifyMatchStats } from "@/lib/leetifyStats";
import { resolveRatingsForRoom, type ResolvedRating } from "@/lib/rating";
import { RoomLive } from "@/components/RoomLive";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PresenceHeartbeat } from "./PresenceHeartbeat";
import { RoomChat, type ChatMessageRow } from "./RoomChat";
import { PremierRatingBadge } from "@/components/PremierRatingBadge";
import { regenerateInviteCodeAction } from "@/app/admin/server/actions";
import { SettingsForm } from "./SettingsForm";
import { CancelMatchButton } from "./CancelMatchButton";
import { CoachPicker } from "./CoachPicker";
import { SideChoice } from "./SideChoice";
import {
  renameTeamAction,
  leaveLobby,
  setTeam,
  setReady,
  toggleCaptain,
  assignCaptain,
  unassignPlayer,
  banMapAction,
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

  const leetifyStats = await fetchLeetifyMatchStatsForRoom(
    room.players.map((p) => ({ steamId64: p.user.steamId64, isBot: p.user.isBot })),
  );
  const premierRatings = await resolveRatingsForRoom(
    room.players.map((p) => ({ steamId64: p.user.steamId64, manualRating: p.user.manualRating })),
  );
  const serverConfig = await db.serverConfig.findUnique({ where: { id: "singleton" } });
  const inviteCode = canHost ? serverConfig?.inviteCode || null : null;

  const chatMessages = await db.chatMessage.findMany({
    where: { roomId: room.id },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const chatRows: ChatMessageRow[] = chatMessages
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      userId: m.userId,
      userName: m.user.name,
      userAvatarUrl: m.user.avatarUrl,
    }));

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
  // No websocket/presence layer — PresenceHeartbeat.tsx bumps lastSeenAt
  // every ~3s while the matchroom page is open, so "closed the tab" shows
  // up here as a stale timestamp rather than lingering in the pool
  // forever. Only affects the pool display, not teams/ready state — a
  // brief network hiccup shouldn't silently bump someone off a team.
  const PRESENCE_STALE_MS = 10_000;
  // A fresh timestamp per request is exactly what we want here — this is a
  // Server Component re-run from scratch on every request/AutoRefresh
  // tick, not a memoized Client Component render the purity rule is
  // guarding against.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  // Always count the viewer loading this page as present, even before
  // their own first heartbeat has landed — otherwise a fresh page load can
  // flash "you're not in the pool" for a moment on first render.
  const isPresent = (p: { userId: string; lastSeenAt: Date }) =>
    p.userId === user.id || now - p.lastSeenAt.getTime() < PRESENCE_STALE_MS;
  const pool = room.players.filter((p) => p.team === "UNASSIGNED" && isPresent(p)) as PlayerRow[];
  const captainA = room.players.find((p) => p.team === "A" && p.isCaptain);
  const captainB = room.players.find((p) => p.team === "B" && p.isCaptain);
  const readyA = teamA.filter((p) => p.isReady).length;
  const readyB = teamB.filter((p) => p.isReady).length;
  // Vetoes/drafts are between the two teams' captains — a host who isn't
  // also an admin doesn't get to act on either team's behalf, only watch.
  // Mirrors the server-side check in matchroom/actions.ts.
  const canBanNow = isAdmin || (captainA?.userId === user.id && nextVetoTeam === "A") || (captainB?.userId === user.id && nextVetoTeam === "B");
  // No knife round — set once the map list resolves (see
  // startVetoForRoom/banMapAction). null means either knife round is on,
  // or the veto simply hasn't finished yet.
  const sideChoiceTeam = (room.veto?.sideChoiceTeam ?? null) as "A" | "B" | null;
  const chosenSide = (room.veto?.chosenSide ?? null) as "CT" | "T" | null;
  const canChooseSide =
    isAdmin ||
    (sideChoiceTeam === "A" && captainA?.userId === user.id) ||
    (sideChoiceTeam === "B" && captainB?.userId === user.id);
  const canPickNow =
    draftInProgress &&
    (isAdmin ||
      (captainA?.userId === user.id && nextDraftTeam === "A") ||
      (captainB?.userId === user.id && nextDraftTeam === "B"));
  const myPlayer = room.players.find((p) => p.userId === user.id);
  const myTeam = myPlayer?.team ?? "UNASSIGNED";
  const canEditNames = room.status !== "LIVE" && room.status !== "COMPLETED";
  const canRenameA = canEditNames && (canHost || captainA?.userId === user.id);
  const canRenameB = canEditNames && (canHost || captainB?.userId === user.id);
  const canSwitchTeams = !isDraft && isSetup && !room.teamsLocked;

  return (
    <div className="max-w-[1600px] mx-auto p-2 flex flex-col gap-2">
      <AutoRefresh />
      <PresenceHeartbeat />

      {/* Top info bar — room identity + host, mirroring the reference's
          share bar but with what this app actually has (an invite code,
          not a per-match shareable link). */}
      <section className="flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="text-center sm:text-left">
          <h1 className="text-lg font-bold text-white">{room.label}</h1>
          <p className="text-xs text-muted mt-0.5">
            {format} · Knife round {room.knifeRound ? "On" : "Off"} · OT{" "}
            {room.overtimeEnabled ? "On" : "Off"}
            {room.teamsLocked && <span className="text-amber-400"> · Teams locked</span>}
          </p>
        </div>
        <div className="flex items-center gap-4 text-muted">
          <span>
            Hosted by <span className="text-white font-medium">{room.host.name}</span>
          </span>
          {canHost && <InviteCodeWidget inviteCode={inviteCode} isAdmin={isAdmin} />}
        </div>
      </section>

      {isLive && room.match && (
        <div className="flex flex-col gap-2">
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
            connectAddress={serverConfig?.gameConnectAddress || null}
          />
          {canHost && (
            <div className="flex justify-center">
              <CancelMatchButton />
            </div>
          )}
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-2">
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
          <SettingsForm
            room={room}
            mapPool={mapPool}
            isAdmin={isAdmin}
            isDraft={isDraft}
            teamsLocked={room.teamsLocked}
            hasAnyAssigned={room.players.some((p) => p.team !== "UNASSIGNED")}
            myPlayer={myPlayer ? { isReady: myPlayer.isReady } : null}
            canStart={teamA.length > 0 && teamB.length > 0}
            showStartDraft={isDraft && !room.draft}
            canStartDraftNow={!!captainA && !!captainB}
          />
        ) : (
          <div className="panel p-4 flex flex-col justify-between gap-3">
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center justify-center gap-2">
                Match Settings
                {isAdmin && room.simulation && (
                  <span className="rounded bg-blue-900/60 text-blue-300 text-xs font-semibold px-2 py-0.5">
                    Test mode
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Stat label="Format" value={format} />
                <Stat label="Team split" value={`${teamA.length} v ${teamB.length}`} />
                <Stat label="Knife round" value={room.knifeRound ? "On" : "Off"} />
                <Stat label="Overtime" value={room.overtimeEnabled ? "On" : "Off"} />
              </div>
              {isVeto ? (
                <div>
                  <p className="text-xs text-muted mb-1.5">
                    Map veto — Team {nextVetoTeam}&apos;s turn
                    {!canBanNow && <span className="block text-muted/70">waiting on their captain (or an admin)</span>}
                  </p>
                  <div className="space-y-1.5">
                    {remainingPool.map((m) => (
                      <div
                        key={m}
                        className="flex items-center gap-2 rounded-lg border border-line bg-input overflow-hidden pr-2 text-xs"
                      >
                        {mapImage(m) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={mapImage(m)!} alt="" className="w-14 h-8 object-cover shrink-0" />
                        )}
                        <span className="flex-1 truncate text-left text-ink">{mapLabel(m)}</span>
                        <form action={banMapAction}>
                          <input type="hidden" name="map" value={m} />
                          <button
                            disabled={!canBanNow}
                            className="rounded bg-red-950/50 text-red-300 px-2 py-0.5 text-[11px] font-semibold hover:bg-red-900/60 disabled:opacity-40 disabled:hover:bg-red-950/50 transition-colors"
                          >
                            Ban
                          </button>
                        </form>
                      </div>
                    ))}
                  </div>
                  {canHost && (
                    <div className="pt-2 mt-1.5 border-t border-line flex justify-center">
                      <CancelMatchButton />
                    </div>
                  )}
                </div>
              ) : finalMapList ? (
                <div>
                  <p className="text-xs text-muted mb-1.5">
                    {finalMapList.length > 1 ? "Selected maps" : "Selected map"}
                    {room.veto?.overriddenByHost && <span className="text-muted/70"> (host override)</span>}
                  </p>
                  <div className="space-y-2">
                    {finalMapList.map((m, i) => {
                      const isCurrentMap = isLive && room.match && i === room.match.currentMapIndex;
                      const img = mapImage(m);
                      return (
                        <div
                          key={m}
                          className={`relative h-20 rounded-lg overflow-hidden border ${
                            isCurrentMap ? "border-accent-blue" : "border-line"
                          }`}
                        >
                          {img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          ) : (
                            <div className="absolute inset-0 bg-input" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                          <div className="absolute inset-x-0 bottom-0 px-2.5 py-1.5 flex items-center justify-between">
                            <span className="text-sm font-semibold text-white drop-shadow">{mapLabel(m)}</span>
                            {finalMapList.length > 1 && <span className="text-[10px] text-muted">Map {i + 1}</span>}
                          </div>
                          {isCurrentMap && (
                            <span className="absolute top-1.5 right-1.5 rounded-full bg-accent-blue text-white text-[10px] font-semibold px-1.5 py-0.5">
                              Live
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!room.knifeRound && sideChoiceTeam && (
                    <div className="mt-2">
                      <SideChoice
                        sideChoiceTeam={sideChoiceTeam}
                        chosenSide={chosenSide}
                        teamAName={room.teamAName}
                        teamBName={room.teamBName}
                        wasCoinFlip={vetoSteps.length === 0}
                        canChoose={canChooseSide}
                      />
                    </div>
                  )}
                  {room.status === "READY" && canHost && (
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <form action={startMatchAction}>
                        <button className="w-full bg-accent-blue hover:bg-accent-blue-hover text-white font-bold py-2.5 rounded-lg text-sm transition-colors">
                          Start match
                        </button>
                      </form>
                      <CancelMatchButton fullWidth />
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted mb-1.5">Map pool</p>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {mapPool.map((m) => (
                      <span key={m} className="rounded border border-line bg-input px-1.5 py-0.5 text-ink">
                        {mapLabel(m)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {isSetup && myPlayer && (
              <div className="space-y-2">
                <form action={setReady}>
                  <input type="hidden" name="ready" value={(!myPlayer.isReady).toString()} />
                  <button className="w-full bg-accent-green hover:bg-accent-green-hover text-white font-bold py-3 rounded-lg text-base transition-colors">
                    {myPlayer.isReady ? "Unready" : "Ready Up"}
                  </button>
                </form>
                <form action={leaveLobby}>
                  <button className="w-full text-red-300 hover:text-red-200 py-1 text-xs transition-colors">
                    Leave lobby
                  </button>
                </form>
              </div>
            )}
          </div>
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
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <RoomChat messages={chatRows} currentUserId={user.id} />
        {isSetup && (
          <div className="panel p-4 h-52 overflow-y-auto">
            <WaitingPoolList
              pool={pool}
              currentUserId={user.id}
              canHost={canHost}
              isDraft={isDraft}
              hasCaptainA={!!captainA}
              hasCaptainB={!!captainB}
              canPickNow={canPickNow}
              premierRatings={premierRatings}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function InviteCodeWidget({ inviteCode, isAdmin }: { inviteCode: string | null; isAdmin: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {inviteCode ? (
        <span className="bg-accent-gray text-white px-3 py-1 rounded-md text-xs font-semibold tracking-widest font-mono">
          {inviteCode}
        </span>
      ) : (
        <span className="text-yellow-500 text-xs">Invite code not set</span>
      )}
      {isAdmin && (
        <form action={regenerateInviteCodeAction}>
          <button className="text-blue-400 hover:text-blue-300 underline underline-offset-2 text-xs">
            {inviteCode ? "Regenerate" : "Generate"}
          </button>
        </form>
      )}
      {!isAdmin && !inviteCode && <span className="text-yellow-500 text-xs">Ask an admin</span>}
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
  premierRatings,
}: {
  pool: PlayerRow[];
  currentUserId: string;
  canHost: boolean;
  isDraft: boolean;
  hasCaptainA: boolean;
  hasCaptainB: boolean;
  canPickNow: boolean;
  premierRatings: Map<string, ResolvedRating>;
}) {
  return (
    <>
      <h2 className="text-sm font-bold text-white mb-1.5">
        Waiting Room{pool.length > 0 ? ` (${pool.length})` : ""}
      </h2>
      {/* A full pool used to list one-per-row and run off the bottom of a
          fixed-height box — a compact multi-column grid instead, so a
          dozen-plus players actually fit inside it. */}
      {/* Single column below sm — 2-3 cramped columns on a phone-width
          screen left no room for the name once the rating badge and A/B
          buttons were in the row too (it was truncating to nothing). */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {pool.map((p) => (
          <li key={p.id} className="flex items-center gap-1 rounded-lg border border-line bg-input/50 px-1.5 py-1">
            {p.user.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.user.avatarUrl} alt="" className="w-5 h-5 rounded-full border border-line shrink-0" />
            )}
            <span className="min-w-0 flex-1 text-xs text-white font-medium truncate">
              {p.user.name}
              {p.userId === currentUserId && <span className="text-muted font-normal"> (you)</span>}
            </span>
            <PlayerRatingBadge resolved={premierRatings.get(p.user.steamId64)} />
            {/* Everything used to stack under the name as its own row —
                a full "Pick" button, then a whole extra row of A/B/C
                buttons — which is what made a full pool run so tall.
                Same row as the name now, just much smaller controls. */}
            {canPickNow && (
              <form action={draftPickAction}>
                <input type="hidden" name="roomPlayerId" value={p.id} />
                <button
                  title="Pick"
                  className="shrink-0 w-5 h-5 flex items-center justify-center rounded bg-accent-gray hover:bg-accent-gray-hover text-white text-xs font-bold transition-colors"
                >
                  +
                </button>
              </form>
            )}
            {/* Coach assignment moved to the "+" picker on each team's
                empty coach slot — no separate C button needed here. */}
            {canHost && isDraft && (
              <span className="flex gap-0.5 shrink-0">
                {!hasCaptainA && (
                  <TinyHostButton action={assignCaptain} roomPlayerId={p.id} extra={{ team: "A" }} title="Make captain of Team A">
                    A
                  </TinyHostButton>
                )}
                {!hasCaptainB && (
                  <TinyHostButton action={assignCaptain} roomPlayerId={p.id} extra={{ team: "B" }} title="Make captain of Team B">
                    B
                  </TinyHostButton>
                )}
              </span>
            )}
          </li>
        ))}
        {pool.length === 0 && <li className="col-span-full text-sm text-muted text-center py-4">Empty</li>}
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
    <div className="max-w-md mx-auto p-4 space-y-6 text-center">
      <AutoRefresh />
      <div>
        <p className="text-xs font-medium tracking-[0.2em] text-blue-500 uppercase">Match complete</p>
        <h1 className="text-2xl font-bold text-white mt-1">{room.label}</h1>
      </div>

      <div className="panel p-6 space-y-3">
        {winnerName && <p className="text-lg font-semibold text-emerald-400">{winnerName} won</p>}
        {room.match && (
          <div className="text-4xl font-bold tabular-nums text-white">
            {room.match.team1Score} – {room.match.team2Score}
          </div>
        )}
        {room.match?.currentMap && <p className="text-sm text-muted">{mapLabel(room.match.currentMap)}</p>}
      </div>

      <p className="text-xs text-muted">
        Full match history is in{" "}
        <a href="/lounge?tab=games" className="text-blue-400 hover:text-blue-300 underline underline-offset-2">
          Players Lounge → Previous games
        </a>
        .
      </p>

      {canHost ? (
        <form action={startNewLobbyAction}>
          <button className="bg-accent-blue hover:bg-accent-blue-hover text-white font-bold px-6 py-3 rounded-lg text-base transition-colors">
            Start new lobby
          </button>
        </form>
      ) : (
        <p className="text-sm text-muted">Waiting for the host to start a new lobby…</p>
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
    <div className="rounded-lg border border-line bg-input px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-medium text-ink">{value}</p>
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
            ? "w-6 h-6 flex items-center justify-center rounded-md border border-line bg-input text-xs text-muted hover:text-white hover:border-accent-blue transition-colors"
            : "text-xs rounded-md border border-line bg-input px-2 py-1 text-muted hover:text-white hover:border-accent-blue transition-colors"
        }
      >
        {children}
      </button>
    </form>
  );
}

/** Even smaller than HostButton's own "compact" — for the A/B/C
 * captain/coach-assign buttons squeezed onto the same row as a waiting
 * pool entry's name and rating, where three of HostButton's w-6 buttons
 * plus the rest of the row's content wouldn't fit. */
function TinyHostButton({
  action,
  roomPlayerId,
  extra,
  title,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  roomPlayerId: string;
  extra?: Record<string, string>;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="roomPlayerId" value={roomPlayerId} />
      {extra &&
        Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button
        title={title}
        className="w-5 h-5 flex items-center justify-center rounded border border-line bg-input text-[10px] text-muted hover:text-white hover:border-accent-blue transition-colors"
      >
        {children}
      </button>
    </form>
  );
}

// A real competitive lineup: 5 players (first is the captain slot) plus 1
// coach. These are the number of rows always rendered, empty or not, so the
// panel reads as a real roster card rather than an open-ended list.
const MAX_PLAYER_SLOTS = 5;
const MAX_COACH_SLOTS = 1;

function EmptySlot({ label, variant = "coach" }: { label: string; variant?: "player" | "coach" }) {
  // "player" mirrors PlayerSlotRow's own two-line shape (identity row +
  // a second, blank line standing in for the stats line) so an empty seat
  // takes up exactly the same height as a filled one — the roster's fixed
  // box shouldn't read as "half empty" just because it's not full yet.
  // Coach rows never carry a stats line, so the shorter one-line shape
  // already matches a filled coach row and doesn't need this.
  if (variant === "player") {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-input/50 px-2.5 py-1.5 text-muted">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full border border-dashed border-line shrink-0" />
          <span className="text-sm">{label}</span>
        </div>
        <p className="pl-9 text-[10px]">&nbsp;</p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-input/50 px-2.5 py-1.5 text-xs text-muted">
      <span className="w-7 h-7 rounded-full border border-dashed border-line shrink-0" />
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

  // Fixed roster shape: captain-first ordering, then the rest, padded out
  // to exactly MAX_PLAYER_SLOTS/MAX_COACH_SLOTS rows so the card always
  // reads as a real 5+1 lineup rather than an open-ended list. Team size
  // isn't actually capped at the data layer (see setTeam/assignCoach in
  // actions.ts) — Math.max keeps this purely a rendering concern: if a
  // room somehow ends up with more than 5 players or more than 1 coach,
  // every one of them still gets a row, just appended past the fixed 5/1
  // rather than the rendering silently dropping real roster data.
  const captain = players.find((p) => p.isCaptain) ?? null;
  const otherPlayers = players.filter((p) => !p.isCaptain);
  const orderedPlayers = captain ? [captain, ...otherPlayers] : otherPlayers;
  const playerSlots: (PlayerRow | null)[] = Array.from(
    { length: Math.max(MAX_PLAYER_SLOTS, orderedPlayers.length) },
    (_, i) => orderedPlayers[i] ?? null,
  );
  const coachSlots: (PlayerRow | null)[] = Array.from(
    { length: Math.max(MAX_COACH_SLOTS, coaches.length) },
    (_, i) => coaches[i] ?? null,
  );
  // Anyone eligible to become this team's coach: its own roster (captain
  // included — assignCoach clears the captain flag for you) plus whoever's
  // still in the waiting pool. assignCoach sets team+isCoach in one write,
  // so a pool player and an existing teammate go through the same picker.
  const coachCandidates = [...players, ...pool].map((p) => ({ id: p.id, name: p.user.name }));

  return (
    <div className="panel p-3 flex flex-col gap-2 h-full">
      <div className="flex justify-between items-center gap-2">
        {canRenameTeam ? (
          <form action={renameTeamAction} className="flex items-center gap-1 min-w-0">
            <input type="hidden" name="team" value={team} />
            <input
              name="name"
              defaultValue={name}
              maxLength={30}
              className="min-w-0 w-full rounded-md bg-input border border-line px-1.5 py-0.5 text-lg font-bold text-white focus:outline focus:outline-1 focus:outline-blue-500"
            />
            <button className="shrink-0 text-xs text-blue-400 hover:text-blue-300">Save</button>
          </form>
        ) : (
          <h2 className="text-lg font-bold text-white truncate">{name}</h2>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted">{readyCount}/{totalCount}</span>
          {canSwitchTeams && (
            <form action={setTeam}>
              <input type="hidden" name="team" value={team} />
              <button
                disabled={onThisTeam}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  onThisTeam
                    ? "bg-input text-muted cursor-not-allowed"
                    : "bg-accent-green hover:bg-accent-green-hover text-white"
                }`}
              >
                {onThisTeam ? "You're here" : `Switch to ${name}`}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Fixed at exactly what 5 *filled* rows need (measured, not
          guessed: 5 × 61px row + 4 × 6px gap), so a full roster never
          scrolls — an empty one just leaves blank space below its shorter
          rows instead. Locked to the full-state height, not some smaller
          cap that only the empty state comfortably fits in. */}
      <div className="flex flex-col gap-1.5 h-[332px] overflow-y-auto pr-0.5">
        {playerSlots.map((player, i) =>
          player ? (
            <PlayerSlotRow
              key={player.id}
              player={player}
              currentUserId={currentUserId}
              isHost={isHost}
              isDraft={isDraft}
              leetifyStats={leetifyStats}
              premierRatings={premierRatings}
            />
          ) : (
            <EmptySlot
              key={`empty-player-${team}-${i}`}
              label={i === 0 ? "Empty · Captain" : "Empty · Player"}
              variant="player"
            />
          ),
        )}
      </div>

      <div className="flex flex-col gap-1.5 pt-1.5 border-t border-line">
        {coachSlots.map((coach, i) =>
          coach ? (
            <div key={coach.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-line bg-input">
              <div className="flex items-center gap-2 min-w-0">
                {coach.user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coach.user.avatarUrl} alt="" className="w-7 h-7 rounded-full border border-line shrink-0" />
                ) : (
                  <span className="w-7 h-7 rounded-full border border-line bg-panel shrink-0" />
                )}
                <span className="font-medium text-white truncate text-sm">{coach.user.name}</span>
                <span className="shrink-0 rounded bg-sky-500/15 text-sky-400 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5">
                  Coach
                </span>
              </div>
              {isHost && (
                <HostButton action={unassignPlayer} roomPlayerId={coach.id} compact title="Bench">
                  ✕
                </HostButton>
              )}
            </div>
          ) : isHost ? (
            <CoachPicker
              key={`empty-coach-${team}-${i}`}
              team={team}
              candidates={coachCandidates}
            />
          ) : (
            <EmptySlot key={`empty-coach-${team}-${i}`} label="Empty · Coach" />
          ),
        )}
      </div>

      {/* Always rendered (just hidden when there's no one to assign) rather
          than conditionally mounted — this line sits outside the roster's
          own fixed-height box, so mounting/unmounting it was the one
          remaining thing that could still change the panel's height, e.g.
          the instant someone leaves a team and lands back in the pool. */}
      {isHost && (
        <p className={`text-xs text-muted ${pool.length > 0 ? "" : "invisible"}`}>
          Assign players from the waiting pool
        </p>
      )}
    </div>
  );
}

function PlayerSlotRow({
  player,
  currentUserId,
  isHost,
  isDraft,
  leetifyStats,
  premierRatings,
}: {
  player: PlayerRow;
  currentUserId: string;
  isHost: boolean;
  isDraft: boolean;
  leetifyStats: Map<string, LeetifyMatchStats | null>;
  premierRatings: Map<string, ResolvedRating>;
}) {
  const stats = leetifyStats.get(player.user.steamId64) ?? null;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-input px-2.5 py-1.5">
      {/* Line 1: identity + status, all on one row — name/badges/rating
          share a shrinkable, truncating cluster on the left so the ready
          pill and host buttons on the right never get pushed off. */}
      <div className="flex items-center gap-2">
        {player.user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.user.avatarUrl} alt="" className="w-7 h-7 rounded-full border border-line shrink-0" />
        ) : (
          <span className="w-7 h-7 rounded-full border border-line bg-panel shrink-0" />
        )}
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          <span className="font-medium text-white truncate text-sm">{player.user.name}</span>
          {player.userId === currentUserId && (
            <span className="text-muted font-normal text-xs shrink-0">(you)</span>
          )}
          {player.isCaptain && (
            <span className="shrink-0 rounded bg-amber-500/15 text-amber-400 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5">
              Captain
            </span>
          )}
          <PlayerRatingBadge resolved={premierRatings.get(player.user.steamId64)} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              player.isReady ? "bg-emerald-500/15 text-emerald-400" : "border border-line text-muted"
            }`}
          >
            {player.isReady ? "Ready" : "Not ready"}
          </span>
          {isHost && (
            <>
              {!isDraft && (
                <form action={toggleCaptain}>
                  <input type="hidden" name="roomPlayerId" value={player.id} />
                  <button
                    title={player.isCaptain ? "Unmake captain" : "Make captain"}
                    className={`w-6 h-6 flex items-center justify-center rounded-md border transition-colors ${
                      player.isCaptain
                        ? "border-amber-600 bg-amber-500/15 text-amber-400"
                        : "border-line bg-panel text-muted hover:text-amber-400"
                    }`}
                  >
                    {player.isCaptain ? "★" : "☆"}
                  </button>
                </form>
              )}
              <form action={unassignPlayer}>
                <input type="hidden" name="roomPlayerId" value={player.id} />
                <button
                  title="Bench"
                  className="w-6 h-6 flex items-center justify-center rounded-md border border-line bg-panel text-red-400 hover:border-red-600 hover:bg-red-950/40 transition-colors"
                >
                  ✕
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Line 2: a single lightweight stats strip — deliberately fewer,
          bullet-separated fields instead of the old 7-column grid, which
          overflowed this column's real width. */}
      {stats && <CompactStatsLine stats={stats} />}
    </div>
  );
}

function CompactStatsLine({ stats }: { stats: LeetifyMatchStats }) {
  const swingPositive = stats.swingPct >= 0;
  return (
    <p className="pl-9 text-[10px] text-muted/80 whitespace-nowrap overflow-x-auto">
      <span className="tabular-nums text-ink">{Math.round(stats.winPct)}%</span> WINS
      <span className="mx-1.5 text-muted/40">•</span>
      <span className="tabular-nums text-ink">{stats.rating.toFixed(2)}</span> RATING
      <span className="mx-1.5 text-muted/40">•</span>
      <span className={`tabular-nums ${swingPositive ? "text-emerald-400" : "text-red-400"}`}>
        {swingPositive ? "+" : ""}
        {stats.swingPct.toFixed(2)}%
      </span>{" "}
      SWING
      <span className="mx-1.5 text-muted/40">•</span>
      <span className="tabular-nums text-ink">
        {stats.kills}/{stats.deaths}/{stats.assists}
      </span>{" "}
      K/D/A
      <span className="mx-1.5 text-muted/40">•</span>
      <span className="tabular-nums text-ink">{stats.adr != null ? stats.adr.toFixed(1) : "—"}</span> ADR
    </p>
  );
}
