"use client";

import { useEffect, useRef, useState } from "react";
import { AVAILABLE_MAPS } from "@/lib/maps";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/roomDefaults";
import {
  updateSettingsAction,
  resetSettingsAction,
  setReady,
  leaveLobby,
  readyUpAllAction,
  fillTestBotsAction,
  clearTestBotsAction,
  scrambleTeams,
  balanceTeamsAction,
  resetTeamsAction,
  toggleTeamsLockedAction,
  startVetoAction,
  startDraftAction,
  type UpdateSettingsInput,
} from "./actions";

const SAVE_DEBOUNCE_MS = 400;
const ALL_MAP_IDS = AVAILABLE_MAPS.map((m) => m.id);

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
  isDraft,
  teamsLocked,
  hasAnyAssigned,
  myPlayer,
  canStart,
  showStartDraft,
  canStartDraftNow,
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
  isDraft: boolean;
  teamsLocked: boolean;
  hasAnyAssigned: boolean;
  myPlayer: { isReady: boolean } | null;
  canStart: boolean;
  /** Draft mode chosen and no draft record yet — the one-time trigger to
   * kick it off belongs here in Controls, not a separate banner. */
  showStartDraft: boolean;
  /** Both teams have a captain — startDraftAction itself enforces this,
   * but disabling the button (with an explanatory title) up front avoids
   * bouncing the whole page into the error boundary over a state a host
   * can just as easily fix by assigning captains first. */
  canStartDraftNow: boolean;
}) {
  const [label, setLabel] = useState(room.label);
  const [format, setFormat] = useState(room.format);
  const [mode, setMode] = useState(room.mode);
  // The old free-pick 10-tag map pool collapses to one choice: run the full
  // competitive pool through veto, or skip veto and lock in a single map.
  // A single-map pool from an earlier session is what tells us to open in
  // "select" mode; anything else (including the all-maps default) is veto.
  const [mapMode, setMapMode] = useState<"veto" | "select">(mapPool.length === 1 ? "select" : "veto");
  const [selectedMap, setSelectedMap] = useState<string>(
    mapPool.length === 1 ? mapPool[0] : (mapPool[0] ?? ALL_MAP_IDS[0]),
  );
  const [knifeRound, setKnifeRound] = useState(room.knifeRound);
  const [overtimeEnabled, setOvertimeEnabled] = useState(room.overtimeEnabled);
  const [simulation, setSimulation] = useState(room.simulation);
  const [showDebug, setShowDebug] = useState(false);

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
      mapPool: mapMode === "select" ? [selectedMap] : ALL_MAP_IDS,
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

  // One dropdown for the whole map-pool choice: "Veto" or a specific map
  // name, picked directly — no second control appearing underneath once
  // you've chosen, so the row's height never changes. A single map can't
  // satisfy BO3/BO5's ban requirement (updateSettingsAction rejects a pool
  // smaller than the format needs), so picking one pins the format to BO1
  // instead of letting that save silently fail.
  function handleMapPoolChange(value: string) {
    if (value === "veto") {
      setMapMode("veto");
    } else {
      setMapMode("select");
      setSelectedMap(value);
      setFormat("BO1");
    }
    scheduleSave();
  }

  async function handleReset() {
    if (!window.confirm("Reset match settings back to the defaults?")) return;
    setLabel(DEFAULT_ROOM_SETTINGS.label);
    setFormat(DEFAULT_ROOM_SETTINGS.format);
    setMode(DEFAULT_ROOM_SETTINGS.mode);
    setMapMode(DEFAULT_ROOM_SETTINGS.mapPool.length === 1 ? "select" : "veto");
    setSelectedMap(DEFAULT_ROOM_SETTINGS.mapPool[0]);
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

  // Built as a flat list instead of conditional JSX so the grid below can
  // size its column count to however many buttons actually show — a
  // ragged 4-column grid with an empty trailing cell reads as lopsided,
  // not centered.
  const controls: {
    key: string;
    action: (formData: FormData) => Promise<void>;
    label: string;
    disabled?: boolean;
    title?: string;
  }[] = [];
  if (!isDraft) {
    controls.push({ key: "scramble", action: scrambleTeams, label: "Scramble" });
    controls.push({ key: "balance", action: balanceTeamsAction, label: "Balance" });
  }
  if (hasAnyAssigned) {
    controls.push({ key: "reset-teams", action: resetTeamsAction, label: "Reset teams" });
  }
  controls.push({
    key: "lock",
    action: toggleTeamsLockedAction,
    label: teamsLocked ? "Unlock teams" : "Lock teams",
  });
  if (showStartDraft) {
    controls.push({
      key: "start-draft",
      action: startDraftAction,
      label: "Start draft",
      disabled: !canStartDraftNow,
      title: canStartDraftNow ? undefined : "Assign a captain to each team first",
    });
  }

  return (
    <div className="panel p-4 flex flex-col justify-between gap-2">
      <div className="space-y-2">
        <h2 className="text-lg font-bold text-white text-center">Match Settings</h2>
        <form onSubmit={(e) => e.preventDefault()} className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <label className="text-muted shrink-0" htmlFor="label">
              Match name
            </label>
            <input
              id="label"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={scheduleSave}
              className="min-w-0 flex-1 rounded-md bg-input border border-line px-2 py-1 text-ink focus:outline focus:outline-1 focus:outline-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted mb-1 text-center">Format</p>
              <select
                value={format}
                disabled={mapMode === "select"}
                onChange={(e) => {
                  setFormat(e.target.value);
                  scheduleSave();
                }}
                className="w-full rounded-md bg-input border border-line px-2 py-1 text-ink text-center disabled:opacity-50 focus:outline focus:outline-1 focus:outline-blue-500"
              >
                <option value="BO1">BO1</option>
                <option value="BO3">BO3</option>
                <option value="BO5">BO5</option>
              </select>
            </div>
            <div>
              <p className="text-muted mb-1 text-center">Teams</p>
              <select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  scheduleSave();
                }}
                className="w-full rounded-md bg-input border border-line px-2 py-1 text-ink text-center focus:outline focus:outline-1 focus:outline-blue-500"
              >
                <option value="SELF_SELECT">Self-select</option>
                <option value="CAPTAIN_DRAFT">Draft</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ToggleRow
              label="Knife round"
              checked={knifeRound}
              onChange={(v) => {
                setKnifeRound(v);
                scheduleSave();
              }}
            />
            <ToggleRow
              label="Overtime"
              checked={overtimeEnabled}
              onChange={(v) => {
                setOvertimeEnabled(v);
                scheduleSave();
              }}
            />
          </div>

          <div>
            <p className="text-muted mb-1 text-center">Map pool</p>
            <select
              value={mapMode === "select" ? selectedMap : "veto"}
              onChange={(e) => handleMapPoolChange(e.target.value)}
              className="w-full rounded-md bg-input border border-line px-2 py-1 text-ink text-center focus:outline focus:outline-1 focus:outline-blue-500"
            >
              <option value="veto">Veto (full pool)</option>
              {AVAILABLE_MAPS.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.label}
                </option>
              ))}
            </select>
          </div>

        </form>

        <div>
          <div className="flex items-center justify-center gap-3 mb-1.5">
            <p className="text-muted text-xs">Controls</p>
            <button
              type="button"
              onClick={handleReset}
              className="text-[11px] text-muted/70 hover:text-red-300 underline underline-offset-2 transition-colors"
            >
              Reset settings
            </button>
          </div>
          {/* flex-nowrap, not a grid — every button shares the row equally
              and the row can never wrap to a second line, whether there's
              2 of them or 4, so Draft mode's 3 (or 2) buttons line up
              exactly like Self-select's 4 always have. */}
          <div className="flex flex-nowrap gap-1.5">
            {controls.map((c) => (
              <form key={c.key} className="flex-1 min-w-0" action={c.action}>
                <button
                  disabled={c.disabled}
                  title={c.title}
                  className="w-full bg-accent-gray hover:bg-accent-gray-hover disabled:opacity-40 disabled:hover:bg-accent-gray text-white py-1.5 px-1 rounded-md text-[10px] leading-tight transition-colors"
                >
                  {c.label}
                </button>
              </form>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          {myPlayer ? (
            <form action={setReady}>
              <input type="hidden" name="ready" value={(!myPlayer.isReady).toString()} />
              <button className="w-full bg-accent-green hover:bg-accent-green-hover text-white font-bold py-2.5 rounded-lg text-base transition-colors">
                {myPlayer.isReady ? "Unready" : "Ready Up"}
              </button>
            </form>
          ) : (
            <div />
          )}
          <form action={startVetoAction}>
            <button
              disabled={!canStart}
              className="w-full bg-accent-blue hover:bg-accent-blue-hover text-white font-bold py-2.5 rounded-lg text-base transition-colors disabled:opacity-40 disabled:hover:bg-accent-blue"
            >
              Start
            </button>
          </form>
        </div>
        {myPlayer && (
          <form action={leaveLobby}>
            <button className="w-full text-red-300 hover:text-red-200 py-0.5 text-xs transition-colors">
              Leave lobby
            </button>
          </form>
        )}
      </div>

      {/* Admin-only test tooling, out of everyone else's way as a small
          floating trigger instead of living inline in the settings a host
          edits every time. */}
      {isAdmin && (
        <>
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            title="Admin debug tools"
            className="fixed bottom-4 right-4 z-30 w-10 h-10 rounded-full bg-accent-gray hover:bg-accent-gray-hover border border-line text-white flex items-center justify-center shadow-lg transition-colors"
          >
            🔧
          </button>
          {showDebug && (
            <div className="fixed bottom-16 right-4 z-30 w-64 panel p-3 space-y-2 shadow-xl">
              <ToggleRow
                label="Test mode (bots)"
                checked={simulation}
                onChange={(v) => {
                  setSimulation(v);
                  scheduleSave();
                  // Switching this on is the whole point of test mode —
                  // fill empty roster slots with bots right away so there's
                  // actually something on screen to look at, instead of
                  // making you go hunt down the separate fill button too.
                  // Switching back off cleans them back out again, rather
                  // than leaving a room full of bots behind.
                  if (v) {
                    fillTestBotsAction().catch((err) => console.error("Failed to fill test bots:", err));
                  } else {
                    clearTestBotsAction().catch((err) => console.error("Failed to clear test bots:", err));
                  }
                }}
              />
              {simulation && (
                <form action={readyUpAllAction}>
                  <button className="w-full bg-blue-950/50 hover:bg-blue-900/60 text-blue-300 py-2 rounded-md text-xs transition-colors">
                    Fill with bots &amp; ready up
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A label with a real sliding switch to its right — replaces the old
 * On/Off segmented button pair for the two match-rule booleans, which ate
 * a whole row each for what's really a single click. */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-input border border-line px-2.5 py-1">
      <span className="text-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-accent-green" : "bg-panel border border-line"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
  );
}
