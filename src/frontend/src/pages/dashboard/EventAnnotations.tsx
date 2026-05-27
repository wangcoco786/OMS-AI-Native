import type { EventAnnotation } from './types';
import styles from './EventAnnotations.module.css';

interface EventAnnotationsProps {
  events: EventAnnotation[];
}

function getEventColor(type: EventAnnotation['type']): string {
  switch (type) {
    case 'deployment':
      return '#6366f1';
    case 'promotion':
      return '#f59e0b';
    case 'sync_error':
      return '#ef4444';
    default:
      return '#94a3b8';
  }
}

function getEventTypeLabel(type: EventAnnotation['type']): string {
  switch (type) {
    case 'deployment':
      return '系统部署';
    case 'promotion':
      return '促销活动';
    case 'sync_error':
      return '数据同步异常';
    default:
      return '事件';
  }
}

function formatEventTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EventAnnotations({ events }: EventAnnotationsProps) {
  if (!events || events.length === 0) {
    return null;
  }

  return (
    <div className={styles.container} data-testid="event-annotations">
      <div className={styles.header}>
        <span>📌 事件标注</span>
        <span>({events.length})</span>
      </div>
      <div className={styles.eventList}>
        {events.map((event) => {
          const color = event.color || getEventColor(event.type);
          return (
            <div
              key={event.id}
              className={styles.eventBadge}
              data-testid={`event-badge-${event.id}`}
            >
              <span className={styles.eventDot} style={{ background: color }} />
              <span>{event.label}</span>
              <div className={styles.eventTooltip} role="tooltip">
                <div>{getEventTypeLabel(event.type)}</div>
                <div>{formatEventTime(event.timestamp)}</div>
                <div>{event.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
