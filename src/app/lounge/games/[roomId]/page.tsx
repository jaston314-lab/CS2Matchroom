import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { mapLabel } from "@/lib/maps";

export default async function GameDetailPage({ params }: { params: Promise<{ roomId: string }> }) {
  await requireUser();
  const { roomId } = await params;

  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      match: { include: { playerStats: { include: { user: true } } } },
    },
  });

  if (!room || !room.match) {
    notFound();
  }

  const { match } = room;

  if (match.playerStats.length === 0) {
    return (
      <div className="space-y-6 text-center">
        <Link href="/lounge?tab=games" className="text-sm text-blue-400 hover:text-blue-300">
          ← Previous games
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{room.label}</h1>
          <p className="text-sm text-muted">
            {match.team1Score}–{match.team2Score} · {room.createdAt.toLocaleDateString()}
          </p>
        </div>
        <p className="text-sm text-muted">
          Player stats aren&apos;t in yet — the server uploads the demo once the map ends, and it can take a
          minute to get parsed. Refresh in a bit.
        </p>
      </div>
    );
  }
  const teamA = match.playerStats.filter((s) => s.team === "A").sort((a, b) => b.damage - a.damage);
  const teamB = match.playerStats.filter((s) => s.team === "B").sort((a, b) => b.damage - a.damage);
  const winnerName = match.winnerTeam === "A" ? room.teamAName : match.winnerTeam === "B" ? room.teamBName : null;

  return (
    <div className="space-y-6">
      <Link href="/lounge?tab=games" className="text-sm text-blue-400 hover:text-blue-300">
        ← Previous games
      </Link>

      <div className="text-center space-y-1">
        <p className="text-xs font-medium tracking-[0.2em] text-blue-500 uppercase">
          {match.currentMap ? mapLabel(match.currentMap) : room.label}
        </p>
        <h1 className="text-2xl font-semibold">{room.label}</h1>
        <p className="text-sm text-muted">
          {winnerName && <span className="text-emerald-400 font-medium">{winnerName} won</span>}
          {winnerName && " · "}
          {match.team1Score}–{match.team2Score} · {room.createdAt.toLocaleDateString()}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamBoxScore name={room.teamAName} rounds={match.team1Score} stats={teamA} isWinner={match.winnerTeam === "A"} />
        <TeamBoxScore name={room.teamBName} rounds={match.team2Score} stats={teamB} isWinner={match.winnerTeam === "B"} />
      </div>

      <p className="text-xs text-muted/70 text-center">
        Stats parsed from the match demo — kills, deaths, assists, MVPs, and damage come straight from
        CS2&apos;s own tracked scoreboard data.
      </p>
    </div>
  );
}

type Stat = {
  id: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  damage: number;
  roundsPlayed: number;
  mvps: number;
  score: number;
  user: { id: string; name: string; avatarUrl: string | null };
};

function TeamBoxScore({
  name,
  rounds,
  stats,
  isWinner,
}: {
  name: string;
  rounds: number;
  stats: Stat[];
  isWinner: boolean;
}) {
  return (
    <section
      className={`rounded-xl border p-4 space-y-3 ${
        isWinner ? "border-emerald-700 bg-emerald-950/10" : "border-line bg-panel"
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold truncate">{name}</h2>
        <span className={`text-lg font-bold tabular-nums ${isWinner ? "text-emerald-400" : "text-muted"}`}>
          {rounds}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium pb-1.5">Player</th>
              <th className="text-right font-medium pb-1.5">K</th>
              <th className="text-right font-medium pb-1.5">D</th>
              <th className="text-right font-medium pb-1.5">A</th>
              <th className="text-right font-medium pb-1.5">ADR</th>
              <th className="text-right font-medium pb-1.5">HS%</th>
              <th className="text-right font-medium pb-1.5">MVP</th>
              <th className="text-right font-medium pb-1.5">Damage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {stats.map((s) => {
              const adr = s.roundsPlayed > 0 ? s.damage / s.roundsPlayed : 0;
              const hsPct = s.kills > 0 ? (s.headshotKills / s.kills) * 100 : 0;
              return (
                <tr key={s.id}>
                  <td className="py-1.5 flex items-center gap-1.5 min-w-0">
                    {s.user.avatarUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.user.avatarUrl} alt="" className="w-5 h-5 rounded-full shrink-0" />
                    )}
                    <span className="truncate">{s.user.name}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-400 font-medium">{s.kills}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-400 font-medium">{s.deaths}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.assists}</td>
                  <td className="py-1.5 text-right tabular-nums">{adr.toFixed(1)}</td>
                  <td className="py-1.5 text-right tabular-nums">{hsPct.toFixed(0)}%</td>
                  <td className="py-1.5 text-right tabular-nums">{s.mvps}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold text-white">{s.damage}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
