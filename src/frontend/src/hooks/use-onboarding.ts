import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { OnboardingStep } from '@/stores/onboarding-store';

export interface OnboardingSessionResponse {
  id: string;
  tenantId: string;
  userId: string;
  shopId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  stepData: Record<string, unknown>;
  status: string;
  interactionCount: number;
  startedAt: string;
  completedAt?: string;
}

export interface StepSubmitResponse {
  success: boolean;
  nextStep?: OnboardingStep;
  errors?: Array<{ field: string; message: string }>;
  suggestions?: string[];
}

export interface HelpContent {
  step: OnboardingStep;
  title: string;
  description: string;
  examples?: string[];
  tips?: string[];
}

const QUERY_KEYS = {
  session: (id: string) => ['onboarding', 'session', id] as const,
  help: (sessionId: string, step: OnboardingStep) =>
    ['onboarding', 'help', sessionId, step] as const,
};

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { tenantId: string; shopId: string }) =>
      apiClient.post<OnboardingSessionResponse>('/onboarding/sessions', params),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.session(data.id), data);
    },
  });
}

export function useGetSession(sessionId: string | null) {
  return useQuery({
    queryKey: QUERY_KEYS.session(sessionId ?? ''),
    queryFn: () =>
      apiClient.get<OnboardingSessionResponse>(`/onboarding/sessions/${sessionId}`),
    enabled: !!sessionId,
  });
}

export function useSubmitStep(sessionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { step: OnboardingStep; data: Record<string, unknown> }) =>
      apiClient.post<StepSubmitResponse>(
        `/onboarding/sessions/${sessionId}/steps/${params.step}`,
        params.data,
      ),
    onSuccess: () => {
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.session(sessionId) });
      }
    },
  });
}

export function useGoBack(sessionId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiClient.post<OnboardingSessionResponse>(
        `/onboarding/sessions/${sessionId}/back`,
      ),
    onSuccess: (data) => {
      if (sessionId) {
        queryClient.setQueryData(QUERY_KEYS.session(sessionId), data);
      }
    },
  });
}

export function useGetHelp(sessionId: string | null, step: OnboardingStep) {
  return useQuery({
    queryKey: QUERY_KEYS.help(sessionId ?? '', step),
    queryFn: () =>
      apiClient.get<HelpContent>(`/onboarding/sessions/${sessionId}/help/${step}`),
    enabled: !!sessionId,
  });
}
