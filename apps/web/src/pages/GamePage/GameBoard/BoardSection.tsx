import type { GameSnapshot, PlayerState } from "@anagrabble/protocol";
import { LetterTile } from "../../../components/LetterTile";
import { TurnTileButton } from "../../../components/TurnTileButton";
import { EndGameCountdown } from "../../../components/EndGameCountdown";
import styles from "./BoardSection.module.css";
import sharedStyles from "./shared.module.css";

// The post-bank-empty idle timeout (CLAUDE.md "Game-end condition") is
// hardcoded server-side too (apply_turn_tile.lua / apply_submit_word.lua's
// 60000ms) — kept in sync manually until GameConfig exposes it (see
// CLAUDE.md "Still open").
const IDLE_TIMEOUT_SEC = 60;

interface BoardSectionProps {
  game: GameSnapshot;
  colors: Map<string, string>;
  playerId: string;
  currentPlayer: PlayerState | undefined;
  isCurrentPlayer: boolean;
  secondsLeft: number;
  endGameDeadline: number | null;
  endGameSecondsLeft: number;
  onTurnTile: () => void;
}

// The upturned-tile pool plus both word lists (everyone else's, then the
// viewer's own) — the part of the screen that actually changes as tiles
// get turned and words get claimed.
export function BoardSection({
  game,
  colors,
  playerId,
  currentPlayer,
  isCurrentPlayer,
  secondsLeft,
  endGameDeadline,
  endGameSecondsLeft,
  onTurnTile,
}: BoardSectionProps) {
  const me = game.players.find((p) => p.id === playerId);
  const others = game.players.filter((p) => p.id !== playerId);

  return (
    <div className={styles.board}>
      <div>
        <div className={styles.poolHeader}>
          <div className={styles.poolHeaderLabel}>Upturned tiles</div>
          {game.bankCount <= 0 ? (
            endGameDeadline !== null ? (
              <EndGameCountdown secondsLeft={endGameSecondsLeft} totalSeconds={IDLE_TIMEOUT_SEC} />
            ) : (
              <span className={styles.turnHint}>No more tiles.</span>
            )
          ) : isCurrentPlayer ? (
            <TurnTileButton
              secondsLeft={secondsLeft}
              totalSeconds={game.config.turnTimerSec}
              onClick={onTurnTile}
            />
          ) : (
            <span className={styles.turnHint}>{currentPlayer?.name ?? "Someone"}&rsquo;s turn</span>
          )}
        </div>
        <div className={styles.poolTiles}>
          {game.pool.length === 0 &&
            (game.players.some((p) => p.words.length > 0) ? (
              <span className={styles.poolEmpty}>All tiles claimed.</span>
            ) : (
              <span className={styles.poolEmpty}>No tiles turned yet.</span>
            ))}
          {game.pool.map((letter, i) => (
            <LetterTile key={i} letter={letter} />
          ))}
        </div>
      </div>

      {others.length > 0 && (
        <div>
          <div className={sharedStyles.poolLabel}>Everyone else&rsquo;s words</div>
          <div className={styles.wordsList}>
            {others.every((p) => p.words.length === 0) ? (
              <span className={sharedStyles.wordsEmpty}>No words</span>
            ) : (
              others.flatMap((p) =>
                p.words.map((w, i) => (
                  <span key={`${p.id}-${i}-${w}`} className={styles.wordTag}>
                    <span className={styles.wordTagDot} style={{ background: colors.get(p.id) }} />
                    {w}
                  </span>
                )),
              )
            )}
          </div>
        </div>
      )}

      <div>
        <div className={sharedStyles.poolLabel}>Your words</div>
        <div className={styles.wordsList}>
          {!me || me.words.length === 0 ? (
            <span className={sharedStyles.wordsEmpty}>No words</span>
          ) : (
            me.words.map((w, i) => (
              <span key={`${i}-${w}`} className={styles.wordTag}>
                <span className={styles.wordTagDot} style={{ background: colors.get(playerId) }} />
                {w}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
