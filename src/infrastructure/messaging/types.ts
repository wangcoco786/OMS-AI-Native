/**
 * Message Broker Type Definitions
 *
 * Interfaces and types for the RabbitMQ-based messaging service.
 */

/** Exchange configuration */
export interface ExchangeConfig {
  name: string;
  type: 'topic' | 'fanout' | 'direct' | 'headers';
  durable: boolean;
  autoDelete?: boolean;
}

/** Queue configuration */
export interface QueueConfig {
  name: string;
  exchange: string;
  routingKey: string;
  durable?: boolean;
  deadLetterExchange?: string;
  deadLetterRoutingKey?: string;
  messageTtl?: number;
  maxLength?: number;
}

/** Full message broker configuration */
export interface MessageBrokerConfig {
  url: string;
  exchanges: ExchangeConfig[];
  queues: QueueConfig[];
  deadLetterExchange: string;
  /** Reconnect delay in milliseconds */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts (0 = unlimited) */
  maxReconnectAttempts?: number;
  /** Prefetch count for consumers */
  prefetchCount?: number;
}

/** Options for publishing a message */
export interface PublishOptions {
  exchange: string;
  routingKey: string;
  persistent: boolean;
  headers?: Record<string, string>;
  /** Message expiration in milliseconds */
  expiration?: string;
  /** Correlation ID for request-reply patterns */
  correlationId?: string;
}

/** A message received from the broker */
export interface BrokerMessage {
  id: string;
  content: unknown;
  routingKey: string;
  exchange: string;
  timestamp: string;
  headers: Record<string, string>;
  /** Acknowledge the message */
  ack: () => void;
  /** Reject the message (optionally requeue) */
  nack: (requeue?: boolean) => void;
}

/** Handler function for processing messages */
export type MessageHandler = (message: BrokerMessage) => Promise<void>;

/** Subscription handle for unsubscribing */
export interface Subscription {
  /** Consumer tag identifying this subscription */
  consumerTag: string;
  /** Queue name this subscription is bound to */
  queue: string;
  /** Cancel the subscription */
  cancel: () => Promise<void>;
}

/** Queue statistics for monitoring */
export interface QueueStats {
  name: string;
  messageCount: number;
  consumerCount: number;
}

/** Message broker interface */
export interface MessageBroker {
  /** Publish a message to a topic exchange with routing key */
  publish(topic: string, message: unknown, options?: PublishOptions): Promise<void>;
  /** Subscribe to messages matching a topic pattern */
  subscribe(topic: string, handler: MessageHandler): Promise<Subscription>;
  /** Send a message directly to a specific queue (point-to-point) */
  send(queue: string, message: unknown): Promise<void>;
  /** Get statistics for a specific queue */
  getQueueStats(queue: string): Promise<QueueStats>;
  /** Initialize the broker (connect, setup exchanges/queues) */
  initialize(): Promise<void>;
  /** Gracefully shut down the broker connection */
  shutdown(): Promise<void>;
}
