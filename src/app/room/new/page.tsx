import { requireRole } from "@/lib/auth";
import { AVAILABLE_MAPS } from "@/lib/maps";
import { createRoom } from "./actions";

export default async function NewRoomPage() {
  await requireRole(["HOST", "ADMIN"]);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">New matchroom</h1>

      <form action={createRoom} className="space-y-5">
        <div>
          <label className="block text-sm text-neutral-300 mb-1" htmlFor="label">
            Room name
          </label>
          <input
            id="label"
            name="label"
            required
            placeholder="Friday night 5v5"
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm text-neutral-300 mb-1" htmlFor="format">
            Format
          </label>
          <select
            id="format"
            name="format"
            defaultValue="BO1"
            className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
          >
            <option value="BO1">Best of 1</option>
            <option value="BO3">Best of 3</option>
            <option value="BO5">Best of 5</option>
          </select>
        </div>

        <fieldset>
          <legend className="block text-sm text-neutral-300 mb-1">Map pool</legend>
          <div className="grid grid-cols-2 gap-2">
            {AVAILABLE_MAPS.map((map) => (
              <label key={map.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="mapPool" value={map.id} defaultChecked className="accent-blue-500" />
                {map.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="knifeRound" defaultChecked className="accent-blue-500" />
            Knife round
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="overtimeEnabled" defaultChecked className="accent-blue-500" />
            Overtime
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-neutral-300 mb-1" htmlFor="minPlayersToStart">
              Min players to start
            </label>
            <input
              id="minPlayersToStart"
              name="minPlayersToStart"
              type="number"
              defaultValue={10}
              min={2}
              max={20}
              className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-300 mb-1" htmlFor="playersPerTeam">
              Players per team
            </label>
            <input
              id="playersPerTeam"
              name="playersPerTeam"
              type="number"
              defaultValue={5}
              min={1}
              max={10}
              className="w-full rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
            />
          </div>
        </div>

        <button
          type="submit"
          className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium"
        >
          Create room
        </button>
      </form>
    </div>
  );
}
