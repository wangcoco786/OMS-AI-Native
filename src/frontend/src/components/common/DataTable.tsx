import { type ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface ColumnDefinition<T> {
  /** Unique key for the column */
  key: string;
  /** Column header label */
  header: string;
  /** Whether this column is sortable */
  sortable?: boolean;
  /** Custom render function for cell content */
  render?: (row: T) => ReactNode;
}

export type SortOrder = 'asc' | 'desc';

export interface DataTableProps<T> {
  /** Column definitions */
  columns: ColumnDefinition<T>[];
  /** Data rows */
  data: T[];
  /** Current sort column key */
  sortBy?: string;
  /** Current sort order */
  sortOrder?: SortOrder;
  /** Sort change handler */
  onSort?: (columnKey: string) => void;
  /** Current page (1-based) */
  page?: number;
  /** Number of items per page */
  pageSize?: number;
  /** Total number of items */
  total?: number;
  /** Page change handler */
  onPageChange?: (page: number) => void;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  sortBy,
  sortOrder,
  onSort,
  page = 1,
  pageSize = 10,
  total,
  onPageChange,
}: DataTableProps<T>): ReactNode {
  const totalPages = total != null ? Math.ceil(total / pageSize) : undefined;
  const showPagination = totalPages != null && totalPages > 1;

  return (
    <div className={styles.container}>
      <div className={styles.tableWrapper}>
        <table className={styles.table} role="grid">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${styles.th} ${col.sortable ? styles.sortable : ''}`}
                  aria-sort={
                    sortBy === col.key
                      ? sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => onSort(col.key)}
                      aria-label={`Sort by ${col.header}`}
                    >
                      {col.header}
                      <span className={styles.sortIcon} aria-hidden="true">
                        {sortBy === col.key ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={columns.length}>
                  暂无数据
                </td>
              </tr>
            ) : (
              data.map((row, rowIndex) => (
                <tr key={rowIndex} className={styles.row}>
                  {columns.map((col) => (
                    <td key={col.key} className={styles.td}>
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <nav className={styles.pagination} aria-label="Table pagination">
          <button
            type="button"
            className={styles.pageButton}
            disabled={page <= 1}
            onClick={() => onPageChange?.(page - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className={styles.pageInfo}>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className={styles.pageButton}
            disabled={page >= totalPages!}
            onClick={() => onPageChange?.(page + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </nav>
      )}
    </div>
  );
}
