// CS2 Premier rating brackets/colors, matching the in-game rank banding.
// Colors are our own badge design inspired by the same bracket scheme, not
// a reproduction of Valve's rank icon artwork.
export const PREMIER_BRACKETS = [
  { name: "Gray", min: 0, max: 4999, bg: "#6b7280", text: "#f3f4f6" },
  { name: "Light Blue", min: 5000, max: 9999, bg: "#38bdf8", text: "#082f49" },
  { name: "Blue", min: 10000, max: 14999, bg: "#3b5bfd", text: "#eef2ff" },
  { name: "Purple", min: 15000, max: 19999, bg: "#a855f7", text: "#faf5ff" },
  { name: "Pink", min: 20000, max: 24999, bg: "#ec4899", text: "#fdf2f8" },
  { name: "Red", min: 25000, max: 29999, bg: "#ef4444", text: "#fef2f2" },
  { name: "Gold", min: 30000, max: Infinity, bg: "#eab308", text: "#1c1503" },
] as const;

export function getPremierBracket(rating: number) {
  return PREMIER_BRACKETS.find((b) => rating >= b.min && rating <= b.max) ?? PREMIER_BRACKETS[0];
}
