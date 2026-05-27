import { useEffect, useRef, useCallback } from 'react';
import { useOnboardingStore, type AgentMessage } from '@/stores/onboarding-store';

export interface WebSocketMessage {
  type: 'step_help' | 'validation_update' | 'agent_suggestion';
  content: string;
  step?: string;
  id?: string;
  timestamp?: string;
}

export interface UseOnboardingWsOptions {
  /** Session ID to connect to */
  sessionId: string | null;
  /** Whether the connection is enabled (default: true) */
  enabled?: boolean;
  /** Base URL for WebSocket (default: auto-detect from window.location) */
  baseUrl?: string;
  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseDelay?: number;
}

export interface UseOnboardingWsReturn {
  /** Whether the WebSocket is currently connected */
  isConnected: boolean;
  /** Number of reconnection attempts made */
  reconnectAttempts: number;
}

/**
 * Calculate exponential backoff delay.
 * delay = baseDelay * 2^(attempt - 1), capped at 30s
 */
export function calculateBackoff(attempt: number, baseDelay: number): number {
  const delay = baseDelay * Math.pow(2, attempt - 1);
  return Math.min(delay, 30000);
}

/**
 * Build the WebSocket URL for an onboarding session.
 */
export function buildWsUrl(sessionId: string, baseUrl?: string): string {
  if (baseUrl) {
    return `${baseUrl}/ws/onboarding/${sessionId}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws/onboarding/${sessionId}`;
}

/**
 * Parse an incoming WebSocket message into an AgentMessage.
 * Returns null if the message is invalid.
 */
export function parseWsMessage(rawData: string): AgentMessage | null {
  try {
    const parsed: WebSocketMessage = JSON.parse(rawData);
    if (!parsed.type || !parsed.content) {
      return null;
    }
    const validTypes = ['step_help', 'validation_update', 'agent_suggestion'];
    if (!validTypes.includes(parsed.type)) {
      return null;
    }
    return {
      id: parsed.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: parsed.type,
      content: parsed.content,
      step: parsed.step as AgentMessage['step'],
      timestamp: parsed.timestamp ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function useOnboardingWs(options: UseOnboardingWsOptions): UseOnboardingWsReturn {
  const {
    sessionId,
    enabled = true,
    baseUrl,
    maxReconnectAttempts = 5,
    baseDelay = 1000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(false);
  const mountedRef = useRef(true);

  const addAgentMessage = useOnboardingStore((state) => state.addAgentMessage);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    isConnectedRef.current = false;
  }, []);

  const connect = useCallback(() => {
    if (!sessionId || !enabled || !mountedRef.current) return;

    cleanup();

    const url = buildWsUrl(sessionId, baseUrl);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      isConnectedRef.current = true;
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      const message = parseWsMessage(event.data as string);
      if (message) {
        addAgentMessage(message);
      }
    };

    ws.onerror = () => {
      // Error handling is done in onclose
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      isConnectedRef.current = false;

      // Attempt reconnection with exponential backoff
      if (reconnectAttemptsRef.current < maxReconnectAttempts && enabled) {
        reconnectAttemptsRef.current += 1;
        const delay = calculateBackoff(reconnectAttemptsRef.current, baseDelay);
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) {
            connect();
          }
        }, delay);
      }
    };
  }, [sessionId, enabled, baseUrl, maxReconnectAttempts, baseDelay, addAgentMessage, cleanup]);

  useEffect(() => {
    mountedRef.current = true;

    if (sessionId && enabled) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [sessionId, enabled, connect, cleanup]);

  return {
    isConnected: isConnectedRef.current,
    reconnectAttempts: reconnectAttemptsRef.current,
  };
}
