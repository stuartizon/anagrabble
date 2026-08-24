import { useNavigate } from "react-router-dom";
import type { LobbySnapshot } from "@anagrabble/protocol";
import { Header } from "../../components/Header";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { PageShell, PageContent, NarrowColumn } from "../../components/Layout";
import { assignPlayerColors } from "../../utils/playerColors";
import styles from "./GameOverSummary.module.css";

// Matches design-system/Game Over.dc.html: a final-scores card replacing
// GameBoard entirely once lobby.status === "ended" (see LobbyPage), rather
// than an overlay on top of the board — the tile pool/turn timer have
// nothing left to say once the idle countdown has expired (CLAUDE.md
// "Game-end condition"). PlayerState.words/score are already exactly what's
// needed; no protocol change required.

interface RankedPlayer {
  id: string;
  name: string;
  score: number;
  words: string[];
  color: string;
  rank: number;
}

/** Standard competition ranking (1, 1, 3 — not 1, 2, 3) so a tie is never
 * drawn as if one player edged out the other. */
function rankPlayers(lobby: LobbySnapshot, colors: Map<string, string>): RankedPlayer[] {
  const sorted = [...lobby.players].sort((a, b) => b.score - a.score);
  const ranked: RankedPlayer[] = [];
  sorted.forEach((p, i) => {
    const rank = i > 0 && sorted[i - 1].score === p.score ? ranked[i - 1].rank : i + 1;
    ranked.push({
      id: p.id,
      name: p.name,
      score: p.score,
      words: p.words,
      color: colors.get(p.id) ?? "var(--text-muted)",
      rank,
    });
  });
  return ranked;
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function winnerLine(ranked: RankedPlayer[]): string {
  if (ranked.length === 0) return "";
  const topScore = ranked[0].score;
  const winners = ranked.filter((p) => p.score === topScore);
  if (winners.length === 1) return `${winners[0].name} wins with ${winners[0].score}.`;
  return `${joinNames(winners.map((p) => p.name))} tie at ${topScore}.`;
}

interface GameOverSummaryProps {
  lobby: LobbySnapshot;
  playerId: string;
}

export function GameOverSummary({ lobby, playerId }: GameOverSummaryProps) {
  const navigate = useNavigate();
  const colors = assignPlayerColors(lobby.players, playerId);
  const ranked = rankPlayers(lobby, colors);

  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          <Card>
            <div className={styles.title}>Game over.</div>
            <div className={styles.subtitle}>{winnerLine(ranked)}</div>

            <div className={styles.playerList}>
              {ranked.map((p) => (
                <div key={p.id} className={styles.playerRow}>
                  <div className={styles.playerHeader}>
                    <span className={styles.rank} data-testid="summary-player-rank">
                      {p.rank}
                    </span>
                    <span className={styles.playerDot} style={{ background: p.color }} />
                    <span className={styles.playerName} data-testid="summary-player-name">
                      {p.name}
                    </span>
                    <span className={styles.playerScore}>{p.score}</span>
                  </div>
                  {p.words.length > 0 && (
                    <div className={styles.wordsList}>
                      {p.words.map((w, i) => (
                        <span key={`${i}-${w}`} className={styles.wordTag}>
                          {w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              <Button size="lg" onClick={() => navigate("/new")} fullWidth>
                New game
              </Button>
              <Button variant="secondary" size="lg" onClick={() => navigate("/stats")} fullWidth>
                View your stats
              </Button>
            </div>
          </Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
