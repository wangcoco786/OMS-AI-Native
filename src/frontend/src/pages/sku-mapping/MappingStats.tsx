import { type ReactNode } from 'react';
import styles from './MappingStats.module.css';
import type { MappingStatsData } from './types';

export interface MappingStatsProps {
  stats: MappingStatsData;
}

interface StatCard {
  label: string;
  value: number | string;
  variant: 'total' | 'success' | 'warning' | 'error' | 'accuracy';
}

export function MappingStats({ stats }: MappingStatsProps): ReactNode {
  const accuracy = stats.accuracy;
  const accuracyVariant: StatCard['variant'] =
    accuracy != null && accuracy < 85 ? 'warning' : 'success';

  const cards: StatCard[] = [
    { label: '总映射数', value: stats.total, variant: 'total' },
    { label: '高置信度', value: stats.highConfidence, variant: 'success' },
    { label: '需确认', value: stats.needsReview, variant: 'warning' },
    { label: '无匹配', value: stats.noMatch, variant: 'error' },
  ];

  if (accuracy != null) {
    cards.push({
      label: '准确率',
      value: `${accuracy.toFixed(1)}%`,
      variant: accuracyVariant,
    });
  }

  return (
    <div role="region" aria-label="映射统计">
      <div className={styles.container}>
        {cards.map((card) => (
          <div key={card.label} className={`${styles.card} ${styles[card.variant]}`}>
            <span className={styles.value}>{card.value}</span>
            <span className={styles.label}>{card.label}</span>
          </div>
        ))}
      </div>

      {accuracy != null && accuracy < 85 && (
        <div className={styles.warningBanner} role="alert">
          ⚠️ 当前准确率 ({accuracy.toFixed(1)}%) 低于 85% 阈值，建议检查数据质量或调整匹配策略。
        </div>
      )}
    </div>
  );
}
