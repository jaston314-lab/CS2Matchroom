import { describe, expect, it } from "vitest";
import { getEventType, getMatchzyMatchId, interpretMatchzyEvent } from "./webhookEvents";

// Real payloads captured from a live MatchZy Enhanced match (see MatchEvent
// rows from matchid 1788275220) — used instead of guessed shapes after
// discovering the event *names* we'd assumed (series_result, round_ended)
// don't match what MatchZy actually sends (series_end, round_end), which
// left completed matches stuck at LIVE forever with no COMPLETED status.

const roundStarted = {
  team1_score: 0,
  team2_score: 0,
  round_number: 1,
  map_number: 0,
  matchid: 1788275220,
  event: "round_started",
};

const mapResult = {
  winner: { side: "2", team: "team2" },
  team1: { series_score: 0, score: 10, score_ct: 0, score_t: 0, id: "", name: "Team A" },
  team2: { series_score: 1, score: 13, score_ct: 0, score_t: 0, id: "", name: "Team B" },
  map_number: 0,
  matchid: 1788275220,
  event: "map_result",
};

const seriesEnd = {
  time_until_restore: 10,
  winner: { side: "2", team: "team2" },
  team1_series_score: 0,
  team2_series_score: 1,
  matchid: 1788275220,
  event: "series_end",
};

describe("webhookEvents against real MatchZy payloads", () => {
  it("reads the event type and matchid", () => {
    expect(getEventType(mapResult)).toBe("map_result");
    expect(getMatchzyMatchId(mapResult)).toBe("1788275220");
  });

  it("reads round_started's flat scores and marks the match LIVE", () => {
    const update = interpretMatchzyEvent(roundStarted);
    expect(update.status).toBe("LIVE");
    expect(update.team1Score).toBe(0);
    expect(update.team2Score).toBe(0);
    expect(update.currentMapIndex).toBe(0);
  });

  it("reads map_result's nested team1.score/team2.score", () => {
    const update = interpretMatchzyEvent(mapResult);
    expect(update.team1Score).toBe(10);
    expect(update.team2Score).toBe(13);
  });

  it("marks the match COMPLETED on series_end — the actual real event name, not the guessed series_result", () => {
    const update = interpretMatchzyEvent(seriesEnd);
    expect(update.status).toBe("COMPLETED");
  });

  it("doesn't clobber scores on series_end, which carries series score not round score", () => {
    const update = interpretMatchzyEvent(seriesEnd);
    expect(update.team1Score).toBeUndefined();
    expect(update.team2Score).toBeUndefined();
  });
});
