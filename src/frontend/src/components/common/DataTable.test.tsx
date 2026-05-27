import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataTable, type ColumnDefinition } from './DataTable';

interface TestRow {
  id: number;
  name: string;
  status: string;
  [key: string]: unknown;
}

const columns: ColumnDefinition<TestRow>[] = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: '名称', sortable: true },
  { key: 'status', header: '状态', sortable: true },
];

const data: TestRow[] = [
  { id: 1, name: '订单A', status: '已完成' },
  { id: 2, name: '订单B', status: '处理中' },
  { id: 3, name: '订单C', status: '待处理' },
];

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('名称')).toBeInTheDocument();
    expect(screen.getByText('状态')).toBeInTheDocument();
  });

  it('renders data rows', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByText('订单A')).toBeInTheDocument();
    expect(screen.getByText('订单B')).toBeInTheDocument();
    expect(screen.getByText('订单C')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    render(<DataTable columns={columns} data={[]} />);
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('calls onSort when sortable header is clicked', () => {
    const onSort = vi.fn();
    render(<DataTable columns={columns} data={data} onSort={onSort} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by 名称' }));
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('shows sort direction indicator for active sort column', () => {
    render(<DataTable columns={columns} data={data} sortBy="name" sortOrder="asc" onSort={vi.fn()} />);
    const nameHeader = screen.getByRole('columnheader', { name: /名称/i });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('renders pagination when total exceeds pageSize', () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={data}
        page={1}
        pageSize={10}
        total={25}
        onPageChange={onPageChange}
      />
    );
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('disables previous button on first page', () => {
    render(
      <DataTable columns={columns} data={data} page={1} pageSize={10} total={25} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  it('disables next button on last page', () => {
    render(
      <DataTable columns={columns} data={data} page={3} pageSize={10} total={25} onPageChange={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('calls onPageChange when navigation buttons are clicked', () => {
    const onPageChange = vi.fn();
    render(
      <DataTable columns={columns} data={data} page={2} pageSize={10} total={25} onPageChange={onPageChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('supports custom render function for columns', () => {
    const customColumns: ColumnDefinition<TestRow>[] = [
      { key: 'name', header: '名称', render: (row) => <strong>{row.name}</strong> },
    ];
    render(<DataTable columns={customColumns} data={data} />);
    expect(screen.getByText('订单A').tagName).toBe('STRONG');
  });
});
