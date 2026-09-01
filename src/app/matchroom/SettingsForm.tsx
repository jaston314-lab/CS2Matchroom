"use client";

import { useEffect, useRef, useState } from "react";
import { AVAILABLE_MAPS } from "@/lib/maps";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/roomDefaults";
import { updateSettingsAction, resetSettingsAction, type UpdateSettingsInput } from "./actions";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Every field here is controlled by local state seeded once from the
 * initial props, not re-synced on every prop update. That's deliberate:
 * this page polls itself every few seconds (see AutoRefresh), and with
 * plain defaultValue inputs a poll landing mid-edit could visibly revert
 * a selection you'd just made before your own save round-tripped back.
 * The trade-off is this form won't live-reflect another host's
 * concurrent edits — acceptable for a small crew, and far better than
 * your own picks silently reverting.
 *
 * Saving itself used to fire a native form submission on every single
 * change (a dropdown pick, each checkbox click). That's what caused the
 * "flickers a few times then settles" / "needs a couple of clicks" bug:
 * rapid edits fired multiple overlapping requests to updateSettingsAction
 * with no guarantee they'd land at the DB in the order they were sent —
 * an earlier click's slightly-slower request completing *after* a later
 * one would silently overwrite it, undoing the later edit until you
 * clicked again. The fix is the save queue below: debounce rapid edits
 * into one save, and never let two saves be in flight at once — if a
 * change comes in while a save is running, it's queued to run right
 * after, using whatever the state is *then*, not two racing requests.
 */
export function SettingsForm({
  room,
  mapPool,
  isAdmin,
}: {
  room: {
    label: string;
    format: string;
    mode: string;
    knifeRound: boolean;
    overtimeEnabled: boolean;
    simulation: boolean;
  };
  mapPool: string[];
  isAdmin: boolean;
}) {
  const [label, setLabel] = useState(room.label);
  const [format, setFormat] = useState(room.format);
  const [mode, setMode] = useState(room.mode);
  const [pool, setPool] = useState<string[]>(mapPool);
  const [knifeRound, setKnifeRound] = useState(room.knifeRound);
  const [overtimeEnabled, setOvertimeEnabled] = useState(room.overtimeEnabled);
  const [simulation, setSimulation] = useState(room.simulation);

  // Always holds the latest values, updated in an effect after every
  // render — so the save queue below never reads a stale closure, however
  // it's triggered. (Not written during render itself: refs are for
  // event handlers/effects, not render — see the React docs on useRef.)
  const latestRef = useRef<UpdateSettingsInput>(null!);
  useEffect(() => {
    latestRef.current = {
      label,
      format,
      mode,
      mapPool: pool,
      knifeRound,
      overtimeEnabled,
      simulation: isAdmin ? simulation : undefined,
    };
  });

  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function flush() {
    if (savingRef.current) {
      // A save is already in flight — don't start a second, overlapping
      // one. Just remember to run again (with whatever's latest by then)
      // once this one finishes.
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      await updateSettingsAction(latestRef.current);
    } catch (err) {
      console.error("Failed to save match settings:", err);
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void flush();
      }
    }
  }

  function scheduleSave() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  async function handleReset() {
    if (!window.confirm("Reset match settings back to the defaults?")) return;
    setLabel(DEFAULT_ROOM_SETTINGS.label);
    setFormat(DEFAULT_ROOM_SETTINGS.format);
    setMode(DEFAULT_ROOM_SETTINGS.mode);
    setPool(DEFAULT_ROOM_SETTINGS.mapPool);
    setKnifeRound(DEFAULT_ROOM_SETTINGS.knifeRound);
    setOvertimeEnabled(DEFAULT_ROOM_SETTINGS.overtimeEnabled);
    setSimulation(DEFAULT_ROOM_SETTINGS.simulation);
    // Cancel any pending debounced save of the old values — the reset
    // action below is the actual write, and it's already the *only*
    // request in flight since resetSettingsAction goes straight through,
    // not via the queue.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    try {
      await resetSettingsAction();
    } catch (err) {
      console.error("Failed to reset match settings:", err);
    }
  }

  return (
    <section className="rounded-xl border border-blue-800/60 bg-blue-950/10 p-3 space-y-3 text-xs text-center">
      <h2 className="text-xs font-semibold text-neutral-200">Match settings</h2>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
        <div>
          <label className="block text-neutral-400 mb-0.5" htmlFor="label">
            Match name
          </label>
          <input
            id="label"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={scheduleSave}
            className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1 text-center focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-neutral-400 mb-0.5" htmlFor="format">
              Format
            </label>
            <select
              id="format"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                scheduleSave();
              }}
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-1 text-center focus:border-blue-500 focus:outline-none"
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
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                scheduleSave();
              }}
              className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-1.5 py-1 text-center focus:border-blue-500 focus:outline-none"
            >
              <option value="SELF_SELECT">Self-select</option>
              <option value="CAPTAIN_DRAFT">Draft</option>
            </select>
          </div>
        </div>

        <fieldset className="text-center">
          <legend className="text-neutral-400 mb-1 mx-auto">Map pool</legend>
          {/* inline-grid + display:contents labels: the name and its
              checkbox both sit directly in the grid, so every checkbox
              lands in the same column (aligned) no matter how long the
              map name next to it is — the whole grid is then centered as
              one block via text-center on the fieldset above. */}
          <div className="inline-grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-0.5">
            {AVAILABLE_MAPS.map((map) => (
              <label key={map.id} className="contents cursor-pointer">
                <span className="text-right">{map.label}</span>
                <input
                  type="checkbox"
                  checked={pool.includes(map.id)}
                  onChange={(e) => {
                    setPool((prev) =>
                      e.target.checked ? [...prev, map.id] : prev.filter((id) => id !== map.id),
                    );
                    scheduleSave();
                  }}
                  className="accent-blue-500 justify-self-start"
                />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center justify-center gap-4">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={knifeRound}
              onChange={(e) => {
                setKnifeRound(e.target.checked);
                scheduleSave();
              }}
              className="accent-blue-500"
            />
            Knife
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={overtimeEnabled}
              onChange={(e) => {
                setOvertimeEnabled(e.target.checked);
                scheduleSave();
              }}
              className="accent-blue-500"
            />
            OT
          </label>
        </div>

        {isAdmin && (
          <label
            className="flex items-start justify-center gap-1.5"
            title="Spawns bots mapped to the configured players and auto-plays the match — for testing the pipeline without real players connected."
          >
            <input
              type="checkbox"
              checked={simulation}
              onChange={(e) => {
                setSimulation(e.target.checked);
                scheduleSave();
              }}
              className="accent-blue-500 mt-0.5"
            />
            <span>
              Test mode <span className="text-neutral-500">(simulate with bots)</span>
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={handleReset}
          className="w-full rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-300 font-medium hover:border-red-700 hover:text-red-300 transition-colors"
        >
          Reset settings
        </button>
      </form>
    </section>
  );
}
