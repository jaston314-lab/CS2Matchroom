import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mapsRequiredForFormat, type Format, type VetoStep } from "@/lib/types";
import { AVAILABLE_MAPS, mapLabel } from "@/lib/maps";
import { RoomLive } from "@/components/RoomLive";
import {
  joinRoom,
  leaveRoom,
  setTeam,
  setReady,
  toggleCaptain,
  scrambleTeams,
  balanceTeamsAction,
  startVetoAction,
  banMapAction,
  overrideMapsAction,
  startMatchAction,
  cancelRoomAction,
} from "./actions";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireUser();

  const room = await db.room.findUnique({
    where: { code },
    include: {
      host: true,
      players: { include: { user: true }, orderBy: { joinedAt: "asc" } },
      veto: true,
      match: true,
    },
  });
  if (!room) notFound();

  const isHost = room.hostUserId === user.id || user.role === "ADMIN";
  const myPlayer = room.players.find((p) => p.userId === user.id);
  const isActive = room.status !== "COMPLETED" && room.status !== "CANCELLED";
  const isLive = room.status === "LIVE";

  const mapPool = JSON.parse(room.mapPool) as string[];
  const format = room.format as Format;
  const requiredMaps = mapsRequiredForFormat(format);

  const vetoSteps = room.veto ? (JSON.parse(room.veto.steps) as VetoStep[]) : [];
  const finalMapList = room.veto?.finalMapList ? (JSON.parse(room.veto.finalMapList) as string[]) : null;
  const vetoInProgress = room.veto?.status === "IN_PROGRESS";
  const remainingPool = mapPool.filter((m) => !vetoSteps.some((s) => s.map === m));
  const nextVetoTeam: "A" | "B" = vetoSteps.length % 2 === 0 ? "A" : "B";

  const teamA = room.players.filter((p) => p.team === "A");
  const teamB = room.players.filter((p) => p.team === "B");
  const unassigned = room.players.filter((p) => p.team === "UNASSIGNED");
  const readyA = teamA.filter((p) => p.isReady).length;
  const readyB = teamB.filter((p) => p.isReady).length;
  const canStart = !!finalMapList && readyA >= room.playersPerTeam && readyB >= room.playersPerTeam;
  const canBanNow =
    isHost || (myPlayer?.isCaptain && myPlayer.team === nextVetoTeam);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{room.label}</h1>
          <p className="text-sm text-neutral-400">
            Hosted by {room.host.name} · Code{" "}
            <span className="font-mono tracking-widest text-neutral-200">{room.code}</span> ·{" "}
            {room.status}
          </p>
        </div>
        {!myPlayer && isActive && (
          <form action={joinRoom}>
            <input type="hidden" name="code" value={code} />
            <button className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium">
              Join room
            </button>
          </form>
        )}
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Format" value={format} />
        <Stat label="Knife round" value={room.knifeRound ? "On" : "Off"} />
        <Stat label="Overtime" value={room.overtimeEnabled ? "On" : "Off"} />
        <Stat label="Players/team" value={String(room.playersPerTeam)} />
        <div className="col-span-2 sm:col-span-4">
          <p className="text-neutral-400 mb-1">Map pool</p>
          <p>{mapPool.map(mapLabel).join(", ")}</p>
        </div>
      </section>

      <RoomLive
        code={room.code}
        initialRoomStatus={room.status}
        initialMatch={
          room.match
            ? {
                status: room.match.status,
                currentMap: room.match.currentMap,
                currentMapIndex: room.match.currentMapIndex,
                team1Score: room.match.team1Score,
                team2Score: room.match.team2Score,
                connectedPlayers: JSON.parse(room.match.connectedPlayers) as string[],
              }
            : null
        }
        players={room.players.map((p) => ({ steamId64: p.user.steamId64, name: p.user.name }))}
      />

      {!isLive && (
        <div className="grid sm:grid-cols-2 gap-4">
          <TeamPanel
            title={`Team A (${readyA}/${teamA.length} ready)`}
            code={code}
            players={teamA}
            currentUserId={user.id}
            isHost={isHost}
          />
          <TeamPanel
            title={`Team B (${readyB}/${teamB.length} ready)`}
            code={code}
            players={teamB}
            currentUserId={user.id}
            isHost={isHost}
          />
        </div>
      )}

      {!isLive && unassigned.length > 0 && (
        <TeamPanel title="Unassigned" code={code} players={unassigned} currentUserId={user.id} isHost={isHost} />
      )}

      {myPlayer && isActive && !isLive && (
        <div className="flex flex-wrap gap-3">
          {(["A", "B", "UNASSIGNED"] as const)
            .filter((t) => t !== myPlayer.team)
            .map((t) => (
              <form key={t} action={setTeam}>
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="team" value={t} />
                <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500">
                  Switch to {t === "UNASSIGNED" ? "Unassigned" : `Team ${t}`}
                </button>
              </form>
            ))}
          <form action={setReady}>
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="ready" value={(!myPlayer.isReady).toString()} />
            <button className="rounded bg-green-700 hover:bg-green-600 px-3 py-1.5 text-sm text-white">
              {myPlayer.isReady ? "Unready" : "Ready up"}
            </button>
          </form>
          <form action={leaveRoom}>
            <input type="hidden" name="code" value={code} />
            <button className="rounded border border-red-900 text-red-300 px-3 py-1.5 text-sm hover:border-red-700">
              Leave room
            </button>
          </form>
        </div>
      )}

      {isHost && isActive && !isLive && (
        <section className="space-y-6 rounded border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-lg font-medium">Host controls</h2>

          <div className="flex flex-wrap gap-3">
            <form action={scrambleTeams}>
              <input type="hidden" name="code" value={code} />
              <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500">
                Scramble teams
              </button>
            </form>
            <form action={balanceTeamsAction}>
              <input type="hidden" name="code" value={code} />
              <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500">
                Balance by rating
              </button>
            </form>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-300">Maps</h3>

            {finalMapList && (
              <p className="text-sm">
                Resolved: {finalMapList.map(mapLabel).join(" → ")}
                {room.veto?.overriddenByHost && (
                  <span className="text-neutral-500"> (host override)</span>
                )}
              </p>
            )}

            {!room.veto && (
              <form action={startVetoAction}>
                <input type="hidden" name="code" value={code} />
                <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500">
                  Start map veto
                </button>
              </form>
            )}

            {vetoInProgress && (
              <div className="space-y-2">
                <p className="text-sm text-neutral-400">
                  Team {nextVetoTeam}&apos;s turn to ban
                  {!canBanNow && " — waiting on their captain (or the host)"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {remainingPool.map((m) => (
                    <form key={m} action={banMapAction}>
                      <input type="hidden" name="code" value={code} />
                      <input type="hidden" name="map" value={m} />
                      <button
                        disabled={!canBanNow}
                        className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500 disabled:opacity-40 disabled:hover:border-neutral-700"
                      >
                        Ban {mapLabel(m)}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            )}

            <details className="text-sm">
              <summary className="cursor-pointer text-neutral-400">Override maps manually</summary>
              <form action={overrideMapsAction} className="mt-2 space-y-2">
                <input type="hidden" name="code" value={code} />
                {Array.from({ length: requiredMaps }, (_, i) => (
                  <select
                    key={i}
                    name={`map_${i}`}
                    defaultValue=""
                    className="w-full rounded bg-neutral-950 border border-neutral-700 px-2 py-1.5"
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
                <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500">
                  Set maps
                </button>
              </form>
            </details>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-neutral-800">
            <form action={startMatchAction}>
              <input type="hidden" name="code" value={code} />
              <button
                disabled={!canStart}
                className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium disabled:opacity-40 disabled:hover:bg-blue-600"
              >
                Start match
              </button>
            </form>
            {!canStart && (
              <p className="text-xs text-neutral-500">
                Needs {room.playersPerTeam} ready players per team and a resolved map list.
              </p>
            )}
          </div>
        </section>
      )}

      {isHost && isActive && (
        <form action={cancelRoomAction}>
          <input type="hidden" name="code" value={code} />
          <button className="rounded border border-red-900 text-red-300 px-3 py-1.5 text-sm hover:border-red-700">
            Cancel room
          </button>
        </form>
      )}
    </div>
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

function TeamPanel({
  title,
  code,
  players,
  currentUserId,
  isHost,
}: {
  title: string;
  code: string;
  players: { id: string; userId: string; isCaptain: boolean; isReady: boolean; user: { name: string; avatarUrl: string | null } }[];
  currentUserId: string;
  isHost: boolean;
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="text-sm font-medium text-neutral-300 mb-2">{title}</h3>
      <ul className="space-y-1.5">
        {players.map((p) => (
          <li key={p.id} className="flex items-center justify-between text-sm">
            <span>
              <span className={p.isReady ? "text-green-400" : "text-neutral-500"}>●</span>{" "}
              {p.isCaptain && "⭐ "}
              {p.user.name}
              {p.userId === currentUserId && <span className="text-neutral-500"> (you)</span>}
            </span>
            {isHost && (
              <form action={toggleCaptain}>
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="roomPlayerId" value={p.id} />
                <button className="text-xs text-neutral-500 hover:text-neutral-300">
                  {p.isCaptain ? "unmake captain" : "make captain"}
                </button>
              </form>
            )}
          </li>
        ))}
        {players.length === 0 && <li className="text-sm text-neutral-600">Nobody here yet</li>}
      </ul>
    </div>
  );
}
