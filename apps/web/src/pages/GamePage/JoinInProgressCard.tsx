import type { GameSnapshot } from "@anagrabble/protocol";
import { Header } from "../../components/Header";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { GameConfigList } from "../../components/GameConfigList";
import { PageShell, PageContent, NarrowColumn } from "../../components/Layout";
import { RulesLink } from "../../components/RulesLink";
import type { SocketStatus } from "../../hooks/useGameSocket";
import { assignPlayerColors } from "../../utils/playerColors";
import { PlayerList } from "./PlayerList";
import styles from "./shared.module.css";

// A guest who opens a mid-game invite link without ever calling JoinGame is
// otherwise just as "transport-ready" as anyone else — the WS connect
// already hands them a live-updating GameSnapshot regardless of when it
// happens — but they can't do anything with it (apply_submit_word.lua
// rejects a submitter who isn't a recognized player). Gate the board behind
// the same join prompt the pre-start game already uses, rather than
// exposing a live read-only spectator view. See docs/decisions.md "Mid-game
// join: scope decisions".
export function JoinInProgressCard({
  game,
  playerId,
  status,
  joining,
  onJoin,
}: {
  game: GameSnapshot;
  playerId: string;
  status: SocketStatus;
  joining: boolean;
  onJoin: () => void;
}) {
  // Not actually in game.players (that's the whole reason this screen
  // exists), so this never matches an entry — same as if computed with any
  // other non-member id — but keeps this in line with every other screen's
  // colors derivation rather than a one-off.
  const colors = assignPlayerColors(game.players, playerId);
  const canJoin = status === "open";

  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          <Card>
            <div className={styles.title}>Join this game</div>
            <div className={styles.subtitle}>This game’s already in progress — join in.</div>

            <GameConfigList config={game.config} />

            <div className={styles.rulesLinkRow}>
              <RulesLink />
            </div>

            <PlayerList players={game.players} colors={colors} />

            <Button size="lg" onClick={onJoin} disabled={!canJoin || joining} fullWidth>
              {joining ? "Joining…" : "Join game"}
            </Button>
          </Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
