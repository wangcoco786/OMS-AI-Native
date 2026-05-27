import styles from './Header.module.css';

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.logoText}>OMS AI Native</span>
      </div>
      <nav className={styles.nav}>
        <span className={styles.user}>管理员</span>
      </nav>
    </header>
  );
}
