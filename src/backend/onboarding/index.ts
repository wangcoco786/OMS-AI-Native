/**
 * Onboarding Module
 *
 * AI-driven onboarding agent for guiding users through shop setup.
 * Exports all public APIs for the onboarding module.
 */

export { OnboardingSessionService, ONBOARDING_STEPS } from './session-service.js';
export type { SessionServiceDeps } from './session-service.js';

export { OnboardingStepEngine, getStepIndex, getNextStep, getPreviousStep } from './step-engine.js';
export type { StepEngineDeps } from './step-engine.js';

export { OnboardingAgent, ONBOARDING_AGENT_DEFINITION } from './onboarding-agent.js';
export type { OnboardingAgentDeps } from './onboarding-agent.js';

export { createOnboardingRouter } from './routes.js';
export type { OnboardingRouterDeps } from './routes.js';

export { createValidators } from './validators/index.js';
export type { StepValidator, StepValidationResult } from './validators/types.js';

export { ConfigurationValidator } from './config-validator.js';
export type { ConfigValidatorDeps } from './config-validator.js';

export { OrderFlowSimulator } from './order-flow-simulator.js';
export type { OrderFlowSimulatorDeps } from './order-flow-simulator.js';

export { OnboardingPipeline } from './onboarding-pipeline.js';
export type { OnboardingPipelineDeps } from './onboarding-pipeline.js';
