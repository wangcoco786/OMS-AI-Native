import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SKUMappingTable } from './SKUMappingTable';
import type { SKUMappingItem } from './types';

const mockData: SKUMappingItem[] = [
  {
    id: '1',
    channelSku: {
      id: 'ch-1',
      name: 'Blue T-Shirt Large',
      externalId: 'SHOP-BTS-L',
      attributes: { color: 'blue', size: 'L' },
    },
    systemSku: {
      id: 'sys-1',
      name: '蓝色T恤 大号',
      sku: 'SYS-BTS-L',
    },
    confidence: 92,
    matchType: 'high_confidence',
    reasoning: 'Name and attributes match closely',
    status: 'pending',
  },
  {
    id: '2',
    channelSku: {
      id: 'ch-2',
      name: 'Red Hoodie Medium',
      externalId: 'SHOP-RH-M',
      attributes: { color: 'red', size: 'M' },
    },
    systemSku: {
      id: 'sys-2',
      name: '红色卫衣 中号',
      sku: 'SYS-RH-M',
    },
    confidence: 70,
    matchType: 'needs_review',
    reasoning: 'Partial match on attributes',
    differencePoints: ['颜色描述不一致', '尺码标准不同'],
    status: 'pending',
  },
  {
    id: '3',
    channelSku: {
      id: 'ch-3',
      name: 'Custom Widget XYZ',
      externalId: 'SHOP-CW-XYZ',
      attributes: { type: 'custom' },
    },
    systemSku: null,
    confidence: 0,
    matchType: 'no_match',
    reasoning: 'No matching system SKU found',
    status: 'pending',
    suggestNewSku: true,
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('SKUMappingTable', () => {
  const defaultProps = {
    data: mockData,
    page: 1,
    pageSize: 10,
    total: 3,
    onPageChange: vi.fn(),
    onConfirm: vi.fn(),
    onReject: vi.fn(),
    onCorrect: vi.fn(),
    onBatchConfirm: vi.fn(),
    onBatchReject: vi.fn(),
  };

  it('renders channel SKU names and codes', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText('Blue T-Shirt Large')).toBeInTheDocument();
    expect(screen.getByText('SHOP-BTS-L')).toBeInTheDocument();
    expect(screen.getByText('Red Hoodie Medium')).toBeInTheDocument();
    expect(screen.getByText('SHOP-RH-M')).toBeInTheDocument();
  });

  it('renders system SKU names when matched', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText('蓝色T恤 大号')).toBeInTheDocument();
    expect(screen.getByText('SYS-BTS-L')).toBeInTheDocument();
  });

  it('renders dash for unmatched system SKU', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('renders confidence badges with correct labels', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText('高置信度')).toBeInTheDocument();
    expect(screen.getByText('需确认')).toBeInTheDocument();
    expect(screen.getByText('无匹配')).toBeInTheDocument();
  });

  it('renders difference points as highlighted items', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText('颜色描述不一致')).toBeInTheDocument();
    expect(screen.getByText('尺码标准不同')).toBeInTheDocument();
  });

  it('renders enabled action buttons for pending items', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    const confirmButtons = screen.getAllByText('确认');
    const rejectButtons = screen.getAllByText('拒绝');
    const correctButtons = screen.getAllByText('修正');

    expect(confirmButtons.length).toBe(3);
    expect(rejectButtons.length).toBe(3);
    expect(correctButtons.length).toBe(3);

    // Buttons should be enabled for pending items
    confirmButtons.forEach((btn) => expect(btn).not.toBeDisabled());
    rejectButtons.forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it('calls onConfirm when confirm button is clicked', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    const confirmButtons = screen.getAllByText('确认');
    fireEvent.click(confirmButtons[0]);

    expect(defaultProps.onConfirm).toHaveBeenCalledWith('1');
  });

  it('calls onReject when reject button is clicked', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    const rejectButtons = screen.getAllByText('拒绝');
    fireEvent.click(rejectButtons[1]);

    expect(defaultProps.onReject).toHaveBeenCalledWith('2');
  });

  it('renders empty state when no data', () => {
    render(<SKUMappingTable {...defaultProps} data={[]} total={0} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('renders table headers including checkbox', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    expect(screen.getByText('渠道 SKU')).toBeInTheDocument();
    expect(screen.getByText('系统 SKU')).toBeInTheDocument();
    expect(screen.getByText('置信度')).toBeInTheDocument();
    expect(screen.getByText('差异点')).toBeInTheDocument();
    expect(screen.getByText('操作')).toBeInTheDocument();
    expect(screen.getByLabelText('全选')).toBeInTheDocument();
  });

  it('shows batch action bar when items are selected', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    // Initially no batch bar
    expect(screen.queryByText('批量确认')).not.toBeInTheDocument();

    // Select first item
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // first row checkbox (index 0 is select-all)

    expect(screen.getByText('已选择 1 项')).toBeInTheDocument();
    expect(screen.getByText('批量确认')).toBeInTheDocument();
    expect(screen.getByText('批量拒绝')).toBeInTheDocument();
  });

  it('select all checkbox selects all rows', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    const selectAll = screen.getByLabelText('全选');
    fireEvent.click(selectAll);

    expect(screen.getByText('已选择 3 项')).toBeInTheDocument();
  });

  it('calls onBatchConfirm with selected ids', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    // Select all
    const selectAll = screen.getByLabelText('全选');
    fireEvent.click(selectAll);

    // Click batch confirm
    fireEvent.click(screen.getByText('批量确认'));

    expect(defaultProps.onBatchConfirm).toHaveBeenCalledWith(['1', '2', '3']);
  });

  it('calls onBatchReject with selected ids', () => {
    render(<SKUMappingTable {...defaultProps} />, { wrapper: createWrapper() });

    // Select first two
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);

    // Click batch reject
    fireEvent.click(screen.getByText('批量拒绝'));

    expect(defaultProps.onBatchReject).toHaveBeenCalledWith(
      expect.arrayContaining(['1', '2']),
    );
  });

  it('shows loading state on the row being processed', () => {
    render(<SKUMappingTable {...defaultProps} loadingId="1" />, {
      wrapper: createWrapper(),
    });

    // The loading row should show "..." instead of "确认"
    expect(screen.getByText('...')).toBeInTheDocument();
  });

  it('disables buttons for non-pending items', () => {
    const dataWithConfirmed: SKUMappingItem[] = [
      {
        ...mockData[0],
        status: 'confirmed',
      },
    ];

    render(<SKUMappingTable {...defaultProps} data={dataWithConfirmed} />, {
      wrapper: createWrapper(),
    });

    const confirmBtn = screen.getByText('确认');
    expect(confirmBtn).toBeDisabled();
  });
});
