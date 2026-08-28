import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { joinRoomByCode } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  LOBBY: "Lobby",
  VETO: "Veto",
  READY: "Ready",
  LIVE: "Live",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export default async function DashboardPage() {
  const user = await requireUser();

  const [hostedRooms, joinedRooms] = await Promise.all([
    db.room.findMany({
      where: { hostUserId: user.id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
    }),
    db.roomPlayer.findMany({
      where: { userId: user.id, room: { status: { notIn: ["COMPLETED", "CANCELLED"] }, hostUserId: { not: user.id } } },
      include: { room: true },
      orderBy: { joinedAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Welcome back, {user.name}</h1>
        <p className="text-neutral-400 text-sm">Role: {user.role}</p>
      </div>

      <section className="max-w-sm">
        <h2 className="text-lg font-medium mb-2">Join a room</h2>
        <form action={joinRoomByCode} className="flex gap-2">
          <input
            name="code"
            placeholder="ROOM CODE"
            required
            maxLength={6}
            className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-3 py-2 uppercase tracking-widest"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium"
          >
            Join
          </button>
        </form>
      </section>

      {hostedRooms.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-2">Rooms you&apos;re hosting</h2>
          <ul className="space-y-2">
            {hostedRooms.map((room) => (
              <RoomRow key={room.id} code={room.code} label={room.label} status={room.status} />
            ))}
          </ul>
        </section>
      )}

      {joinedRooms.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-2">Rooms you&apos;ve joined</h2>
          <ul className="space-y-2">
            {joinedRooms.map(({ room }) => (
              <RoomRow key={room.id} code={room.code} label={room.label} status={room.status} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RoomRow({ code, label, status }: { code: string; label: string; status: string }) {
  return (
    <li>
      <Link
        href={`/room/${code}`}
        className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-4 py-3 hover:border-neutral-600"
      >
        <span>{label}</span>
        <span className="text-xs text-neutral-400">
          {STATUS_LABEL[status] ?? status} · {code}
        </span>
      </Link>
    </li>
  );
}
