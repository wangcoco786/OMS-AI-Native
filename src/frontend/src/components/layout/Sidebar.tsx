import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/onboarding', label: '店铺接入', icon: '🚀' },
  { path: '/sku-mapping', label: 'SKU 映射', icon: '🔗' },
  { path: '/data-sync', label: '数据同步', icon: '🔄' },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <nav className={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
