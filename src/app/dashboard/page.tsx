import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mapsRequiredForFormat, type Format, type VetoStep, type DraftStep } from "@/lib/types";
import { AVAILABLE_MAPS, mapLabel } from "@/lib/maps";
import { RoomLive } from "@/components/RoomLive";
import { AutoRefresh } from "@/components/AutoRefresh";
import { regenerateInviteCodeAction } from "@/app/admin/server/actions";
import {
  updateSettingsAction,
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
  scrambleTeams,
  balanceTeamsAction,
  banMapAction,
  overrideMapsAction,
  startDraftAction,
  draftPickAction,
  startMatchAction,
  cancelMatchAction,
} from "./actions";

type PlayerRow = {
  id: string;
  userId: string;
  team: string;
  isCaptain: boolean;
  isCoach: boolean;
  isReady: boolean;
  user: { name: string; avatarUrl: string | null; steamId64: string };
};

const DEFAULT_SETTINGS = {
  label: "Friday night 5v5",
  format: "BO1" as const,
  mode: "SELF_SELECT" as const,
  mapPool: AVAILABLE_MAPS.map((m) => m.id),
  knifeRound: true,
  overtimeEnabled: true,
  minPlayersToStart: 10,
  playersPerTeam: 5,
  coachesPerTeam: 1,
};

async function getOrCreateActiveRoom() {
  const existing = await db.room.findFirst({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  // There's always a lobby open, even before any host has configured
  // anything — hostUserId is a required column, satisfied by any admin
  // (guaranteed to exist post-bootstrap) as a placeholder. Any host/admin
  // can edit settings regardless of who's recorded here (see
  // assertCanManage in actions.ts) — it just gets reclaimed automatically.
  const placeholderHost = await db.user.findFirst({ where: { role: "ADMIN" } });
  return db.room.create({
    data: {
      ...DEFAULT_SETTINGS,
      mapPool: JSON.stringify(DEFAULT_SETTINGS.mapPool),
      hostUserId: placeholderHost!.id,
    },
  });
}

export default async function DashboardPage() {
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

  if (!room.players.some((p) => p.userId === user.id)) {
    const newPlayer = await db.roomPlayer.upsert({
      where: { roomId_userId: { roomId: room.id, userId: user.id } },
      update: {},
      create: { roomId: room.id, userId: user.id },
      include: { user: true },
    });
    room.players.push(newPlayer);
  }

  const canHost = user.role === "HOST" || user.role === "ADMIN";
  const isAdmin = user.role === "ADMIN";
  const inviteCode = canHost
    ? (await db.serverConfig.findUnique({ where: { id: "singleton" } }))?.inviteCode || null
    : null;

  const isSetup = room.status === "SETUP";
  const isVeto = room.status === "VETO";
  const isLive = room.status === "LIVE";
  const isDraft = room.mode === "CAPTAIN_DRAFT";

  const mapPool = JSON.parse(room.mapPool) as string[];
  const format = room.format as Format;
  const requiredMaps = mapsRequiredForFormat(format);

  const vetoSteps = room.veto ? (JSON.parse(room.veto.steps) as VetoStep[]) : [];
  const finalMapList = room.veto?.finalMapList ? (JSON.parse(room.veto.finalMapList) as string[]) : null;
  const remainingPool = mapPool.filter((m) => !vetoSteps.some((s) => s.map === m));
  const nextVetoTeam: "A" | "B" = vetoSteps.length % 2 === 0 ? "A" : "B";

  const draftSteps = room.draft ? (JSON.parse(room.draft.steps) as DraftStep[]) : [];
  const draftInProgress = room.draft?.status === "IN_PROGRESS";
  const draftCountA = draftSteps.filter((s) => s.team === "A").length;
  const draftCountB = draftSteps.filter((s) => s.team === "B").length;
  const targetPicksPerTeam = room.playersPerTeam - 1;
  const nextDraftTeam: "A" | "B" =
    draftCountA < targetPicksPerTeam && draftCountB < targetPicksPerTeam
      ? draftSteps.length % 2 === 0
        ? "A"
        : "B"
      : draftCountA < targetPicksPerTeam
        ? "A"
        : "B";

  const teamA = room.players.filter((p) => p.team === "A" && !p.isCoach) as PlayerRow[];
  const teamB = room.players.filter((p) => p.team === "B" && !p.isCoach) as PlayerRow[];
  const coachA = room.players.find((p) => p.team === "A" && p.isCoach) as PlayerRow | undefined;
  const coachB = room.players.find((p) => p.team === "B" && p.isCoach) as PlayerRow | undefined;
  const pool = room.players.filter((p) => p.team === "UNASSIGNED") as PlayerRow[];
  const captainA = room.players.find((p) => p.team === "A" && p.isCaptain);
  const captainB = room.players.find((p) => p.team === "B" && p.isCaptain);
  const readyA = teamA.filter((p) => p.isReady).length;
  const readyB = teamB.filter((p) => p.isReady).length;
  const canBanNow = canHost || (captainA?.userId === user.id && nextVetoTeam === "A") || (captainB?.userId === user.id && nextVetoTeam === "B");
  const myPlayer = room.players.find((p) => p.userId === user.id);
  const myTeam = myPlayer?.team ?? "UNASSIGNED";
  const canEditNames = room.status !== "LIVE" && room.status !== "COMPLETED";
  const canRenameA = canEditNames && (canHost || captainA?.userId === user.id);
  const canRenameB = canEditNames && (canHost || captainB?.userId === user.id);
  const canSwitchTeams = !isDraft && isSetup;

  return (
    <div className="space-y-8">
      <AutoRefresh />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{room.label}</h1>
          <p className="text-sm text-neutral-400">
            Hosted by {room.host.name} · {room.status} ·{" "}
            {isDraft ? "Captain draft" : "Self-select"}
          </p>
        </div>
        {canHost && (
          <InviteCodeWidget inviteCode={inviteCode} isAdmin={isAdmin} />
        )}
      </div>

      {isVeto && (
        <section className="rounded-xl border border-blue-700 bg-blue-950/30 p-5 space-y-3">
          <h2 className="text-lg font-semibold">Map veto</h2>
          <p className="text-sm text-neutral-300">
            Team {nextVetoTeam}&apos;s turn to ban
            {!canBanNow && " — waiting on their captain (or the host)"}
          </p>
          <div className="flex flex-wrap gap-2">
            {remainingPool.map((m) => (
              <form key={m} action={banMapAction}>
                <input type="hidden" name="map" value={m} />
                <button
                  disabled={!canBanNow}
                  className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm hover:border-blue-500 disabled:opacity-40"
                >
                  Ban {mapLabel(m)}
                </button>
              </form>
            ))}
          </div>
          {canHost && (
            <details className="text-sm pt-2">
              <summary className="cursor-pointer text-neutral-400">Override instead</summary>
              <OverrideMapsForm requiredMaps={requiredMaps} />
            </details>
          )}
        </section>
      )}

      {room.status === "READY" && finalMapList && (
        <section className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-5 space-y-3">
          <h2 className="text-lg font-semibold">Maps resolved</h2>
          <p className="text-sm">
            {finalMapList.map(mapLabel).join(" → ")}
            {room.veto?.overriddenByHost && <span className="text-neutral-500"> (host override)</span>}
          </p>
          {canHost && (
            <form action={startMatchAction}>
              <button className="rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2.5 text-white font-semibold">
                Start match
              </button>
            </form>
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
            />
          </div>
          <div className="hidden lg:block fixed left-6 top-24 w-52 rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-3 text-sm">
            <WaitingPoolList
              pool={pool}
              currentUserId={user.id}
              canHost={canHost}
              isDraft={isDraft}
              hasCaptainA={!!captainA}
              hasCaptainB={!!captainB}
            />
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-[15rem_18rem_15rem] lg:w-fit lg:mx-auto">
        <TeamPanel
          team="A"
          name={room.teamAName}
          readyCount={readyA}
          totalCount={teamA.length}
          players={teamA}
          coach={coachA}
          pool={pool}
          currentUserId={user.id}
          myTeam={myTeam}
          isHost={canHost && isSetup}
          canRenameTeam={canRenameA}
          canSwitchTeams={canSwitchTeams}
          isDraft={isDraft}
        />

        {isSetup && canHost ? (
          <SettingsForm room={room} mapPool={mapPool} />
        ) : (
          <section className="space-y-2 text-xs rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
            <h2 className="text-xs font-medium text-neutral-300 mb-1">
              Match settings
              {room.simulation && (
                <span className="ml-1.5 rounded bg-blue-900/60 text-blue-300 px-1.5 py-0.5">
                  Test mode
                </span>
              )}
            </h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <Stat label="Format" value={format} />
              <Stat label="Players/team" value={String(room.playersPerTeam)} />
              <Stat label="Knife round" value={room.knifeRound ? "On" : "Off"} />
              <Stat label="Overtime" value={room.overtimeEnabled ? "On" : "Off"} />
            </div>
            <div>
              <p className="text-neutral-500 mb-1">Map pool</p>
              <div className="flex flex-wrap gap-1">
                {mapPool.map((m) => (
                  <span key={m} className="rounded bg-neutral-800 px-1.5 py-0.5">
                    {mapLabel(m)}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        <TeamPanel
          team="B"
          name={room.teamBName}
          readyCount={readyB}
          totalCount={teamB.length}
          players={teamB}
          coach={coachB}
          pool={pool}
          currentUserId={user.id}
          myTeam={myTeam}
          isHost={canHost && isSetup}
          canRenameTeam={canRenameB}
          canSwitchTeams={canSwitchTeams}
          isDraft={isDraft}
        />

        {myPlayer && isSetup && (
          <div className="lg:col-start-2 flex flex-wrap justify-center gap-2">
            {canSwitchTeams && myPlayer.team !== "UNASSIGNED" && (
              <form action={setTeam}>
                <input type="hidden" name="team" value="UNASSIGNED" />
                <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500">
                  Move to waiting pool
                </button>
              </form>
            )}
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
            <div className="space-y-2">
              <p className="text-sm text-neutral-400">
                Team {nextDraftTeam}&apos;s turn to pick
              </p>
              <div className="flex flex-wrap gap-2">
                {pool.map((p) => (
                  <form key={p.id} action={draftPickAction}>
                    <input type="hidden" name="roomPlayerId" value={p.id} />
                    <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500">
                      Pick {p.user.name}
                    </button>
                  </form>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-400">Draft complete.</p>
          )}
        </section>
      )}

      {canHost && isSetup && (
        <section className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
          <h2 className="text-lg font-medium">Host controls</h2>

          {!isDraft && (
            <div className="flex flex-wrap gap-3">
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

          <details className="text-sm">
            <summary className="cursor-pointer text-neutral-400">
              Set maps directly (skip veto)
            </summary>
            <OverrideMapsForm requiredMaps={requiredMaps} />
          </details>

          {room.simulation && (
            <form action={readyUpAllAction}>
              <button className="rounded-lg border border-blue-700 bg-blue-950/40 text-blue-300 px-3 py-1.5 text-sm hover:border-blue-500">
                Fill with bots &amp; ready up (test mode)
              </button>
            </form>
          )}

          <p className="text-xs text-neutral-500">
            Once both teams have {room.playersPerTeam} ready players, map veto starts
            automatically (or the match jumps straight to Start if you&apos;ve already set maps
            above).
          </p>
        </section>
      )}

      {canHost && room.status !== "COMPLETED" && (
        <form action={cancelMatchAction}>
          <button className="rounded-lg border border-red-900 text-red-300 px-3 py-1.5 text-sm hover:border-red-700">
            Cancel match
          </button>
        </form>
      )}
    </div>
  );
}

function OverrideMapsForm({ requiredMaps }: { requiredMaps: number }) {
  return (
    <form action={overrideMapsAction} className="mt-2 space-y-2">
      {Array.from({ length: requiredMaps }, (_, i) => (
        <select
          key={i}
          name={`map_${i}`}
          defaultValue=""
          className="w-full rounded-lg bg-neutral-950 border border-neutral-700 px-2 py-1.5"
        >
          <option value="" disabled>
            Map {i + 1}
          </option>
          {AVAILABLE_MAPS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      ))}
      <button className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500">
        Set maps
      </button>
    </form>
  );
}

function SettingsForm({
  room,
  mapPool,
}: {
  room: {
    label: string;
    format: string;
    mode: string;
    knifeRound: boolean;
    overtimeEnabled: boolean;
    minPlayersToStart: number;
    playersPerTeam: number;
    coachesPerTeam: number;
    simulation: boolean;
  };
  mapPool: string[];
}) {
  return (
    <section className="rounded-xl border border-blue-800/60 bg-blue-950/10 p-3 space-y-3 text-xs">
      <h2 className="text-xs font-semibold text-neutral-200">Match settings</h2>
      <form action={updateSettingsAction} className="space-y-3">
        <div>
          <label className="block text-neutral-400 mb-0.5" htmlFor="label">
            Match name
          </label>
          <input
            id="label"
            name="label"
            required
            defaultValue={room.label}
            className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-neutral-400 mb-0.5" htmlFor="format">
              Format
            </label>
            <select
              id="format"
              name="format"
              defaultValue={room.format}
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-1 focus:border-blue-500 focus:outline-none"
            >
              <option value="BO1">BO1</option>
              <option value="BO3">BO3</option>
              <option value="BO5">BO5</option>
            </select>
          </div>
          <div>
            <label className="block text-neutral-400 mb-0.5" htmlFor="mode">
              Teams
            </label>
            <select
              id="mode"
              name="mode"
              defaultValue={room.mode}
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-1 focus:border-blue-500 focus:outline-none"
            >
              <option value="SELF_SELECT">Self-select</option>
              <option value="CAPTAIN_DRAFT">Draft</option>
            </select>
          </div>
        </div>

        <fieldset>
          <legend className="block text-neutral-400 mb-1">Map pool</legend>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {AVAILABLE_MAPS.map((map) => (
              <label key={map.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name="mapPool"
                  value={map.id}
                  defaultChecked={mapPool.includes(map.id)}
                  className="accent-blue-500"
                />
                {map.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="knifeRound" defaultChecked={room.knifeRound} className="accent-blue-500" />
            Knife
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="overtimeEnabled"
              defaultChecked={room.overtimeEnabled}
              className="accent-blue-500"
            />
            OT
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-neutral-400 mb-0.5" htmlFor="minPlayersToStart">
              Min
            </label>
            <input
              id="minPlayersToStart"
              name="minPlayersToStart"
              type="number"
              defaultValue={room.minPlayersToStart}
              min={2}
              max={20}
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-1 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-neutral-400 mb-0.5" htmlFor="playersPerTeam">
              /Team
            </label>
            <input
              id="playersPerTeam"
              name="playersPerTeam"
              type="number"
              defaultValue={room.playersPerTeam}
              min={1}
              max={10}
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-1 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-neutral-400 mb-0.5" htmlFor="coachesPerTeam">
              Coach
            </label>
            <input
              id="coachesPerTeam"
              name="coachesPerTeam"
              type="number"
              defaultValue={room.coachesPerTeam}
              min={0}
              max={2}
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-1 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <label className="flex items-start gap-1.5" title="Spawns bots mapped to the configured players and auto-plays the match — for testing the pipeline without real players connected.">
          <input
            type="checkbox"
            name="simulation"
            defaultChecked={room.simulation}
            className="accent-blue-500 mt-0.5"
          />
          <span>
            Test mode <span className="text-neutral-500">(simulate with bots)</span>
          </span>
        </label>

        <button className="w-full rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-white font-medium transition-colors">
          Save settings
        </button>
      </form>
    </section>
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
}: {
  pool: PlayerRow[];
  currentUserId: string;
  canHost: boolean;
  isDraft: boolean;
  hasCaptainA: boolean;
  hasCaptainB: boolean;
}) {
  return (
    <>
      <h3 className="text-xs font-medium text-neutral-400 mb-2">
        Waiting pool{pool.length > 0 ? ` (${pool.length})` : ""}
      </h3>
      <ul className="space-y-2">
        {pool.map((p) => (
          <li key={p.id}>
            <span className="flex items-center gap-1.5 min-w-0">
              {p.user.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.user.avatarUrl} alt="" className="w-4 h-4 rounded-full shrink-0" />
              )}
              <span className="truncate">
                {p.user.name}
                {p.userId === currentUserId && <span className="text-neutral-500"> (you)</span>}
              </span>
            </span>
            {canHost && isDraft && (
              <span className="flex flex-wrap gap-1 mt-1">
                {!hasCaptainA && (
                  <HostButton action={assignCaptain} roomPlayerId={p.id} extra={{ team: "A" }}>
                    Cap A
                  </HostButton>
                )}
                {!hasCaptainB && (
                  <HostButton action={assignCaptain} roomPlayerId={p.id} extra={{ team: "B" }}>
                    Cap B
                  </HostButton>
                )}
                <HostButton action={assignCoach} roomPlayerId={p.id} extra={{ team: "A" }}>
                  Coach A
                </HostButton>
                <HostButton action={assignCoach} roomPlayerId={p.id} extra={{ team: "B" }}>
                  Coach B
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
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  roomPlayerId: string;
  extra?: Record<string, string>;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="roomPlayerId" value={roomPlayerId} />
      {extra &&
        Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button className="text-xs rounded-lg border border-neutral-700 px-2 py-1 hover:border-blue-500">
        {children}
      </button>
    </form>
  );
}

function TeamPanel({
  team,
  name,
  readyCount,
  totalCount,
  players,
  coach,
  pool,
  currentUserId,
  myTeam,
  isHost,
  canRenameTeam,
  canSwitchTeams,
  isDraft,
}: {
  team: "A" | "B";
  name: string;
  readyCount: number;
  totalCount: number;
  players: PlayerRow[];
  coach: PlayerRow | undefined;
  pool: PlayerRow[];
  currentUserId: string;
  myTeam: string;
  isHost: boolean;
  canRenameTeam: boolean;
  canSwitchTeams: boolean;
  isDraft: boolean;
}) {
  const onThisTeam = myTeam === team;
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
        {players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              {p.user.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.user.avatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0" />
              )}
              <span className={p.isReady ? "text-emerald-400 shrink-0" : "text-neutral-500 shrink-0"}>●</span>
              <span className="truncate">
                {p.isCaptain && "⭐ "}
                {p.user.name}
                {p.userId === currentUserId && <span className="text-neutral-500"> (you)</span>}
              </span>
            </span>
            {isHost && (
              <span className="flex items-center gap-1 shrink-0">
                {!isDraft && (
                  <form action={toggleCaptain}>
                    <input type="hidden" name="roomPlayerId" value={p.id} />
                    <button
                      title={p.isCaptain ? "Unmake captain" : "Make captain"}
                      className={`w-6 h-6 flex items-center justify-center rounded-md border transition-colors ${
                        p.isCaptain
                          ? "border-yellow-600 text-yellow-400 hover:border-yellow-500"
                          : "border-neutral-700 text-neutral-500 hover:border-yellow-600 hover:text-yellow-400"
                      }`}
                    >
                      {p.isCaptain ? "★" : "☆"}
                    </button>
                  </form>
                )}
                <form action={unassignPlayer}>
                  <input type="hidden" name="roomPlayerId" value={p.id} />
                  <button
                    title="Bench"
                    className="w-6 h-6 flex items-center justify-center rounded-md border border-red-900 text-red-400 hover:border-red-600 hover:text-red-300 transition-colors"
                  >
                    ✕
                  </button>
                </form>
              </span>
            )}
          </li>
        ))}
        {players.length === 0 && <li className="text-sm text-neutral-600">Nobody here yet</li>}
      </ul>

      <div className="pt-2 border-t border-neutral-800">
        <p className="text-xs text-neutral-500 mb-1">Coach</p>
        {coach ? (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              {coach.user.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coach.user.avatarUrl} alt="" className="w-5 h-5 rounded-full" />
              )}
              {coach.user.name}
            </span>
            {isHost && (
              <HostButton action={toggleCoach} roomPlayerId={coach.id}>
                remove
              </HostButton>
            )}
          </div>
        ) : (
          <p className="text-sm text-neutral-600">
            None{isHost && pool.length > 0 ? " — assign from the waiting pool below" : ""}
          </p>
        )}
      </div>

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
