import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { LetterTile } from "../components/LetterTile";
import { Wordmark } from "../components/Wordmark";
import { PageShell } from "../components/Layout";
import heroImage from "../assets/lifestyle-playing.jpg";
import styles from "./HomePage.module.css";

// Matches design-system/Home.dc.html. The design's "Create a game" href
// branches on login state client-side (the design mock has no real
// router); here the button always targets /new and RequireAuth does that
// branching for real, redirecting to /login and back afterwards.
//
const HOW_IT_WORKS = [
  {
    tiles: ["C"],
    title: "1. Turn a tile",
    body: "On your turn, flip one letter from the bank face-up. Everyone can see it.",
  },
  {
    tiles: ["C", "A", "T"],
    title: "2. Play a word",
    body: "Spot a word in the upturned tiles? Type it. If it's real and the letters are there, it's yours.",
  },
  {
    tiles: ["C", "A", "S", "T"],
    title: "3. Steal a word",
    body: "Add letters to steal someone else's word. CAT + S = CAST, and it moves to your word list.",
  },
];

const CODE_LENGTH = 5;

export function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");

  const onCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, CODE_LENGTH);
    setCode(next);
    setCodeError("");
  };

  const joinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setCodeError("Codes are 5 characters. Check and try again.");
      return;
    }
    navigate(`/${code}`);
  };

  return (
    <PageShell>
      <Header />
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <div>
            <h1 className={styles.heroTitle}>Turn a letter. Take a word.</h1>
            <p className={styles.heroSubtitle}>
              Spot a word, and it&rsquo;s yours — until someone else steals it. Add another letter,
              and you can steal it right back.
            </p>
            <div className={styles.actionsRow}>
              <div className={styles.createGroup}>
                <Button size="lg" onClick={() => navigate("/new")}>
                  Create a game
                </Button>
                <span className={styles.actionsOr}>or</span>
              </div>
              <form className={styles.joinForm} onSubmit={joinByCode}>
                <Input
                  size="lg"
                  placeholder="Invite code"
                  value={code}
                  onChange={onCodeChange}
                  error={codeError}
                  mono
                />
                <Button type="submit" variant="secondary" size="lg">
                  Join
                </Button>
              </form>
            </div>
          </div>
        </div>
        <div className={styles.heroImage}>
          <img src={heroImage} alt="" />
        </div>
      </section>

      <section className={styles.howItWorks}>
        <h2 className={styles.howItWorksTitle}>How it works</h2>
        <div className={styles.cardGrid}>
          {HOW_IT_WORKS.map((step) => (
            <Card key={step.title}>
              <div className={styles.tileRow}>
                {step.tiles.map((letter, i) => (
                  <LetterTile key={i} letter={letter} size="sm" />
                ))}
              </div>
              <div className={styles.stepTitle}>{step.title}</div>
              <div className={styles.stepBody}>{step.body}</div>
            </Card>
          ))}
        </div>
        <div className={styles.rulesLinkRow}>
          <Link to="/rules" className={styles.rulesLink}>
            Read the full rules &rarr;
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <Wordmark size="sm" />
        <span>&copy; 2026 Anagrabble</span>
      </footer>
    </PageShell>
  );
}
