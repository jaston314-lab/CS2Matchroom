import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelRoomAction } from "@/app/room/[code]/actions";

export default async function AdminRoomsPage() {
  await requireRole(["ADMIN"]);
  const rooms = await db.room.findMany({
    include: { host: true, _count: { select: { players: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">All rooms</h1>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="text-left px-4 py-2">Room</th>
              <th className="text-left px-4 py-2">Host</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Players</th>
              <th className="text-left px-4 py-2">Created</th>
              <th className="text-left px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {rooms.map((room) => (
              <tr key={room.id}>
                <td className="px-4 py-2">
                  <Link href={`/room/${room.code}`} className="hover:underline">
                    {room.label} <span className="text-neutral-500 font-mono text-xs">{room.code}</span>
                  </Link>
                </td>
                <td className="px-4 py-2">{room.host.name}</td>
                <td className="px-4 py-2">{room.status}</td>
                <td className="px-4 py-2">{room._count.players}</td>
                <td className="px-4 py-2 text-neutral-400">{room.createdAt.toLocaleString()}</td>
                <td className="px-4 py-2">
                  {room.status !== "COMPLETED" && room.status !== "CANCELLED" && (
                    <form action={cancelRoomAction}>
                      <input type="hidden" name="code" value={room.code} />
                      <button className="text-xs rounded border border-red-900 text-red-300 px-2 py-1 hover:border-red-700">
                        Force-cancel
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rooms.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                  No rooms yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
