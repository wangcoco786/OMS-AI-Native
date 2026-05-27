import { create } from 'zustand';

export type OnboardingStep =
  | 'channel_connection'
  | 'basic_config'
  | 'sku_mapping'
  | 'rule_setup'
  | 'validation';

export type SessionStatus = 'idle' | 'in_progress' | 'completed' | 'abandoned';

export interface StepData {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  data: Record<string, unknown>;
  completedAt?: string;
  validationErrors?: Array<{ field: string; message: string }>;
}

export interface AgentMessage {
  id: string;
  type: 'step_help' | 'validation_update' | 'agent_suggestion';
  content: string;
  step?: OnboardingStep;
  timestamp: string;
}

export interface OnboardingState {
  sessionId: string | null;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  stepData: Record<OnboardingStep, StepData>;
  status: SessionStatus;
  isLoading: boolean;
  error: string | null;
  agentMessages: AgentMessage[];
}

export interface OnboardingActions {
  setSession: (sessionId: string, data?: Partial<OnboardingState>) => void;
  setCurrentStep: (step: OnboardingStep) => void;
  setStepData: (step: OnboardingStep, data: Record<string, unknown>) => void;
  markStepCompleted: (step: OnboardingStep) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  addAgentMessage: (message: AgentMessage) => void;
  clearAgentMessages: () => void;
  restoreSession: (state: {
    sessionId: string;
    currentStep: OnboardingStep;
    completedSteps: OnboardingStep[];
    stepData: Record<string, unknown>;
    status: string;
  }) => void;
  reset: () => void;
}

const STEPS: OnboardingStep[] = [
  'channel_connection',
  'basic_config',
  'sku_mapping',
  'rule_setup',
  'validation',
];

const SESSION_STORAGE_KEY = 'onboarding_session_id';

function createInitialStepData(): Record<OnboardingStep, StepData> {
  return {
    channel_connection: { status: 'pending', data: {} },
    basic_config: { status: 'pending', data: {} },
    sku_mapping: { status: 'pending', data: {} },
    rule_setup: { status: 'pending', data: {} },
    validation: { status: 'pending', data: {} },
  };
}

const initialState: OnboardingState = {
  sessionId: null,
  currentStep: 'channel_connection',
  completedSteps: [],
  stepData: createInitialStepData(),
  status: 'idle',
  isLoading: false,
  error: null,
  agentMessages: [],
};

/** Persist sessionId to localStorage */
function persistSessionId(sessionId: string | null): void {
  try {
    if (sessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable in some environments
  }
}

/** Read persisted sessionId from localStorage */
export function getPersistedSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Clear persisted sessionId from localStorage */
export function clearPersistedSessionId(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // noop
  }
}

export const useOnboardingStore = create<OnboardingState & OnboardingActions>((set) => ({
  ...initialState,

  setSession: (sessionId, data) => {
    persistSessionId(sessionId);
    set((state) => ({
      ...state,
      sessionId,
      status: 'in_progress',
      ...(data ?? {}),
    }));
  },

  setCurrentStep: (step) =>
    set((state) => ({
      ...state,
      currentStep: step,
      stepData: {
        ...state.stepData,
        [step]: { ...state.stepData[step], status: 'in_progress' },
      },
    })),

  setStepData: (step, data) =>
    set((state) => ({
      ...state,
      stepData: {
        ...state.stepData,
        [step]: { ...state.stepData[step], data },
      },
    })),

  markStepCompleted: (step) =>
    set((state) => {
      const completedSteps = state.completedSteps.includes(step)
        ? state.completedSteps
        : [...state.completedSteps, step];

      return {
        ...state,
        completedSteps,
        stepData: {
          ...state.stepData,
          [step]: {
            ...state.stepData[step],
            status: 'completed',
            completedAt: new Date().toISOString(),
          },
        },
      };
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  addAgentMessage: (message) =>
    set((state) => ({
      agentMessages: [...state.agentMessages, message],
    })),

  clearAgentMessages: () => set({ agentMessages: [] }),

  restoreSession: (sessionState) => {
    const stepData = createInitialStepData();
    // Merge remote stepData into local structure
    if (sessionState.stepData) {
      for (const key of STEPS) {
        if (sessionState.stepData[key]) {
          const remote = sessionState.stepData[key] as Partial<StepData>;
          stepData[key] = {
            status: remote.status ?? stepData[key].status,
            data: remote.data ?? stepData[key].data,
            completedAt: remote.completedAt,
            validationErrors: remote.validationErrors,
          };
        }
      }
    }
    // Mark completed steps in stepData
    for (const step of sessionState.completedSteps) {
      if (stepData[step].status === 'pending') {
        stepData[step].status = 'completed';
      }
    }

    persistSessionId(sessionState.sessionId);
    set({
      sessionId: sessionState.sessionId,
      currentStep: sessionState.currentStep,
      completedSteps: sessionState.completedSteps,
      stepData,
      status: sessionState.status === 'completed' ? 'completed' : 'in_progress',
      isLoading: false,
      error: null,
    });
  },

  reset: () => {
    persistSessionId(null);
    set(initialState);
  },
}));

export { STEPS, SESSION_STORAGE_KEY };
