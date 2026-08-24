import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Loader } from "../components/Loader";
import { PageShell, PageContent, NarrowColumn } from "../components/Layout";
import { PlayerSettingsFields } from "../components/PlayerSettingsFields";
import { usePlayerSettings } from "../hooks/usePlayerSettings";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { state, saveError, update } = usePlayerSettings();

  return (
    <PageShell>
      <Header />
      <PageContent>
        <NarrowColumn>
          {state.status === "loading" && <Loader />}
          {state.status === "error" && <Card>Something went wrong loading your settings.</Card>}
          {state.status === "loaded" && (
            <Card>
              <div className={styles.title}>Settings</div>
              <PlayerSettingsFields
                settings={state.settings}
                onUpdate={update}
                saveError={saveError}
                hapticsHint
                variant="page"
              />
            </Card>
          )}
        </NarrowColumn>
      </PageContent>
    </PageShell>
  );
}
