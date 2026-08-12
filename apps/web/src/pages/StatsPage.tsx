import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { LetterTile } from "../components/LetterTile";
import { Loader } from "../components/Loader";
import { PageShell, CenteredContent } from "../components/Layout";
import { fetchPlayerStats, type PlayerStatsResponse } from "../fetchPlayerStats";
import { cx } from "../cx";
import styles from "./StatsPage.module.css";

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LoadState =
  { status: "loading" } | { status: "error" } | { status: "loaded"; stats: PlayerStatsResponse };

export function StatsPage() {
  const { getToken } = useAuth();
  // Read via a ref, not a useEffect dependency — Clerk doesn't guarantee
  // getToken's identity is stable across renders (see useGameSocket.ts),
  // and this should only fetch once on mount, not on every identity change.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error("No auth token");
        const stats = await fetchPlayerStats(token);
        if (!cancelled) setState({ status: "loaded", stats });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageShell>
      <Header />
      <CenteredContent>
        <div className={styles.column}>
          {state.status === "loading" && <Loader />}
          {state.status === "error" && <Card>Something went wrong loading your stats.</Card>}
          {state.status === "loaded" && <StatsContent stats={state.stats} />}
        </div>
      </CenteredContent>
    </PageShell>
  );
}

function StatsContent({ stats }: { stats: PlayerStatsResponse }) {
  if (stats.gamesPlayed === 0) {
    return <Card>No completed games yet — play a game to see your stats here.</Card>;
  }

  // gamesPlayed > 0 guarantees these are non-null — packages/postgres's
  // getPlayerStats only nulls them out when there are zero completed games.
  const winRatePct = stats.winRatePct as number;
  const avgScore = stats.avgScore as number;
  const highestScore = stats.highestScore as number;

  return (
    <>
      <div className={styles.title}>Your stats</div>

      <div className={styles.summaryGrid}>
        <SummaryCard label="Games played" value={stats.gamesPlayed} />
        <SummaryCard label="Wins" value={stats.wins} />
        <SummaryCard label="Win rate" value={`${winRatePct}%`} />
        <SummaryCard label="Current win streak" value={stats.currentWinStreak} />
        <SummaryCard label="Best win streak" value={stats.bestWinStreak} />
        <SummaryCard label="Average score" value={avgScore} accent="gold" />
        <SummaryCard label="Highest score" value={highestScore} accent="gold" />
        <SummaryCard label="Lifetime score" value={stats.lifetimeScore} accent="gold" />
        <SummaryCard label="Lifetime words played" value={stats.lifetimeWordsPlayed} />
        {stats.avgGameDurationSec !== null && (
          <SummaryCard
            label="Average game length"
            value={formatDuration(stats.avgGameDurationSec)}
            compact
          />
        )}
      </div>

      {stats.longestWordPlayed && (
        <Card>
          <div className={styles.sectionLabel}>Longest word</div>
          {/* Two renders, CSS-toggled at a 640px breakpoint sized to this
              content specifically (see StatsPage.module.css) — not
              GameBoard's unrelated 840px sidebar breakpoint. No fixed tile
              size reliably fits an arbitrary-length word on an arbitrarily
              narrow screen (steals/combines can produce long words — the
              design mock's own example is 9 letters, FORECASTS, and chains
              can go further), so narrow screens fall back to plain text,
              which wraps as a whole word rather than stacking an orphaned
              tile onto its own line. */}
          <div className={styles.longestWordTiles} data-testid="longest-word-tiles">
            {stats.longestWordPlayed.split("").map((letter, i) => (
              <LetterTile key={i} letter={letter} size="md" />
            ))}
          </div>
          <div className={styles.longestWordText} data-testid="longest-word-text">
            {stats.longestWordPlayed}
          </div>
        </Card>
      )}

      <div className={styles.recentGamesLabel}>Recent games</div>
      <div className={styles.recentGamesList}>
        {stats.recentGames.map((game) => (
          <div key={game.gameId} className={styles.recentGameRow}>
            <span className={styles.recentGameDate}>{formatDate(game.endedAt)}</span>
            <span className={styles.recentGamePlace}>{ordinal(game.placement)} place</span>
            <span className={styles.recentGameScore}>{game.score}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  compact,
}: {
  label: string;
  value: string | number;
  accent?: "gold";
  /** Smaller font size for values that read as text rather than a plain
   * number (e.g. "7h 10m") — --text-2xl bold routinely wraps a value like
   * that onto two lines in a ~140px card; the plain numeric/percentage
   * stats never need this. */
  compact?: boolean;
}) {
  return (
    <Card>
      <div className={styles.summaryCardBody}>
        <div className={styles.summaryLabel}>{label}</div>
        <div
          className={cx(
            accent === "gold" ? styles.summaryValueGold : styles.summaryValue,
            compact && styles.summaryValueCompact,
          )}
        >
          {value}
        </div>
      </div>
    </Card>
  );
}
