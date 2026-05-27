import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  MappingsParams,
  MappingsResponse,
  MappingStatsData,
  ConfirmMappingPayload,
  BatchConfirmPayload,
  BatchConfirmResponse,
  SystemSKUSearchResponse,
  ImportResult,
} from '@/pages/sku-mapping/types';

const QUERY_KEYS = {
  mappings: (params: MappingsParams) => ['sku-mapping', 'mappings', params] as const,
  stats: () => ['sku-mapping', 'stats'] as const,
  systemSkus: (search: string) => ['sku-mapping', 'system-skus', search] as const,
};

export function useGetMappings(params: MappingsParams) {
  const queryParams: Record<string, string> = {};
  if (params.page != null) queryParams.page = String(params.page);
  if (params.pageSize != null) queryParams.pageSize = String(params.pageSize);
  if (params.matchType) queryParams.matchType = params.matchType;
  if (params.status) queryParams.status = params.status;
  if (params.search) queryParams.search = params.search;

  return useQuery({
    queryKey: QUERY_KEYS.mappings(params),
    queryFn: () => apiClient.get<MappingsResponse>('/sku-mapper/mappings', queryParams),
  });
}

export function useGetMappingStats() {
  return useQuery({
    queryKey: QUERY_KEYS.stats(),
    queryFn: () => apiClient.get<MappingStatsData>('/sku-mapper/stats'),
  });
}

export function useConfirmMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ConfirmMappingPayload }) =>
      apiClient.put<void>(`/sku-mapper/mappings/${id}/confirm`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sku-mapping'] });
    },
  });
}

export function useBatchConfirm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: BatchConfirmPayload) =>
      apiClient.post<BatchConfirmResponse>('/sku-mapper/batch-confirm', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sku-mapping'] });
    },
  });
}

export function useSearchSystemSkus(search: string) {
  return useQuery({
    queryKey: QUERY_KEYS.systemSkus(search),
    queryFn: () =>
      apiClient.get<SystemSKUSearchResponse>('/sku-mapper/system-skus', { search }),
    enabled: search.length >= 1,
  });
}

export function useImportCSV() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      return fetch('/api/sku-mapper/import', {
        method: 'POST',
        body: formData,
      }).then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || `Import failed with status ${response.status}`);
        }
        return response.json() as Promise<ImportResult>;
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sku-mapping'] });
    },
  });
}
