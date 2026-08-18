import styles from "./LoginPage.module.css";

export function BackToLoginLink({ onBack }: { onBack: () => void }) {
  return (
    <a
      href="#"
      className={styles.backLink}
      onClick={(e) => {
        e.preventDefault();
        onBack();
      }}
    >
      Back to log in
    </a>
  );
}
