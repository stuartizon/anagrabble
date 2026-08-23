import { Header } from "../../components/Header";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { PageShell, PageContent, NarrowColumn } from "../../components/Layout";
import { cx } from "../../cx";
import styles from "./LobbyPage.module.css";

export function GameNotFoundCard({ onBackHome }: { onBackHome: () => void }) {
  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          <Card>
            <div className={cx(styles.title, styles.notFoundTitleOverride)}>Game not found</div>
            <div className={styles.notFoundBody}>
              Check the link, or ask whoever sent it for a fresh one.
            </div>
            <Button onClick={onBackHome}>Back home</Button>
          </Card>
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
