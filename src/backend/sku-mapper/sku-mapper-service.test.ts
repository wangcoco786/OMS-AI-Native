import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SKUMapperService } from './sku-mapper-service.js';
import type { LLMGateway, LLMRequest, LLMResponse } from '../../infrastructure/llm/types.js';
import type { PostgresDatabaseService } from '../../infrastructure/database/database-service.js';
import type { ChannelSKU, SystemSKU } from '../../shared/m2-types.js';

// Mock pino
vi.mock('pino', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { default: vi.fn(() => mockLogger) };
});

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substring(7)),
}));

function createMockLLMGateway(): LLMGateway {
  return {
    complete: vi.fn(),
    stream: vi.fn(),
    getUsage: vi.fn(),
  } as unknown as LLMGateway;
}

function createMockDb(): PostgresDatabaseService {
  const mockTx = {
    query: vi.fn().mockResolvedValue([]),
    client: {},
  };
  return {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (fn) => fn(mockTx)),
  } as unknown as PostgresDatabaseService;
}

function createChannelSku(overrides?: Partial<ChannelSKU>): ChannelSKU {
  return {
    id: 'csku-1',
    channelId: 'shopify-1',
    externalId: 'ext-001',
    name: 'Blue Cotton T-Shirt Size M',
    attributes: { color: 'blue', size: 'M', material: 'cotton' },
    price: 29.99,
    ...overrides,
  };
}

function createSystemSku(overrides?: Partial<SystemSKU>): SystemSKU {
  return {
    id: 'ssku-1',
    tenantId: 'tenant-1',
    sku: 'TSH-BLU-M',
    name: 'T-Shirt Blue Medium',
    attributes: { color: 'blue', size: 'medium', material: 'cotton' },
    category: 'apparel',
    status: 'active',
    ...overrides,
  };
}

function createLLMResponse(results: unknown[]): LLMResponse {
  return {
    id: 'resp-1',
    content: [{ type: 'text', text: JSON.stringify(results) }],
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: 'end_turn',
  };
}

describe('SKUMapperService', () => {
  let service: SKUMapperService;
  let mockGateway: LLMGateway;
  let mockDb: PostgresDatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGateway = createMockLLMGateway();
    mockDb = createMockDb();
    service = new SKUMapperService(mockGateway, mockDb);
  });

  describe('buildMatchPrompt', () => {
    it('should format channel SKUs and system SKUs into a structured prompt', () => {
      const channelSkus = [createChannelSku()];
      const systemSkus = [createSystemSku()];

      const prompt = service.buildMatchPrompt(channelSkus, systemSkus);

      expect(prompt).toContain('Channel SKUs to match');
      expect(prompt).toContain('Available System SKUs');
      expect(prompt).toContain('Blue Cotton T-Shirt Size M');
      expect(prompt).toContain('T-Shirt Blue Medium');
      expect(prompt).toContain('"color": "blue"');
    });

    it('should include price for channel SKUs when available', () => {
      const channelSkus = [createChannelSku({ price: 49.99 })];
      const systemSkus = [createSystemSku()];

      const prompt = service.buildMatchPrompt(channelSkus, systemSkus);

      expect(prompt).toContain('49.99');
    });

    it('should handle missing optional fields gracefully', () => {
      const channelSkus = [createChannelSku({ description: undefined, price: undefined })];
      const systemSkus = [createSystemSku({ description: undefined, category: undefined })];

      const prompt = service.buildMatchPrompt(channelSkus, systemSkus);

      expect(prompt).toContain('"description": ""');
      expect(prompt).toContain('"category": ""');
    });
  });

  describe('parseLLMResponse', () => {
    it('should parse a valid JSON array response', () => {
      const response = createLLMResponse([
        {
          channelSkuId: 'csku-1',
          systemSkuId: 'ssku-1',
          confidence: 92,
          reasoning: 'Strong name and attribute match',
          differencePoints: ['Size notation differs'],
        },
      ]);

      const results = service.parseLLMResponse(response);

      expect(results).toHaveLength(1);
      expect(results[0].channelSkuId).toBe('csku-1');
      expect(results[0].systemSkuId).toBe('ssku-1');
      expect(results[0].confidence).toBe(92);
      expect(results[0].reasoning).toBe('Strong name and attribute match');
      expect(results[0].differencePoints).toEqual(['Size notation differs']);
    });

    it('should parse JSON wrapped in markdown code blocks', () => {
      const response: LLMResponse = {
        id: 'resp-1',
        content: [
          {
            type: 'text',
            text: '```json\n[{"channelSkuId":"csku-1","systemSkuId":"ssku-1","confidence":88,"reasoning":"Match found"}]\n```',
          },
        ],
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      };

      const results = service.parseLLMResponse(response);

      expect(results).toHaveLength(1);
      expect(results[0].confidence).toBe(88);
    });

    it('should clamp confidence to 0-100 range', () => {
      const response = createLLMResponse([
        { channelSkuId: 'csku-1', systemSkuId: 'ssku-1', confidence: 150, reasoning: 'test' },
        { channelSkuId: 'csku-2', systemSkuId: 'ssku-2', confidence: -10, reasoning: 'test' },
      ]);

      const results = service.parseLLMResponse(response);

      expect(results[0].confidence).toBe(100);
      expect(results[1].confidence).toBe(0);
    });

    it('should return empty array for non-text response', () => {
      const response: LLMResponse = {
        id: 'resp-1',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'test', input: {} }],
        usage: { inputTokens: 100, outputTokens: 50 },
        stopReason: 'end_turn',
      };

      const results = service.parseLLMResponse(response);

      expect(results).toEqual([]);
    });

    it('should filter out entries with empty channelSkuId', () => {
      const response = createLLMResponse([
        { channelSkuId: '', systemSkuId: 'ssku-1', confidence: 90, reasoning: 'test' },
        { channelSkuId: 'csku-1', systemSkuId: 'ssku-1', confidence: 90, reasoning: 'test' },
      ]);

      const results = service.parseLLMResponse(response);

      expect(results).toHaveLength(1);
      expect(results[0].channelSkuId).toBe('csku-1');
    });
  });

  describe('classifyResult', () => {
    it('should classify confidence >= 85 as high_confidence', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: 'ssku-1',
        confidence: 92,
        reasoning: 'Strong match',
      });

      expect(result.matchType).toBe('high_confidence');
      expect(result.confidence).toBe(92);
      expect(result.systemSkuId).toBe('ssku-1');
      expect(result.suggestNewSku).toBeUndefined();
    });

    it('should classify confidence exactly 85 as high_confidence', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: 'ssku-1',
        confidence: 85,
        reasoning: 'Threshold match',
      });

      expect(result.matchType).toBe('high_confidence');
    });

    it('should classify 0 < confidence < 85 as needs_review with differencePoints', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: 'ssku-1',
        confidence: 60,
        reasoning: 'Partial match',
        differencePoints: ['Color differs', 'Size notation varies'],
      });

      expect(result.matchType).toBe('needs_review');
      expect(result.confidence).toBe(60);
      expect(result.differencePoints).toEqual(['Color differs', 'Size notation varies']);
      expect(result.suggestNewSku).toBeUndefined();
    });

    it('should provide default differencePoints when needs_review has none', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: 'ssku-1',
        confidence: 50,
        reasoning: 'Partial match',
      });

      expect(result.matchType).toBe('needs_review');
      expect(result.differencePoints).toEqual(['Confidence below threshold']);
    });

    it('should classify confidence = 0 as no_match with suggestNewSku', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: null,
        confidence: 0,
        reasoning: 'No match found',
      });

      expect(result.matchType).toBe('no_match');
      expect(result.confidence).toBe(0);
      expect(result.systemSkuId).toBeNull();
      expect(result.suggestNewSku).toBe(true);
    });

    it('should classify null systemSkuId as no_match regardless of confidence', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: null,
        confidence: 75,
        reasoning: 'No suitable match',
      });

      expect(result.matchType).toBe('no_match');
      expect(result.confidence).toBe(0);
      expect(result.suggestNewSku).toBe(true);
    });

    it('should use custom confidence threshold from options', () => {
      const result = service.classifyResult(
        {
          channelSkuId: 'csku-1',
          systemSkuId: 'ssku-1',
          confidence: 80,
          reasoning: 'Good match',
        },
        { confidenceThreshold: 75 },
      );

      expect(result.matchType).toBe('high_confidence');
    });

    it('should classify confidence 1 as needs_review', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: 'ssku-1',
        confidence: 1,
        reasoning: 'Very weak match',
      });

      expect(result.matchType).toBe('needs_review');
    });

    it('should classify confidence 84 as needs_review', () => {
      const result = service.classifyResult({
        channelSkuId: 'csku-1',
        systemSkuId: 'ssku-1',
        confidence: 84,
        reasoning: 'Close to threshold',
      });

      expect(result.matchType).toBe('needs_review');
    });
  });

  describe('matchSingle', () => {
    it('should return no_match when no system SKUs exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const channelSku = createChannelSku();
      const result = await service.matchSingle('tenant-1', channelSku);

      expect(result.matchType).toBe('no_match');
      expect(result.suggestNewSku).toBe(true);
      expect(result.channelSkuId).toBe('csku-1');
    });

    it('should call LLM and return classified result', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ssku-1',
          tenant_id: 'tenant-1',
          sku: 'TSH-BLU-M',
          name: 'T-Shirt Blue Medium',
          description: null,
          attributes: { color: 'blue', size: 'medium' },
          category: 'apparel',
          status: 'active',
        },
      ]);

      (mockGateway.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createLLMResponse([
          {
            channelSkuId: 'csku-1',
            systemSkuId: 'ssku-1',
            confidence: 92,
            reasoning: 'Strong match on name and attributes',
          },
        ]),
      );

      const channelSku = createChannelSku();
      const result = await service.matchSingle('tenant-1', channelSku);

      expect(result.matchType).toBe('high_confidence');
      expect(result.confidence).toBe(92);
      expect(result.systemSkuId).toBe('ssku-1');
      expect(mockGateway.complete).toHaveBeenCalledTimes(1);
    });

    it('should persist the match result', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ssku-1',
          tenant_id: 'tenant-1',
          sku: 'TSH-BLU-M',
          name: 'T-Shirt Blue Medium',
          description: null,
          attributes: { color: 'blue' },
          category: null,
          status: 'active',
        },
      ]);

      (mockGateway.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createLLMResponse([
          {
            channelSkuId: 'csku-1',
            systemSkuId: 'ssku-1',
            confidence: 90,
            reasoning: 'Match',
          },
        ]),
      );

      await service.matchSingle('tenant-1', createChannelSku());

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('batchMatch', () => {
    it('should process multiple SKUs in batches', async () => {
      const channelSkus = [
        createChannelSku({ id: 'csku-1', name: 'Product A' }),
        createChannelSku({ id: 'csku-2', name: 'Product B' }),
        createChannelSku({ id: 'csku-3', name: 'Product C' }),
      ];

      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ssku-1',
          tenant_id: 'tenant-1',
          sku: 'PROD-A',
          name: 'Product A System',
          description: null,
          attributes: {},
          category: null,
          status: 'active',
        },
      ]);

      (mockGateway.complete as ReturnType<typeof vi.fn>).mockResolvedValue(
        createLLMResponse([
          { channelSkuId: 'csku-1', systemSkuId: 'ssku-1', confidence: 95, reasoning: 'Match A' },
          { channelSkuId: 'csku-2', systemSkuId: 'ssku-1', confidence: 40, reasoning: 'Partial B' },
          { channelSkuId: 'csku-3', systemSkuId: null, confidence: 0, reasoning: 'No match C' },
        ]),
      );

      const results = await service.batchMatch('tenant-1', channelSkus, { batchSize: 10 });

      expect(results).toHaveLength(3);
      expect(results[0].matchType).toBe('high_confidence');
      expect(results[1].matchType).toBe('needs_review');
      expect(results[2].matchType).toBe('no_match');
      expect(results[2].suggestNewSku).toBe(true);
    });

    it('should split into multiple LLM calls when batch exceeds batchSize', async () => {
      const channelSkus = Array.from({ length: 5 }, (_, i) =>
        createChannelSku({ id: `csku-${i}`, name: `Product ${i}` }),
      );

      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ssku-1',
          tenant_id: 'tenant-1',
          sku: 'PROD',
          name: 'Product',
          description: null,
          attributes: {},
          category: null,
          status: 'active',
        },
      ]);

      (mockGateway.complete as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(
          createLLMResponse([
            { channelSkuId: 'csku-0', systemSkuId: 'ssku-1', confidence: 90, reasoning: 'Match' },
            { channelSkuId: 'csku-1', systemSkuId: 'ssku-1', confidence: 90, reasoning: 'Match' },
          ]),
        )
        .mockResolvedValueOnce(
          createLLMResponse([
            { channelSkuId: 'csku-2', systemSkuId: 'ssku-1', confidence: 90, reasoning: 'Match' },
            { channelSkuId: 'csku-3', systemSkuId: 'ssku-1', confidence: 90, reasoning: 'Match' },
          ]),
        )
        .mockResolvedValueOnce(
          createLLMResponse([
            { channelSkuId: 'csku-4', systemSkuId: 'ssku-1', confidence: 90, reasoning: 'Match' },
          ]),
        );

      const results = await service.batchMatch('tenant-1', channelSkus, { batchSize: 2 });

      expect(results).toHaveLength(5);
      expect(mockGateway.complete).toHaveBeenCalledTimes(3);
    });

    it('should return no_match for all SKUs when no system SKUs exist', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const channelSkus = [
        createChannelSku({ id: 'csku-1' }),
        createChannelSku({ id: 'csku-2' }),
      ];

      const results = await service.batchMatch('tenant-1', channelSkus);

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.matchType === 'no_match')).toBe(true);
      expect(results.every((r) => r.suggestNewSku === true)).toBe(true);
      expect(mockGateway.complete).not.toHaveBeenCalled();
    });

    it('should return no_match for all SKUs when LLM call fails', async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: 'ssku-1',
          tenant_id: 'tenant-1',
          sku: 'PROD',
          name: 'Product',
          description: null,
          attributes: {},
          category: null,
          status: 'active',
        },
      ]);

      (mockGateway.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('LLM service unavailable'),
      );

      const channelSkus = [createChannelSku({ id: 'csku-1' })];
      const results = await service.batchMatch('tenant-1', channelSkus);

      expect(results).toHaveLength(1);
      expect(results[0].matchType).toBe('no_match');
    });
  });

  describe('confirmMatch', () => {
    it('should update status to confirmed when confirmed=true', async () => {
      const mockTx = { query: vi.fn().mockResolvedValue([]), client: {} };
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => fn(mockTx));

      await service.confirmMatch('mapping-1', true);

      expect(mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'confirmed'"),
        ['mapping-1'],
      );
    });

    it('should update status to rejected when confirmed=false without correctedSkuId', async () => {
      const mockTx = { query: vi.fn().mockResolvedValue([]), client: {} };
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => fn(mockTx));

      await service.confirmMatch('mapping-1', false);

      expect(mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'rejected'"),
        ['mapping-1'],
      );
    });

    it('should update with corrected SKU and record correction when correctedSkuId provided', async () => {
      const mockTx = {
        query: vi.fn()
          .mockResolvedValueOnce([]) // UPDATE sku_mappings
          .mockResolvedValueOnce([{ // SELECT mapping
            id: 'mapping-1',
            tenant_id: 'tenant-1',
            channel_sku_id: 'csku-1',
            system_sku_id: 'ssku-old',
            confirmed_by: 'user-1',
          }])
          .mockResolvedValueOnce([]), // INSERT correction
        client: {},
      };
      (mockDb.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => fn(mockTx));

      await service.confirmMatch('mapping-1', false, 'ssku-corrected');

      // Should update the mapping
      expect(mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'corrected'"),
        ['mapping-1', 'ssku-corrected'],
      );

      // Should insert a correction record
      expect(mockTx.query).toHaveBeenCalledWith(
        expect.stringContaining('sku_mapping_corrections'),
        expect.arrayContaining(['mapping-1', 'ssku-old', 'ssku-corrected']),
      );
    });
  });
});
