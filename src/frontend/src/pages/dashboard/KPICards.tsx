import type { KPIMetrics, KPITrendData } from './types';
import styles from './KPICards.module.css';

interface KPICardsProps {
  metrics: KPIMetrics;
  trendData?: KPITrendData | null;
}

interface CardConfig {
  key: keyof KPIMetrics;
  label: string;
  format: (value: number) => string;
}

const CARD_CONFIGS: CardConfig[] = [
  {
    key: 'orderCount',
    label: '订单量',
    format: (v) => v.toLocaleString(),
  },
  {
    key: 'fulfillmentRate',
    label: '履约率',
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    key: 'returnRate',
    label: '退货率',
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    key: 'avgProcessingTime',
    label: '平均处理时长',
    format: (v) => `${v.toFixed(0)} 分钟`,
  },
];

function getTrend(
  metricKey: keyof KPIMetrics,
  trendData?: KPITrendData | null,
): { direction: 'up' | 'down' | 'flat'; isAnomaly: boolean } {
  if (!trendData || trendData.points.length < 2) {
    return { direction: 'flat', isAnomaly: false };
  }

  const points = trendData.points;
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];

  const direction =
    latest.value > previous.value
      ? 'up'
      : latest.value < previous.value
        ? 'down'
        : 'flat';

  // Check if the metric matches the trend data and latest point is anomalous
  const isAnomaly =
    trendData.metric === metricKey && latest.anomaly === true;

  return { direction, isAnomaly };
}

export function KPICards({ metrics, trendData }: KPICardsProps) {
  return (
    <div className={styles.grid} data-testid="kpi-cards">
      {CARD_CONFIGS.map((config) => {
        const { direction, isAnomaly } = getTrend(config.key, trendData);
        const cardClass = isAnomaly
          ? `${styles.card} ${styles.cardAnomaly}`
          : styles.card;

        return (
          <div
            key={config.key}
            className={cardClass}
            data-testid={`kpi-card-${config.key}`}
          >
            <div className={styles.cardHeader}>
              <span className={styles.metricName}>{config.label}</span>
              {isAnomaly && (
                <span
                  className={styles.warningIcon}
                  data-testid={`anomaly-icon-${config.key}`}
                  aria-label="异常波动"
                >
                  ⚠️
                </span>
              )}
            </div>
            <div className={styles.value}>{config.format(metrics[config.key])}</div>
            <div className={styles.trendIndicator}>
              {direction === 'up' && (
                <span className={styles.trendUp} aria-label="上升趋势">↑</span>
              )}
              {direction === 'down' && (
                <span className={styles.trendDown} aria-label="下降趋势">↓</span>
              )}
              {direction === 'flat' && <span aria-label="持平">→</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
