import { mapLabel } from "@/lib/maps";

interface MatchSnapshot {
  status: string;
  currentMap: string | null;
  currentMapIndex: number;
  team1Score: number;
  team2Score: number;
  connectedPlayers: string[];
}

/**
 * Pure presentation — freshness comes from the whole dashboard page
 * re-rendering via <AutoRefresh>, not from any fetching of its own.
 */
export function RoomLive({
  match,
  players,
}: {
  match: MatchSnapshot;
  players: { steamId64: string; name: string }[];
}) {
  const nameFor = (steamId64: string) =>
    players.find((p) => p.steamId64 === steamId64)?.name ?? steamId64;

  return (
    <section className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Live — {match.status}</h2>
        {match.currentMap && (
          <span className="text-sm text-neutral-300">
            Map {match.currentMapIndex + 1}: {mapLabel(match.currentMap)}
          </span>
        )}
      </div>
      <div className="text-3xl font-semibold tabular-nums">
        {match.team1Score} – {match.team2Score}
      </div>
      <div>
        <p className="text-sm text-neutral-400 mb-1">
          Connected: {match.connectedPlayers.length}
        </p>
        <p className="text-xs text-neutral-500">
          {match.connectedPlayers.map(nameFor).join(", ") || "Nobody connected yet"}
        </p>
      </div>
    </section>
  );
}
