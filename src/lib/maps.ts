// Common CS2 5v5 competitive maps. This is just the pick-list shown when a
// host configures a room's map pool — it's not tied to Valve's official
// Active Duty rotation, so feel free to trim/extend it later.
export const AVAILABLE_MAPS = [
  { id: "de_dust2", label: "Dust II" },
  { id: "de_mirage", label: "Mirage" },
  { id: "de_inferno", label: "Inferno" },
  { id: "de_nuke", label: "Nuke" },
  { id: "de_overpass", label: "Overpass" },
  { id: "de_ancient", label: "Ancient" },
  { id: "de_anubis", label: "Anubis" },
  { id: "de_train", label: "Train" },
  { id: "de_vertigo", label: "Vertigo" },
] as const;

export function mapLabel(id: string): string {
  return AVAILABLE_MAPS.find((m) => m.id === id)?.label ?? id;
}
