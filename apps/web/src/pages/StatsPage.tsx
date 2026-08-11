import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { PageShell, CenteredContent } from "../components/Layout";
import { fetchPlayerStats, type PlayerStatsResponse } from "../fetchPlayerStats";
import styles from "./StatsPage.module.css";

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
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
          {state.status === "loading" && <Card>Loading your stats…</Card>}
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
        <SummaryCard label="Average score" value={avgScore} accent="gold" />
        <SummaryCard label="Highest score" value={highestScore} accent="gold" />
        <SummaryCard label="Current win streak" value={stats.currentWinStreak} />
        <SummaryCard label="Best win streak" value={stats.bestWinStreak} />
        <SummaryCard label="Lifetime words played" value={stats.lifetimeWordsPlayed} />
        <SummaryCard label="Lifetime score" value={stats.lifetimeScore} accent="gold" />
        {stats.avgGameDurationSec !== null && (
          <SummaryCard
            label="Average game length"
            value={formatDuration(stats.avgGameDurationSec)}
          />
        )}
      </div>

      {stats.longestWordPlayed && (
        <Card>
          <div className={styles.sectionLabel}>Longest word</div>
          <div className={styles.longestWord}>{stats.longestWordPlayed}</div>
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
}: {
  label: string;
  value: string | number;
  accent?: "gold";
}) {
  return (
    <Card>
      <div className={styles.summaryLabel}>{label}</div>
      <div className={accent === "gold" ? styles.summaryValueGold : styles.summaryValue}>
        {value}
      </div>
    </Card>
  );
}
