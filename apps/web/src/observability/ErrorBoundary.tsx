// Before this existed, a component that threw during render unmounted the
// whole tree and left the player staring at a blank page, with nothing
// logged anywhere anyone would see (anagrabble#46). A hand-rolled boundary
// rather than Sentry's own, so the vendor stays behind ./sentry — the same
// reason src/auth/ exists.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Wordmark } from "../components/Wordmark";
import { PageShell, PageContent, NarrowColumn } from "../components/Layout";
import { reportError } from "./sentry";
import styles from "./ErrorBoundary.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, {
      tags: { op: "react.render" },
      // The component stack is what makes a minified React error locatable
      // even before source maps resolve the frames.
      extra: { componentStack: info.componentStack, path: window.location.pathname },
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <PageShell>
        {/* Deliberately a bare Wordmark rather than the usual <Header/>:
            Header pulls in the auth provider and the router, and this
            boundary sits outside both (main.tsx). A fallback that can itself
            throw is no fallback at all — it just blanks the page a second
            time, with nowhere left to catch it. */}
        <div className={styles.wordmark}>
          <Wordmark />
        </div>
        <PageContent>
          <NarrowColumn>
            <Card>
              <div className={styles.title}>Something broke</div>
              <div className={styles.body}>
                Not your fault. Reloading usually sorts it, and we&rsquo;ve been told.
              </div>
              {/* A hard reload, not a state reset: whatever threw is still in
                  the tree, so re-rendering it would just throw again. */}
              <Button onClick={() => window.location.reload()}>Reload the page</Button>
            </Card>
          </NarrowColumn>
        </PageContent>
      </PageShell>
    );
  }
}
