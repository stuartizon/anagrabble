import type { LobbySnapshot } from "@anagrabble/protocol";
import { Header } from "../../components/Header";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { PageShell, PageContent, NarrowColumn } from "../../components/Layout";
import { RulesLink } from "../../components/RulesLink";
import { GameConfigList } from "./GameConfigList";
import { PlayerList } from "./PlayerList";
import styles from "./LobbyPage.module.css";

// A guest who opens a mid-game invite link without ever calling JoinGame is
// otherwise just as "transport-ready" as anyone else — the WS connect
// already hands them a live-updating LobbySnapshot regardless of when it
// happens — but they can't do anything with it (apply_submit_word.lua
// rejects a submitter who isn't a recognized player). Gate the board behind
// the same join prompt the pre-start lobby already uses, rather than
// exposing a live read-only spectator view. See docs/decisions.md "Mid-game
// join: scope decisions".
export function JoinInProgressCard({
  lobby,
  colors,
  joining,
  canJoin,
  onJoin,
}: {
  lobby: LobbySnapshot;
  colors: Map<string, string>;
  joining: boolean;
  canJoin: boolean;
  onJoin: () => void;
}) {
  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          <Card>
            <div className={styles.title}>Join this game</div>
            <div className={styles.subtitle}>This game’s already in progress — join in.</div>

            <GameConfigList config={lobby.config} />

            <div className={styles.rulesLinkRow}>
              <RulesLink />
            </div>

            <PlayerList players={lobby.players} colors={colors} />

            <Button size="lg" onClick={onJoin} disabled={!canJoin || joining} fullWidth>
              {joining ? "Joining…" : "Join game"}
            </Button>
          </Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
