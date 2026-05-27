/**
 * Message Broker Service
 *
 * RabbitMQ-based async messaging with support for
 * point-to-point and publish/subscribe patterns.
 */

export { MessageBrokerService } from './message-broker.js';
export {
  RetryHandler,
  calculateBackoffDelay,
  getRetryCount,
  DEFAULT_RETRY_CONFIG,
} from './retry-handler.js';
export { MessageBrokerMetrics } from './metrics.js';
export type { MetricsConfig, QueueMetrics, BrokerMetrics } from './metrics.js';
export type { RetryConfig, RetryPublisher } from './retry-handler.js';
export type {
  MessageBrokerConfig,
  ExchangeConfig,
  QueueConfig,
  PublishOptions,
  BrokerMessage,
  MessageHandler,
  Subscription,
  QueueStats,
  MessageBroker,
} from './types.js';
