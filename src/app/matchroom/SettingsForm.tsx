"use client";

import { useState, type ChangeEvent, type FocusEvent, type MouseEvent } from "react";
import { AVAILABLE_MAPS } from "@/lib/maps";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/roomDefaults";
import { updateSettingsAction, resetSettingsAction } from "./actions";

/**
 * Every field here is controlled by local state seeded once from the
 * initial props, not re-synced on every prop update. That's deliberate:
 * this page polls itself every few seconds (see AutoRefresh), and with
 * plain defaultValue inputs a poll landing mid-edit could visibly revert
 * a selection you'd just made before your own save round-tripped back.
 * The trade-off is this form won't live-reflect another host's
 * concurrent edits — acceptable for a small crew, and far better than
 * your own picks silently reverting.
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

  function submitSoon(e: ChangeEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    // Fires after the state update above has been applied to the DOM
    // control, so the form reads the value that was just picked.
    (e.currentTarget as HTMLInputElement).form?.requestSubmit();
  }

  function handleResetClick(e: MouseEvent<HTMLButtonElement>) {
    if (!window.confirm("Reset match settings back to the defaults?")) {
      e.preventDefault();
      return;
    }
    setLabel(DEFAULT_ROOM_SETTINGS.label);
    setFormat(DEFAULT_ROOM_SETTINGS.format);
    setMode(DEFAULT_ROOM_SETTINGS.mode);
    setPool(DEFAULT_ROOM_SETTINGS.mapPool);
    setKnifeRound(DEFAULT_ROOM_SETTINGS.knifeRound);
    setOvertimeEnabled(DEFAULT_ROOM_SETTINGS.overtimeEnabled);
    setSimulation(DEFAULT_ROOM_SETTINGS.simulation);
    // The button's own formAction={resetSettingsAction} still submits
    // normally after this — this just makes the UI update optimistically
    // instead of waiting on the round trip.
  }

  return (
    <section className="rounded-xl border border-blue-800/60 bg-blue-950/10 p-3 space-y-3 text-xs text-center">
      <h2 className="text-xs font-semibold text-neutral-200">Match settings</h2>
      <form action={updateSettingsAction} className="space-y-3">
        {/* Lets the action tell "admin unchecked test mode" apart from
            "a host saved some other field and can't even see this one" —
            HTML omits unchecked checkboxes from the submission either way. */}
        <input type="hidden" name="canSetSimulation" value={isAdmin ? "1" : "0"} />
        <div>
          <label className="block text-neutral-400 mb-0.5" htmlFor="label">
            Match name
          </label>
          <input
            id="label"
            name="label"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={submitSoon}
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
              name="format"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value);
                submitSoon(e);
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
              name="mode"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                submitSoon(e);
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
                  name="mapPool"
                  value={map.id}
                  checked={pool.includes(map.id)}
                  onChange={(e) => {
                    setPool((prev) =>
                      e.target.checked ? [...prev, map.id] : prev.filter((id) => id !== map.id),
                    );
                    submitSoon(e);
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
              name="knifeRound"
              checked={knifeRound}
              onChange={(e) => {
                setKnifeRound(e.target.checked);
                submitSoon(e);
              }}
              className="accent-blue-500"
            />
            Knife
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="overtimeEnabled"
              checked={overtimeEnabled}
              onChange={(e) => {
                setOvertimeEnabled(e.target.checked);
                submitSoon(e);
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
              name="simulation"
              checked={simulation}
              onChange={(e) => {
                setSimulation(e.target.checked);
                submitSoon(e);
              }}
              className="accent-blue-500 mt-0.5"
            />
            <span>
              Test mode <span className="text-neutral-500">(simulate with bots)</span>
            </span>
          </label>
        )}

        <button
          type="submit"
          formAction={resetSettingsAction}
          onClick={handleResetClick}
          className="w-full rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-300 font-medium hover:border-red-700 hover:text-red-300 transition-colors"
        >
          Reset settings
        </button>
      </form>
    </section>
  );
}
