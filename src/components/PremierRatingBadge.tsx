import { getPremierBracket } from "@/lib/premierRank";

/** Small colored pill mimicking CS2's in-game Premier rank display —
 * the number's background/color shifts by bracket, same thresholds the
 * game uses (gray/light blue/blue/purple/pink/red/gold). */
export function PremierRatingBadge({ rating }: { rating: number }) {
  const bracket = getPremierBracket(rating);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums shadow-sm"
      style={{ backgroundColor: bracket.bg, color: bracket.text }}
      title={bracket.name}
    >
      <svg width="8" height="11" viewBox="0 0 8 11" className="shrink-0" aria-hidden="true">
        <rect x="0" y="0" width="2.5" height="11" transform="skewX(-14)" fill="currentColor" opacity="0.85" />
        <rect x="4.5" y="0" width="2.5" height="11" transform="skewX(-14)" fill="currentColor" opacity="0.85" />
      </svg>
      {rating.toLocaleString()}
    </span>
  );
}
