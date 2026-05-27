import { useState } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import type { TimeRangePreset } from './types';
import styles from './TimeRangeSelector.module.css';

const PRESET_OPTIONS: { value: TimeRangePreset; label: string }[] = [
  { value: '1h', label: '最近1小时' },
  { value: '24h', label: '最近24小时' },
  { value: '7d', label: '最近7天' },
  { value: '30d', label: '最近30天' },
];

function getPresetRange(preset: TimeRangePreset): { startTime: string; endTime: string } {
  const now = new Date();
  const end = now.toISOString();
  let start: Date;

  switch (preset) {
    case '1h':
      start = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case '24h':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }

  return { startTime: start.toISOString(), endTime: end };
}

function toDateInputValue(isoString: string | null): string {
  if (!isoString) return '';
  return isoString.slice(0, 16); // "YYYY-MM-DDTHH:mm"
}

export function TimeRangeSelector() {
  const { startTime, endTime, setTimeRange } = useDashboardStore();
  const [activePreset, setActivePreset] = useState<TimeRangePreset | null>(null);

  const handlePresetClick = (preset: TimeRangePreset) => {
    setActivePreset(preset);
    const range = getPresetRange(preset);
    setTimeRange(range.startTime, range.endTime);
  };

  const handleStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActivePreset(null);
    const value = e.target.value;
    const isoValue = value ? new Date(value).toISOString() : null;
    setTimeRange(isoValue, endTime);
  };

  const handleEndChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setActivePreset(null);
    const value = e.target.value;
    const isoValue = value ? new Date(value).toISOString() : null;
    setTimeRange(startTime, isoValue);
  };

  return (
    <div className={styles.container} data-testid="time-range-selector">
      <div className={styles.presetGroup} role="group" aria-label="时间范围预设">
        {PRESET_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`${styles.presetBtn} ${
              activePreset === option.value ? styles.presetBtnActive : ''
            }`}
            onClick={() => handlePresetClick(option.value)}
            aria-pressed={activePreset === option.value}
            data-testid={`preset-${option.value}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.separator} aria-hidden="true" />

      <div className={styles.customRange}>
        <input
          type="datetime-local"
          className={styles.dateInput}
          value={toDateInputValue(startTime)}
          onChange={handleStartChange}
          aria-label="开始时间"
          data-testid="time-range-start"
        />
        <span className={styles.rangeSeparator}>至</span>
        <input
          type="datetime-local"
          className={styles.dateInput}
          value={toDateInputValue(endTime)}
          onChange={handleEndChange}
          aria-label="结束时间"
          data-testid="time-range-end"
        />
      </div>
    </div>
  );
}
