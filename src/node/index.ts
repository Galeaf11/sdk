import { EventEmitter, CustomEvent } from '@libp2p/interfaces/events';
import { createLibp2p, Libp2pOptions, Libp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { multiaddr, Multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import { PeerId } from '@libp2p/interface-peer-id';
import { OPEN } from '@libp2p/interface-connection/status';
import { AbstractProvider } from 'ethers';
import { z } from 'zod';
import { Request } from '../common/request.js';
import { GenericOfferOptions, GenericQuery } from '../common/messages.js';
import { CenterSub, centerSub } from '../common/pubsub.js';
import { RequestManager, RequestEventPayload } from './requestManager.js';
import { decodeText } from '../utils/text.js';
import { ContractConfig } from '../utils/contract.js';
import { NodeOptions, createNodeOptionsSchema } from '../common/options.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Node');

export interface NodeEvents<
  CustomRequestQuery extends GenericQuery,
  CustomOfferOptions extends GenericOfferOptions,
> {
  /**
   * @example
   *
   * ```js
   * client.addEventListener('start', () => {
   *    // ... started
   * })
   * ```
   */
  start: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * client.addEventListener('stop', () => {
   *    // ... stopped
   * })
   * ```
   */
  stop: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * client.addEventListener('heartbeat', () => {
   *    // ... tick
   * })
   * ```
   */
  heartbeat: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * client.addEventListener('connected', () => {
   *    // ... connected
   * })
   * ```
   */
  connected: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * client.addEventListener('disconnected', () => {
   *    // ... disconnected
   * })
   * ```
   */
  disconnected: CustomEvent<void>;
}

export class Node<
  CustomRequestQuery extends GenericQuery,
  CustomOfferOptions extends GenericOfferOptions,
> extends EventEmitter<NodeEvents<CustomRequestQuery, CustomOfferOptions>> {
  libp2p?: Libp2p;
  serverMultiaddr: Multiaddr;
  serverPeerId: PeerId;
  querySchema: z.ZodType<CustomRequestQuery>;
  offerOptionsSchema: z.ZodType<CustomOfferOptions>;
  contractConfig: ContractConfig;
  provider?: AbstractProvider;
  topics: string[];
  private libp2pInit: Libp2pOptions;
  private requestManager: RequestManager<CustomRequestQuery>;

  constructor(options: NodeOptions<CustomRequestQuery, CustomOfferOptions>) {
    super();

    options = createNodeOptionsSchema<CustomRequestQuery, CustomOfferOptions>().parse(options);

    this.querySchema = options.querySchema;
    this.offerOptionsSchema = options.offerOptionsSchema;
    this.contractConfig = options.contractConfig;
    this.libp2pInit = (options.libp2p ?? {}) as Libp2pOptions;
    this.provider = options.provider;
    this.topics = options.topics;
    this.serverMultiaddr = multiaddr(options.serverAddress);
    const serverPeerIdString = this.serverMultiaddr.getPeerId();

    if (!serverPeerIdString) {
      throw new Error('Unable to extract peer id from the server address');
    }

    this.serverPeerId = peerIdFromString(serverPeerIdString);
    this.requestManager = new RequestManager<CustomRequestQuery>({
      querySchema: this.querySchema,
      noncePeriod: options.noncePeriod,
    });
    this.requestManager.addEventListener('request', (e) => this.handleRequest(e));
  }

  get connected(): boolean {
    return (
      !!this.libp2p &&
      (this.libp2p.pubsub as CenterSub).started &&
      this.libp2p.getPeers().length > 0 &&
      this.libp2p.getConnections(this.serverPeerId)[0]?.stat.status === OPEN
    );
  }

  enable() {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    for (const topic of this.topics) {
      this.libp2p.pubsub.subscribe(topic);
      logger.trace(`Node subscribed to topic #${topic}`);
    }

    logger.trace('Node is enabled');
  }

  disable() {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    for (const topic of this.topics) {
      this.libp2p.pubsub.unsubscribe(topic);
      logger.trace(`Node unsubscribed from topic #${topic}`);
    }

    logger.trace('Node is disabled');
  }

  handleRequest(event: CustomEvent<RequestEventPayload<CustomRequestQuery>>) {
    const handler = async () => {
      if (!this.libp2p) {
        throw new Error('libp2p not initialized yet');
      }

      const request = new Request<CustomRequestQuery, CustomOfferOptions>({
        querySchema: this.querySchema,
        offerOptionsSchema: this.offerOptionsSchema,
        contractConfig: this.contractConfig,
        pubsub: this.libp2p.pubsub as CenterSub,
        provider: this.provider,
      });
      await request.buildRaw({
        ...event.detail,
        offers: [],
        received: Date.now(),
      });
      logger.trace('Handle request:', request.data);

      // @todo Add request to the queue
    };
    handler().catch(logger.error);
  }

  async start(): Promise<void> {
    const config: Libp2pOptions = {
      transports: [webSockets({ filter: all })],
      streamMuxers: [mplex()],
      connectionEncryption: [noise()],
      pubsub: centerSub({
        isClient: true,
        directPeers: [
          {
            id: this.serverPeerId,
            addrs: [this.serverMultiaddr],
          },
        ],
      }),
      ...this.libp2pInit,
    };
    this.libp2p = await createLibp2p(config);

    (this.libp2p.pubsub as CenterSub).addEventListener('gossipsub:heartbeat', () => {
      this.dispatchEvent(new CustomEvent<void>('heartbeat'));
    });

    this.libp2p.addEventListener('peer:connect', ({ detail }) => {
      try {
        if (detail.remotePeer.equals(this.serverPeerId)) {
          this.dispatchEvent(new CustomEvent<void>('connected'));
          logger.trace('🔗 Node connected to server at:', new Date().toISOString());
        }
      } catch (error) {
        logger.error(error);
      }
    });

    this.libp2p.addEventListener('peer:disconnect', ({ detail }) => {
      try {
        if (detail.remotePeer.equals(this.serverPeerId)) {
          this.dispatchEvent(new CustomEvent<void>('disconnected'));
          logger.trace('🔌 Node disconnected from server at:', new Date().toISOString());
        }
      } catch (error) {
        logger.error(error);
      }
    });

    this.libp2p.pubsub.addEventListener('message', ({ detail }) => {
      try {
        const data = decodeText(detail.data);
        logger.trace(`Message on topic ${detail.topic} with data: ${data}`);
        this.requestManager.add(detail.topic, data);
      } catch (error) {
        logger.error(error);
      }
    });

    // Subscribe to topics
    this.enable();

    await this.libp2p.start();
    this.dispatchEvent(new CustomEvent<void>('start'));
    logger.trace('🚀 Node started at:', new Date().toISOString());
  }

  async stop(): Promise<void> {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    // Unsubscribe from all topics
    this.disable();

    await this.libp2p.stop();
    this.dispatchEvent(new CustomEvent<void>('stop'));
    logger.trace('👋 Node stopped at:', new Date().toISOString());
  }
}

export const createNode = <
  CustomRequestQuery extends GenericQuery,
  CustomOfferOptions extends GenericOfferOptions,
>(
  options: NodeOptions<CustomRequestQuery, CustomOfferOptions>,
): Node<CustomRequestQuery, CustomOfferOptions> => {
  return new Node<CustomRequestQuery, CustomOfferOptions>(options);
};
