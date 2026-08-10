import { Header } from "../components/Header";
import { RulesContent } from "../components/RulesContent";
import { PageShell } from "../components/Layout";
import styles from "./RulesPage.module.css";

// Matches design-system/Rules.dc.html. Not RequireAuth-gated — a visitor
// can read the rules before signing in, per the user story. Uses the
// default Header (with its usual account status) rather than the design
// mock's bespoke "Back home" link, for consistency with every other page.
export function RulesPage() {
  return (
    <PageShell>
      <Header />
      <div className={styles.content}>
        <div className={styles.column}>
          <h1 className={styles.title}>Rules</h1>
          <RulesContent />
        </div>
      </div>
    </PageShell>
  );
}
