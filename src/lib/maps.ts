// Common CS2 5v5 competitive maps. This is just the pick-list shown when a
// host configures a room's map pool — it's not tied to Valve's official
// Active Duty rotation, so feel free to trim/extend it later.
//
// Thumbnails live in public/maps/ — pulled from
// https://github.com/ghostcap-gaming/cs2-map-images (public domain-style
// community collection, explicitly offered for reuse in CS2 projects) and
// served locally so veto doesn't depend on GitHub being reachable during a
// match.
export const AVAILABLE_MAPS = [
  { id: "de_dust2", label: "Dust II", image: "/maps/de_dust2.png" },
  { id: "de_mirage", label: "Mirage", image: "/maps/de_mirage.png" },
  { id: "de_inferno", label: "Inferno", image: "/maps/de_inferno.png" },
  { id: "de_nuke", label: "Nuke", image: "/maps/de_nuke.png" },
  { id: "de_overpass", label: "Overpass", image: "/maps/de_overpass.png" },
  { id: "de_ancient", label: "Ancient", image: "/maps/de_ancient.png" },
  { id: "de_anubis", label: "Anubis", image: "/maps/de_anubis.png" },
  { id: "de_train", label: "Train", image: "/maps/de_train.png" },
  { id: "de_vertigo", label: "Vertigo", image: "/maps/de_vertigo.png" },
  { id: "de_cache", label: "Cache", image: "/maps/de_cache.png" },
] as const;

export function mapLabel(id: string): string {
  return AVAILABLE_MAPS.find((m) => m.id === id)?.label ?? id;
}

export function mapImage(id: string): string | null {
  return AVAILABLE_MAPS.find((m) => m.id === id)?.image ?? null;
}
