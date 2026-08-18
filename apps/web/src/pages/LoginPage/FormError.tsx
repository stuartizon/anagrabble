import styles from "./LoginPage.module.css";

export function FormError({ message }: { message: string | undefined }) {
  return message ? <div className={styles.formError}>{message}</div> : null;
}
