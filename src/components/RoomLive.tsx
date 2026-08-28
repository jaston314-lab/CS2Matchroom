"use client";

import { useEffect, useState } from "react";
import { mapLabel } from "@/lib/maps";

interface MatchSnapshot {
  status: string;
  currentMap: string | null;
  currentMapIndex: number;
  team1Score: number;
  team2Score: number;
  connectedPlayers: string[];
}

interface StatusResponse {
  roomStatus: string;
  match: MatchSnapshot | null;
}

export function RoomLive({
  code,
  initialRoomStatus,
  initialMatch,
  players,
}: {
  code: string;
  initialRoomStatus: string;
  initialMatch: MatchSnapshot | null;
  players: { steamId64: string; name: string }[];
}) {
  const [data, setData] = useState<StatusResponse>({
    roomStatus: initialRoomStatus,
    match: initialMatch,
  });

  useEffect(() => {
    if (data.roomStatus !== "LIVE") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${code}/status`, { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch {
        // transient network hiccup — just try again next tick
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [code, data.roomStatus]);

  if (data.roomStatus !== "LIVE" || !data.match) return null;

  const { match } = data;
  const nameFor = (steamId64: string) =>
    players.find((p) => p.steamId64 === steamId64)?.name ?? steamId64;

  return (
    <section className="rounded border border-green-800 bg-green-950/40 p-4 space-y-3">
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
