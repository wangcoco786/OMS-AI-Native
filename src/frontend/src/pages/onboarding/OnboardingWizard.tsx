import { useEffect, type ReactNode } from 'react';
import { StepProgress } from '@/components/common';
import { LoadingSpinner } from '@/components/common';
import {
  useOnboardingStore,
  STEPS,
  type OnboardingStep,
  getPersistedSessionId,
  clearPersistedSessionId,
} from '@/stores/onboarding-store';
import { useCreateSession, useGetSession, useSubmitStep, useGoBack } from '@/hooks/use-onboarding';
import { useOnboardingWs } from '@/hooks/use-onboarding-ws';
import {
  ChannelConnectionStep,
  BasicConfigStep,
  SKUMappingStep,
  RuleSetupStep,
  ValidationStep,
} from './steps';
import styles from './OnboardingWizard.module.css';

const STEP_LABELS: Record<OnboardingStep, string> = {
  channel_connection: '渠道连接',
  basic_config: '基础配置',
  sku_mapping: 'SKU 映射',
  rule_setup: '规则配置',
  validation: '验证上线',
};

function StepContent({ step }: { step: OnboardingStep }): ReactNode {
  switch (step) {
    case 'channel_connection':
      return <ChannelConnectionStep />;
    case 'basic_config':
      return <BasicConfigStep />;
    case 'sku_mapping':
      return <SKUMappingStep />;
    case 'rule_setup':
      return <RuleSetupStep />;
    case 'validation':
      return <ValidationStep />;
  }
}

export function OnboardingWizard(): ReactNode {
  const {
    sessionId,
    currentStep,
    completedSteps,
    status,
    isLoading,
    error,
    agentMessages,
    setSession,
    setCurrentStep,
    markStepCompleted,
    setLoading,
    setError,
    restoreSession,
    reset,
  } = useOnboardingStore();

  const createSession = useCreateSession();

  // Try to restore session from localStorage on initial load
  const persistedSessionId = !sessionId && status === 'idle' ? getPersistedSessionId() : null;
  const sessionIdToFetch = sessionId ?? persistedSessionId;

  const { data: sessionData, error: sessionFetchError } = useGetSession(sessionIdToFetch);
  const submitStep = useSubmitStep(sessionId);
  const goBack = useGoBack(sessionId);

  // Connect WebSocket for agent feedback
  useOnboardingWs({
    sessionId,
    enabled: !!sessionId && status === 'in_progress',
  });

  // Restore session from API when we have a persisted sessionId
  useEffect(() => {
    if (persistedSessionId && sessionData && !sessionId) {
      // Session found on server - restore it
      restoreSession({
        sessionId: sessionData.id,
        currentStep: sessionData.currentStep,
        completedSteps: sessionData.completedSteps,
        stepData: sessionData.stepData as Record<string, unknown>,
        status: sessionData.status,
      });
    }
  }, [persistedSessionId, sessionData, sessionId, restoreSession]);

  // Handle case where persisted session is expired/not found
  useEffect(() => {
    if (persistedSessionId && sessionFetchError && !sessionId) {
      clearPersistedSessionId();
      // Will trigger new session creation below
    }
  }, [persistedSessionId, sessionFetchError, sessionId]);

  // Create session on mount if no active session and no persisted session
  useEffect(() => {
    if (!sessionId && status === 'idle' && !persistedSessionId) {
      handleCreateSession();
    }
  }, [sessionId, status, persistedSessionId]);

  // Sync remote session data into store (for ongoing session updates)
  useEffect(() => {
    if (sessionData && sessionId) {
      setSession(sessionData.id, {
        currentStep: sessionData.currentStep,
        completedSteps: sessionData.completedSteps,
        status: sessionData.status === 'in_progress' ? 'in_progress' : 'completed',
      });
    }
  }, [sessionData, sessionId]);

  async function handleCreateSession() {
    setLoading(true);
    setError(null);
    try {
      const session = await createSession.mutateAsync({
        tenantId: 'default',
        shopId: 'new-shop',
      });
      setSession(session.id);
      setCurrentStep(session.currentStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建会话失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    setLoading(true);
    setError(null);
    try {
      const result = await submitStep.mutateAsync({
        step: currentStep,
        data: {},
      });
      if (result.success) {
        markStepCompleted(currentStep);
        if (result.nextStep) {
          setCurrentStep(result.nextStep);
        }
      } else if (result.errors?.length) {
        setError(result.errors.map((e) => e.message).join('; '));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交步骤失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleBack() {
    setLoading(true);
    setError(null);
    try {
      const session = await goBack.mutateAsync();
      // goBack returns the full session state - data is preserved server-side
      setCurrentStep(session.currentStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : '回退失败');
    } finally {
      setLoading(false);
    }
  }

  function handleStepClick(stepIndex: number) {
    const targetStep = STEPS[stepIndex];
    if (!targetStep) return;
    // Only allow jumping to completed steps
    if (!completedSteps.includes(targetStep)) return;
    // Navigate to the step - data is preserved in the store
    setCurrentStep(targetStep);
    setError(null);
  }

  const currentStepIndex = STEPS.indexOf(currentStep);
  const completedIndices = completedSteps.map((s) => STEPS.indexOf(s));
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === STEPS.length - 1;

  if (isLoading && !sessionId) {
    return (
      <div className={styles.loadingContainer}>
        <LoadingSpinner size="lg" />
        <p>正在初始化引导会话...</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>店铺接入向导</h1>
      </header>

      <div className={styles.progress}>
        <StepProgress
          steps={STEPS.map((s) => STEP_LABELS[s])}
          currentStep={currentStepIndex}
          completedSteps={completedIndices}
          onStepClick={handleStepClick}
        />
      </div>

      <main className={styles.content}>
        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        <StepContent step={currentStep} />

        {agentMessages.length > 0 && (
          <aside className={styles.agentPanel} aria-label="AI 助手反馈">
            {agentMessages.slice(-3).map((msg) => (
              <div key={msg.id} className={`${styles.agentMessage} ${styles[msg.type]}`}>
                <span className={styles.agentMessageType}>
                  {msg.type === 'step_help' ? '💡 帮助' : msg.type === 'agent_suggestion' ? '🤖 建议' : '✅ 验证'}
                </span>
                <p className={styles.agentMessageContent}>{msg.content}</p>
              </div>
            ))}
          </aside>
        )}
      </main>

      <footer className={styles.actions}>
        <button
          className={styles.backButton}
          onClick={handleBack}
          disabled={isFirstStep || isLoading}
          type="button"
        >
          上一步
        </button>

        <button
          className={styles.nextButton}
          onClick={handleNext}
          disabled={isLoading}
          type="button"
        >
          {isLoading ? '处理中...' : isLastStep ? '完成' : '下一步'}
        </button>
      </footer>
    </div>
  );
}
