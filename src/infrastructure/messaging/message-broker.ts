/**
 * RabbitMQ Message Broker Service Implementation
 *
 * Provides:
 * - Publish/subscribe messaging with topic exchanges
 * - Point-to-point messaging via direct queue sends
 * - Automatic exchange and queue setup on initialization
 * - Connection management with auto-reconnect
 * - Message persistence configuration
 * - Dead letter exchange support
 * - Logging via pino
 */

import amqplib from 'amqplib';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import type {
  MessageBrokerConfig,
  MessageBroker,
  PublishOptions,
  BrokerMessage,
  MessageHandler,
  Subscription,
  QueueStats,
} from './types.js';
import { RetryHandler, DEFAULT_RETRY_CONFIG } from './retry-handler.js';
import type { RetryConfig, RetryPublisher } from './retry-handler.js';

type Connection = amqplib.Connection;
type Channel = amqplib.Channel;
type ConsumeMessage = amqplib.ConsumeMessage;

/** Default configuration values */
const DEFAULTS = {
  reconnectDelayMs: 5000,
  maxReconnectAttempts: 0, // unlimited
  prefetchCount: 10,
} as const;

/** Dead letter queue name */
const DEAD_LETTER_QUEUE = 'dead-letter';

/**
 * MessageBrokerService implements the MessageBroker interface
 * using RabbitMQ via amqplib.
 */
export class MessageBrokerService implements MessageBroker {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly logger: pino.Logger;
  private readonly config: MessageBrokerConfig;
  private readonly retryHandler: RetryHandler;
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    config: MessageBrokerConfig,
    options?: { logger?: pino.Logger; retryConfig?: Partial<RetryConfig> },
  ) {
    this.config = config;
    this.logger = (options?.logger ?? pino({ name: 'message-broker' })).child({
      component: 'rabbitmq',
    });
    this.retryHandler = new RetryHandler(options?.retryConfig, { logger: this.logger });
  }

  /**
   * Initialize the broker: connect, create channel, setup exchanges and queues.
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing message broker...');
    await this.connect();
    await this.setupExchanges();
    await this.setupQueues();
    this.logger.info('Message broker initialized successfully');
  }

  /**
   * Publish a message to a topic exchange with a routing key.
   *
   * If no options are provided, defaults to the first configured topic exchange
   * with the topic parameter as the routing key and persistent delivery.
   */
  async publish(topic: string, message: unknown, options?: PublishOptions): Promise<void> {
    const channel = this.getChannel();

    const exchange = options?.exchange ?? this.getDefaultTopicExchange();
    const routingKey = options?.routingKey ?? topic;
    const persistent = options?.persistent ?? true;

    const content = Buffer.from(JSON.stringify(message));
    const messageId = uuidv4();

    const publishOptions: amqplib.Options.Publish = {
      persistent,
      messageId,
      timestamp: Date.now(),
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      headers: options?.headers ?? {},
    };

    if (options?.expiration) {
      publishOptions.expiration = options.expiration;
    }

    if (options?.correlationId) {
      publishOptions.correlationId = options.correlationId;
    }

    const published = channel.publish(exchange, routingKey, content, publishOptions);

    if (!published) {
      this.logger.warn(
        { exchange, routingKey, messageId },
        'Channel write buffer full - message may be buffered',
      );
    }

    this.logger.debug(
      { exchange, routingKey, messageId },
      'Message published',
    );
  }

  /**
   * Subscribe to messages matching a topic pattern.
   *
   * Creates a temporary queue bound to the default topic exchange
   * with the given topic as the binding pattern, or subscribes to
   * an existing queue if one matches the topic pattern.
   *
   * Messages are automatically retried with exponential backoff on failure.
   * After max retries, messages are sent to the dead letter queue.
   */
  async subscribe(topic: string, handler: MessageHandler): Promise<Subscription> {
    const channel = this.getChannel();

    // Find a configured queue that matches this topic, or create a temporary one
    const existingQueue = this.config.queues.find(
      (q) => q.routingKey === topic || q.name === topic,
    );

    let queueName: string;

    if (existingQueue) {
      queueName = existingQueue.name;
    } else {
      // Create a temporary exclusive queue bound to the default topic exchange
      const exchange = this.getDefaultTopicExchange();
      const { queue } = await channel.assertQueue('', {
        exclusive: true,
        autoDelete: true,
      });
      await channel.bindQueue(queue, exchange, topic);
      queueName = queue;
    }

    // Create a retry publisher that republishes messages with delay
    const retryPublisher: RetryPublisher = {
      republish: async (
        exchange: string,
        routingKey: string,
        content: unknown,
        headers: Record<string, string>,
        delayMs: number,
      ): Promise<void> => {
        const ch = this.getChannel();
        const buffer = Buffer.from(JSON.stringify(content));
        const publishOptions: amqplib.Options.Publish = {
          persistent: true,
          messageId: uuidv4(),
          timestamp: Date.now(),
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          headers,
          expiration: String(delayMs),
        };
        ch.publish(exchange || this.getDefaultTopicExchange(), routingKey, buffer, publishOptions);
      },
    };

    // Wrap the handler with retry logic
    const retryWrappedHandler = this.retryHandler.wrapHandler(handler, retryPublisher);

    const { consumerTag } = await channel.consume(
      queueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) {
          this.logger.warn({ queue: queueName }, 'Consumer cancelled by server');
          return;
        }

        const brokerMessage = this.parseBrokerMessage(msg);
        retryWrappedHandler(brokerMessage).catch((error) => {
          this.logger.error(
            { error, queue: queueName, messageId: brokerMessage.id },
            'Retry handler encountered unexpected error',
          );
        });
      },
      { noAck: false },
    );

    this.logger.info(
      { queue: queueName, topic, consumerTag },
      'Subscribed to topic',
    );

    return {
      consumerTag,
      queue: queueName,
      cancel: async () => {
        await channel.cancel(consumerTag);
        this.logger.info({ consumerTag, queue: queueName }, 'Subscription cancelled');
      },
    };
  }

  /**
   * Send a message directly to a specific queue (point-to-point pattern).
   */
  async send(queue: string, message: unknown): Promise<void> {
    const channel = this.getChannel();

    const content = Buffer.from(JSON.stringify(message));
    const messageId = uuidv4();

    const sent = channel.sendToQueue(queue, content, {
      persistent: true,
      messageId,
      timestamp: Date.now(),
      contentType: 'application/json',
      contentEncoding: 'utf-8',
    });

    if (!sent) {
      this.logger.warn(
        { queue, messageId },
        'Channel write buffer full - message may be buffered',
      );
    }

    this.logger.debug({ queue, messageId }, 'Message sent to queue');
  }

  /**
   * Get statistics for a specific queue.
   */
  async getQueueStats(queue: string): Promise<QueueStats> {
    const channel = this.getChannel();

    const result = await channel.checkQueue(queue);

    return {
      name: queue,
      messageCount: result.messageCount,
      consumerCount: result.consumerCount,
    };
  }

  /**
   * Gracefully shut down the broker connection.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.logger.info('Shutting down message broker...');

    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Error closing channel');
    }

    try {
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Error closing connection');
    }

    this.logger.info('Message broker shut down');
  }

  // --- Private Methods ---

  /**
   * Establish a connection to RabbitMQ.
   */
  private async connect(): Promise<void> {
    try {
      this.connection = await amqplib.connect(this.config.url);
      this.channel = await this.connection.createChannel();

      // Set prefetch count for fair dispatch
      const prefetch = this.config.prefetchCount ?? DEFAULTS.prefetchCount;
      await this.channel.prefetch(prefetch);

      this.reconnectAttempts = 0;

      // Setup connection event handlers
      this.connection.on('error', (err) => {
        this.logger.error({ error: err }, 'RabbitMQ connection error');
      });

      this.connection.on('close', () => {
        if (!this.isShuttingDown) {
          this.logger.warn('RabbitMQ connection closed unexpectedly, attempting reconnect...');
          this.scheduleReconnect();
        }
      });

      this.channel.on('error', (err) => {
        this.logger.error({ error: err }, 'RabbitMQ channel error');
      });

      this.channel.on('close', () => {
        if (!this.isShuttingDown) {
          this.logger.warn('RabbitMQ channel closed unexpectedly');
          this.channel = null;
        }
      });

      this.logger.info({ url: this.sanitizeUrl(this.config.url) }, 'Connected to RabbitMQ');
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to RabbitMQ');
      throw error;
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  private scheduleReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? DEFAULTS.maxReconnectAttempts;

    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.logger.error(
        { attempts: this.reconnectAttempts },
        'Max reconnect attempts reached, giving up',
      );
      return;
    }

    const baseDelay = this.config.reconnectDelayMs ?? DEFAULTS.reconnectDelayMs;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), 60000);

    this.reconnectAttempts++;

    this.logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Scheduling reconnect...',
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        this.connection = null;
        this.channel = null;
        await this.connect();
        await this.setupExchanges();
        await this.setupQueues();
        this.logger.info('Reconnected to RabbitMQ successfully');
      } catch (error) {
        this.logger.error({ error }, 'Reconnect attempt failed');
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Setup all configured exchanges.
   */
  private async setupExchanges(): Promise<void> {
    const channel = this.getChannel();

    for (const exchange of this.config.exchanges) {
      await channel.assertExchange(exchange.name, exchange.type, {
        durable: exchange.durable,
        autoDelete: exchange.autoDelete ?? false,
      });
      this.logger.debug(
        { name: exchange.name, type: exchange.type },
        'Exchange asserted',
      );
    }

    // Setup dead letter exchange
    if (this.config.deadLetterExchange) {
      await channel.assertExchange(this.config.deadLetterExchange, 'topic', {
        durable: true,
      });
      this.logger.debug(
        { name: this.config.deadLetterExchange },
        'Dead letter exchange asserted',
      );
    }
  }

  /**
   * Setup all configured queues with their bindings.
   * Also sets up the dead-letter queue bound to the DLX exchange.
   */
  private async setupQueues(): Promise<void> {
    const channel = this.getChannel();

    // Setup dead-letter queue bound to DLX
    if (this.config.deadLetterExchange) {
      await channel.assertQueue(DEAD_LETTER_QUEUE, {
        durable: true,
      });
      await channel.bindQueue(
        DEAD_LETTER_QUEUE,
        this.config.deadLetterExchange,
        '#', // Catch all routing keys
      );
      this.logger.debug(
        { queue: DEAD_LETTER_QUEUE, exchange: this.config.deadLetterExchange },
        'Dead letter queue bound to DLX',
      );
    }

    for (const queue of this.config.queues) {
      const queueOptions: amqplib.Options.AssertQueue = {
        durable: queue.durable ?? true,
      };

      // Configure dead letter exchange for the queue
      if (queue.deadLetterExchange ?? this.config.deadLetterExchange) {
        queueOptions.deadLetterExchange =
          queue.deadLetterExchange ?? this.config.deadLetterExchange;
        if (queue.deadLetterRoutingKey) {
          queueOptions.deadLetterRoutingKey = queue.deadLetterRoutingKey;
        }
      }

      if (queue.messageTtl) {
        queueOptions.messageTtl = queue.messageTtl;
      }

      if (queue.maxLength) {
        queueOptions.maxLength = queue.maxLength;
      }

      await channel.assertQueue(queue.name, queueOptions);

      // Bind queue to its exchange
      if (queue.exchange) {
        await channel.bindQueue(queue.name, queue.exchange, queue.routingKey);
        this.logger.debug(
          { queue: queue.name, exchange: queue.exchange, routingKey: queue.routingKey },
          'Queue bound to exchange',
        );
      }
    }
  }

  /**
   * Parse a raw AMQP message into a BrokerMessage.
   */
  private parseBrokerMessage(msg: ConsumeMessage): BrokerMessage {
    const channel = this.getChannel();

    let content: unknown;
    try {
      content = JSON.parse(msg.content.toString('utf-8'));
    } catch {
      content = msg.content.toString('utf-8');
    }

    const headers: Record<string, string> = {};
    if (msg.properties.headers) {
      for (const [key, value] of Object.entries(msg.properties.headers)) {
        if (value !== undefined && value !== null) {
          headers[key] = String(value);
        }
      }
    }

    return {
      id: msg.properties.messageId ?? uuidv4(),
      content,
      routingKey: msg.fields.routingKey,
      exchange: msg.fields.exchange,
      timestamp: msg.properties.timestamp
        ? new Date(msg.properties.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      headers,
      ack: () => channel.ack(msg),
      nack: (requeue = false) => channel.nack(msg, false, requeue),
    };
  }

  /**
   * Get the active channel or throw if not connected.
   */
  private getChannel(): Channel {
    if (!this.channel) {
      throw new Error('Message broker is not connected. Call initialize() first.');
    }
    return this.channel;
  }

  /**
   * Get the default topic exchange name from configuration.
   */
  private getDefaultTopicExchange(): string {
    const topicExchange = this.config.exchanges.find((e) => e.type === 'topic');
    if (!topicExchange) {
      throw new Error('No topic exchange configured');
    }
    return topicExchange.name;
  }

  /**
   * Sanitize a connection URL for logging (remove credentials).
   */
  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return url.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
    }
  }
}
