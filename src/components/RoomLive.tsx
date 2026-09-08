import { mapLabel } from "@/lib/maps";
import { CopyButton } from "@/components/CopyButton";

interface MatchSnapshot {
  status: string;
  currentMap: string | null;
  currentMapIndex: number;
  team1Score: number;
  team2Score: number;
  connectedPlayers: string[];
}

const STATUS_LABEL: Record<string, string> = {
  LOADING: "Loading",
  WARMUP: "Warmup",
  KNIFE: "Knife round",
  LIVE: "Live",
  PAUSED: "Paused",
};

/**
 * Pure presentation — freshness comes from the whole matchroom page
 * re-rendering via <AutoRefresh>, not from any fetching of its own.
 */
export function RoomLive({
  match,
  teamAName,
  teamBName,
  players,
  connectAddress,
}: {
  match: MatchSnapshot;
  teamAName: string;
  teamBName: string;
  players: { steamId64: string; name: string }[];
  connectAddress?: string | null;
}) {
  const nameFor = (steamId64: string) =>
    players.find((p) => p.steamId64 === steamId64)?.name ?? steamId64;

  return (
    <div className="panel p-4 space-y-3 text-center">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full bg-blue-900/60 text-blue-300 text-xs font-medium px-2.5 py-0.5">
          {STATUS_LABEL[match.status] ?? match.status}
        </span>
        {match.currentMap && (
          <span className="text-sm text-muted">
            Map {match.currentMapIndex + 1}: {mapLabel(match.currentMap)}
          </span>
        )}
      </div>

      {connectAddress ? (
        <div className="flex items-center justify-center gap-2">
          <code className="rounded-md bg-input border border-line px-2.5 py-1 text-xs text-ink">
            connect {connectAddress}
          </code>
          <CopyButton text={`connect ${connectAddress}`} label="Copy" />
        </div>
      ) : (
        <p className="text-xs text-muted">
          No connect address set — ask an admin to add one on the server config page.
        </p>
      )}

      <div className="flex items-center justify-center gap-4 sm:gap-6">
        <span className="text-sm font-medium text-ink w-20 sm:w-24 truncate text-right">{teamAName}</span>
        <span className="text-4xl font-bold tabular-nums shrink-0 text-white">
          {match.team1Score} – {match.team2Score}
        </span>
        <span className="text-sm font-medium text-ink w-20 sm:w-24 truncate text-left">{teamBName}</span>
      </div>

      <div>
        <p className="text-xs text-muted mb-1.5">Connected ({match.connectedPlayers.length})</p>
        {match.connectedPlayers.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-1.5">
            {match.connectedPlayers.map((steamId64) => (
              <span
                key={steamId64}
                className="inline-flex items-center gap-1 rounded border border-line bg-input px-1.5 py-0.5 text-xs text-ink"
              >
                <span className="text-emerald-400">●</span>
                {nameFor(steamId64)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Nobody connected yet</p>
        )}
      </div>
    </div>
  );
}
