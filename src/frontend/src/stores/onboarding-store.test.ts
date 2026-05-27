import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOnboardingStore, getPersistedSessionId, clearPersistedSessionId, SESSION_STORAGE_KEY, STEPS } from './onboarding-store';

describe('onboarding-store', () => {
  beforeEach(() => {
    // Reset store to initial state
    useOnboardingStore.getState().reset();
    localStorage.clear();
  });

  describe('session persistence', () => {
    it('should persist sessionId to localStorage when setSession is called', () => {
      useOnboardingStore.getState().setSession('session-123');
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe('session-123');
    });

    it('should clear localStorage when reset is called', () => {
      useOnboardingStore.getState().setSession('session-123');
      useOnboardingStore.getState().reset();
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    });

    it('should read persisted sessionId from localStorage', () => {
      localStorage.setItem(SESSION_STORAGE_KEY, 'session-456');
      expect(getPersistedSessionId()).toBe('session-456');
    });

    it('should return null when no persisted sessionId exists', () => {
      expect(getPersistedSessionId()).toBeNull();
    });

    it('should clear persisted sessionId', () => {
      localStorage.setItem(SESSION_STORAGE_KEY, 'session-789');
      clearPersistedSessionId();
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    });
  });

  describe('restoreSession', () => {
    it('should restore full session state from API data', () => {
      useOnboardingStore.getState().restoreSession({
        sessionId: 'restored-session',
        currentStep: 'sku_mapping',
        completedSteps: ['channel_connection', 'basic_config'],
        stepData: {
          channel_connection: { status: 'completed', data: { platform: 'shopify' } },
          basic_config: { status: 'completed', data: { name: 'My Shop' } },
        },
        status: 'in_progress',
      });

      const state = useOnboardingStore.getState();
      expect(state.sessionId).toBe('restored-session');
      expect(state.currentStep).toBe('sku_mapping');
      expect(state.completedSteps).toEqual(['channel_connection', 'basic_config']);
      expect(state.status).toBe('in_progress');
      expect(state.stepData.channel_connection.data).toEqual({ platform: 'shopify' });
      expect(state.stepData.basic_config.data).toEqual({ name: 'My Shop' });
      expect(state.stepData.channel_connection.status).toBe('completed');
      expect(state.stepData.basic_config.status).toBe('completed');
    });

    it('should persist sessionId to localStorage on restore', () => {
      useOnboardingStore.getState().restoreSession({
        sessionId: 'restored-session',
        currentStep: 'channel_connection',
        completedSteps: [],
        stepData: {},
        status: 'in_progress',
      });

      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe('restored-session');
    });

    it('should handle completed session status', () => {
      useOnboardingStore.getState().restoreSession({
        sessionId: 'completed-session',
        currentStep: 'validation',
        completedSteps: ['channel_connection', 'basic_config', 'sku_mapping', 'rule_setup', 'validation'],
        stepData: {},
        status: 'completed',
      });

      const state = useOnboardingStore.getState();
      expect(state.status).toBe('completed');
    });

    it('should mark completed steps in stepData even if not explicitly set', () => {
      useOnboardingStore.getState().restoreSession({
        sessionId: 'session-1',
        currentStep: 'basic_config',
        completedSteps: ['channel_connection'],
        stepData: {},
        status: 'in_progress',
      });

      const state = useOnboardingStore.getState();
      expect(state.stepData.channel_connection.status).toBe('completed');
    });

    it('should clear error and loading state on restore', () => {
      useOnboardingStore.setState({ error: 'some error', isLoading: true });
      useOnboardingStore.getState().restoreSession({
        sessionId: 'session-1',
        currentStep: 'channel_connection',
        completedSteps: [],
        stepData: {},
        status: 'in_progress',
      });

      const state = useOnboardingStore.getState();
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });

  describe('step navigation with data preservation', () => {
    it('should preserve step data when navigating between steps', () => {
      const store = useOnboardingStore.getState();
      store.setSession('session-1');
      store.setStepData('channel_connection', { platform: 'shopify', apiKey: 'key123' });
      store.markStepCompleted('channel_connection');
      store.setCurrentStep('basic_config');
      store.setStepData('basic_config', { name: 'Test Shop' });

      // Navigate back to channel_connection
      store.setCurrentStep('channel_connection');

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe('channel_connection');
      expect(state.stepData.channel_connection.data).toEqual({ platform: 'shopify', apiKey: 'key123' });
      expect(state.stepData.basic_config.data).toEqual({ name: 'Test Shop' });
    });

    it('should not lose completed steps when navigating back', () => {
      const store = useOnboardingStore.getState();
      store.setSession('session-1');
      store.markStepCompleted('channel_connection');
      store.markStepCompleted('basic_config');
      store.setCurrentStep('channel_connection');

      const state = useOnboardingStore.getState();
      expect(state.completedSteps).toContain('channel_connection');
      expect(state.completedSteps).toContain('basic_config');
    });
  });

  describe('agent messages', () => {
    it('should add agent messages', () => {
      useOnboardingStore.getState().addAgentMessage({
        id: 'msg-1',
        type: 'step_help',
        content: 'Here is some help',
        step: 'channel_connection',
        timestamp: '2024-01-01T00:00:00Z',
      });

      const state = useOnboardingStore.getState();
      expect(state.agentMessages).toHaveLength(1);
      expect(state.agentMessages[0].content).toBe('Here is some help');
    });

    it('should clear agent messages', () => {
      useOnboardingStore.getState().addAgentMessage({
        id: 'msg-1',
        type: 'step_help',
        content: 'Help text',
        timestamp: '2024-01-01T00:00:00Z',
      });
      useOnboardingStore.getState().clearAgentMessages();

      const state = useOnboardingStore.getState();
      expect(state.agentMessages).toHaveLength(0);
    });
  });
});
