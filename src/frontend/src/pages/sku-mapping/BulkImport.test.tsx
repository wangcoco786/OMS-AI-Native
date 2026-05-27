import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkImport } from './BulkImport';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('BulkImport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders upload area with instructions', () => {
    render(<BulkImport />, { wrapper: createWrapper() });

    expect(screen.getByText('批量导入渠道 SKU')).toBeInTheDocument();
    expect(
      screen.getByText('拖拽 CSV 文件到此处，或点击选择文件'),
    ).toBeInTheDocument();
    expect(screen.getByText('开始导入')).toBeInTheDocument();
  });

  it('disables upload button when no file is selected', () => {
    render(<BulkImport />, { wrapper: createWrapper() });

    const uploadBtn = screen.getByText('开始导入');
    expect(uploadBtn).toBeDisabled();
  });

  it('shows file name after selecting a file', () => {
    render(<BulkImport />, { wrapper: createWrapper() });

    const file = new File(['sku,name\nSKU1,Test'], 'test.csv', { type: 'text/csv' });
    const input = screen.getByLabelText('选择 CSV 文件');
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText('test.csv')).toBeInTheDocument();
  });

  it('enables upload button after file selection', () => {
    render(<BulkImport />, { wrapper: createWrapper() });

    const file = new File(['sku,name\nSKU1,Test'], 'test.csv', { type: 'text/csv' });
    const input = screen.getByLabelText('选择 CSV 文件');
    fireEvent.change(input, { target: { files: [file] } });

    const uploadBtn = screen.getByText('开始导入');
    expect(uploadBtn).not.toBeDisabled();
  });

  it('shows success results after successful import', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          totalRecords: 10,
          successCount: 8,
          errorCount: 2,
          errors: [
            { row: 3, message: '缺少必填字段' },
            { row: 7, message: 'SKU 格式无效' },
          ],
        }),
    });

    render(<BulkImport />, { wrapper: createWrapper() });

    const file = new File(['sku,name\nSKU1,Test'], 'test.csv', { type: 'text/csv' });
    const input = screen.getByLabelText('选择 CSV 文件');
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByText('开始导入'));

    await waitFor(() => {
      expect(screen.getByText('导入完成')).toBeInTheDocument();
    });

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/缺少必填字段/)).toBeInTheDocument();
    expect(screen.getByText(/SKU 格式无效/)).toBeInTheDocument();
  });

  it('shows error message on import failure', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: '文件格式不正确' }),
    });

    render(<BulkImport />, { wrapper: createWrapper() });

    const file = new File(['bad data'], 'bad.csv', { type: 'text/csv' });
    const input = screen.getByLabelText('选择 CSV 文件');
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByText('开始导入'));

    await waitFor(() => {
      expect(screen.getByText(/文件格式不正确/)).toBeInTheDocument();
    });
  });

  it('allows reset after successful import', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          totalRecords: 5,
          successCount: 5,
          errorCount: 0,
        }),
    });

    render(<BulkImport />, { wrapper: createWrapper() });

    const file = new File(['sku,name\nSKU1,Test'], 'test.csv', { type: 'text/csv' });
    const input = screen.getByLabelText('选择 CSV 文件');
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByText('开始导入'));

    await waitFor(() => {
      expect(screen.getByText('导入完成')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('重新导入'));

    expect(
      screen.getByText('拖拽 CSV 文件到此处，或点击选择文件'),
    ).toBeInTheDocument();
  });
});
