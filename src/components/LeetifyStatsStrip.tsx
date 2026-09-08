import type { LeetifyMatchStats } from "@/lib/leetifyStats";

function tooltipFor(stats: LeetifyMatchStats): string {
  const swing = `${stats.swingPct >= 0 ? "+" : ""}${stats.swingPct.toFixed(2)}%`;
  return (
    `Last ${stats.matchesCounted} matches — ${Math.round(stats.winPct)}% wins · ` +
    `${stats.rating.toFixed(2)} rating · ${swing} swing · ` +
    `${stats.kills}/${stats.deaths}/${stats.assists} K/D/A · ` +
    `${stats.kd.toFixed(2)} K/D · ${stats.kpr != null ? stats.kpr.toFixed(2) : "—"} K/R · ` +
    `${stats.adr != null ? stats.adr.toFixed(1) : "—"} ADR`
  );
}

/**
 * The "last 30 matches" stat strip from Leetify's own player page — Wins /
 * Rating / Swing / K/D/A / K/D / K/R / ADR. See leetifyStats.ts for what
 * each field means and where it comes from. `compact` shrinks the type and
 * gaps for tighter spots (a roster row) without dropping any columns.
 */
export function LeetifyStatsStrip({
  stats,
  compact = false,
}: {
  stats: LeetifyMatchStats | null;
  compact?: boolean;
}) {
  if (!stats) {
    return <span className="text-xs text-muted/70">No Leetify data</span>;
  }

  const swingPositive = stats.swingPct >= 0;

  return (
    <div
      className={
        compact
          ? "inline-grid grid-cols-7 divide-x divide-line"
          : "inline-grid grid-cols-7 gap-x-3"
      }
      title={tooltipFor(stats)}
    >
      <Cell label="Wins" value={`${Math.round(stats.winPct)}%`} compact={compact} />
      <Cell
        label="Rating"
        value={stats.rating.toFixed(2)}
        className="text-white font-semibold"
        compact={compact}
      />
      <Cell
        label="Swing"
        value={`${swingPositive ? "+" : ""}${stats.swingPct.toFixed(2)}%`}
        className={swingPositive ? "text-emerald-400" : "text-red-400"}
        compact={compact}
      />
      <Cell label="K/D/A" value={`${stats.kills}/${stats.deaths}/${stats.assists}`} compact={compact} />
      <Cell label="K/D" value={stats.kd.toFixed(2)} compact={compact} />
      <Cell label="K/R" value={stats.kpr != null ? stats.kpr.toFixed(2) : "—"} compact={compact} />
      <Cell label="ADR" value={stats.adr != null ? stats.adr.toFixed(1) : "—"} compact={compact} />
    </div>
  );
}

/** Compact single-number version for tight spaces (team rosters) — full breakdown on hover. */
export function LeetifyRatingChip({ stats }: { stats: LeetifyMatchStats | null }) {
  if (!stats) return null;
  return (
    <span
      className="shrink-0 rounded bg-input/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink"
      title={tooltipFor(stats)}
    >
      {stats.rating.toFixed(2)}
    </span>
  );
}

function Cell({
  label,
  value,
  className,
  compact,
}: {
  label: string;
  value: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={`text-center ${compact ? "min-w-[2.15rem] px-1" : "min-w-[3.25rem]"}`}>
      <p
        className={`tabular-nums whitespace-nowrap ${compact ? "text-[11px]" : "text-sm"} ${className ?? "text-ink"}`}
      >
        {value}
      </p>
      <p className={`uppercase tracking-wide text-muted ${compact ? "text-[8px]" : "text-[10px]"}`}>
        {label}
      </p>
    </div>
  );
}
