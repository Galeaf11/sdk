/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { EventEmitter, CustomEvent } from '@libp2p/interfaces/events';
import { createLibp2p, Libp2pOptions, Libp2p, Libp2pInit } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { multiaddr, Multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import { PeerId } from '@libp2p/interface-peer-id';
import { OPEN } from '@libp2p/interface-connection/status';
import { Chain, stringify } from 'viem';
import {
  OfferData,
  GenericOfferOptions,
  GenericQuery,
  Contracts,
  RequestData,
} from '../shared/types.js';
import { centerSub, CenterSub } from '../shared/pubsub.js';
import { ChainsConfigOption, ServerAddressOption } from '../shared/options.js';
import { encodeText, decodeText } from '../utils/text.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Client');

export interface ClientEvents<
  CustomRequestQuery extends GenericQuery = GenericQuery,
  CustomOfferOptions extends GenericOfferOptions = GenericOfferOptions,
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

  /**
   * @example
   *
   * ```js
   * client.addEventListener('publish', ({ detail }) => {
   *    // ... request published
   * })
   * ```
   */
  publish: CustomEvent<RequestData<CustomRequestQuery>>;

  /**
   * @example
   *
   * ```js
   * client.addEventListener('publish', ({ detail }) => {
   *    // ... offer arrived
   * })
   * ```
   */
  offer: CustomEvent<OfferData<CustomRequestQuery, CustomOfferOptions>>;
}

/**
 * The protocol client initialization options
 */
export interface ClientOptions extends ServerAddressOption {
  /** libp2p configuration options */
  libp2p?: Libp2pInit;
}

/**
 * The protocol Client class
 *
 * @class Client
 * @extends {EventEmitter<ClientEvents<CustomRequestQuery, CustomOfferOptions>>}
 * @template CustomRequestQuery
 * @template CustomOfferOptions
 */
export class Client<
  CustomRequestQuery extends GenericQuery = GenericQuery,
  CustomOfferOptions extends GenericOfferOptions = GenericOfferOptions,
> extends EventEmitter<ClientEvents<CustomRequestQuery, CustomOfferOptions>> {
  private libp2pInit: Libp2pOptions;

  /** libp2p instance */
  libp2p?: Libp2p;
  /** Server instance multiaddr */
  serverMultiaddr: Multiaddr;
  /** Server peer Id */
  serverPeerId: PeerId;

  /**
   *Creates an instance of Client.
   * @param {ClientOptions} options
   * @memberof Client
   */
  constructor(options: ClientOptions) {
    super();

    const { libp2p, serverAddress } = options;

    // @todo Validate ClientOptions

    this.libp2pInit = (libp2p ?? {}) as Libp2pOptions;
    this.serverMultiaddr = multiaddr(serverAddress);
    const serverPeerIdString = this.serverMultiaddr.getPeerId();

    if (!serverPeerIdString) {
      throw new Error('Unable to extract peer id from the server address');
    }

    this.serverPeerId = peerIdFromString(serverPeerIdString);
  }

  /**
   * Client connection status flag
   *
   * @readonly
   * @type {boolean}
   * @memberof Client
   */
  get connected(): boolean {
    return (
      !!this.libp2p &&
      (this.libp2p.pubsub as CenterSub).started &&
      this.libp2p.getPeers().length > 0 &&
      this.libp2p.getConnections(this.serverPeerId)[0]?.stat.status === OPEN
    );
  }

  /**
   * Starts the client
   *
   * @returns {Promise<void>}
   * @memberof Client
   */
  async start(): Promise<void> {
    const config: Libp2pOptions = {
      transports: [webSockets({ filter: all })],
      streamMuxers: [mplex()],
      connectionEncryption: [noise()],
      pubsub: centerSub({
        isClient: true,
        /** Client must be connected to the coordination server */
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

    (this.libp2p.pubsub as CenterSub).addEventListener(
      'gossipsub:heartbeat',
      () => {
        this.dispatchEvent(new CustomEvent<void>('heartbeat'));
      },
    );

    this.libp2p.addEventListener('peer:connect', ({ detail }) => {
      try {
        if (detail.remotePeer.equals(this.serverPeerId)) {
          this.dispatchEvent(new CustomEvent<void>('connected'));
          logger.trace(
            '🔗 Client connected to server at:',
            new Date().toISOString(),
          );
        }
      } catch (error) {
        logger.error(error);
      }
    });

    this.libp2p.addEventListener('peer:disconnect', ({ detail }) => {
      try {
        if (detail.remotePeer.equals(this.serverPeerId)) {
          this.dispatchEvent(new CustomEvent<void>('disconnected'));
          logger.trace(
            '🔌 Client disconnected from server at:',
            new Date().toISOString(),
          );
        }
      } catch (error) {
        logger.error(error);
      }
    });

    this.libp2p.pubsub.addEventListener('message', ({ detail }) => {
      logger.trace(`Message on topic ${detail.topic}`);

      try {
        /** Check is the message is an offer */
        const offer = JSON.parse(decodeText(detail.data)) as OfferData<
          CustomRequestQuery,
          CustomOfferOptions
        >;

        // @todo Validate offer

        logger.trace('Offer received:', offer);

        // @todo Implement offer verification

        this.dispatchEvent(
          new CustomEvent<OfferData<CustomRequestQuery, CustomOfferOptions>>(
            'offer',
            {
              detail: offer,
            },
          ),
        );
      } catch (error) {
        logger.error(error);
      }
    });

    await this.libp2p.start();
    this.dispatchEvent(new CustomEvent<void>('start'));
    logger.trace('🚀 Client started at:', new Date().toISOString());
  }

  /**
   * Publishes new request
   *
   * @param {RequestData<CustomRequestQuery>} request
   * @memberof Client
   */
  publish(request: RequestData<CustomRequestQuery>) {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    this.libp2p.pubsub
      .publish(request.topic, encodeText(stringify(request)))
      .then(() => {
        this.dispatchEvent(
          new CustomEvent<RequestData<CustomRequestQuery>>('publish', {
            detail: request,
          }),
        );
      })
      .catch(logger.error);
  }

  /**
   * Subscribes the client to topic
   *
   * @param {string} topic
   * @memberof Client
   */
  subscribe(topic: string) {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    this.libp2p.pubsub.subscribe(topic);
  }

  /**
   * Unsubscribes the client from topic
   *
   * @param {string} topic
   * @memberof Client
   */
  unsubscribe(topic: string) {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    this.libp2p.pubsub.unsubscribe(topic);
  }

  /**
   * Stops the client
   *
   * @returns {Promise<void>}
   * @memberof Client
   */
  async stop(): Promise<void> {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    await this.libp2p.stop();
    this.dispatchEvent(new CustomEvent<void>('stop'));
    logger.trace('👋 Client stopped at:', new Date().toISOString());
  }
}

/**
 * Creates client instance
 *
 * @param {ClientOptions} options Client initialization options
 * @returns {Client}
 */
export const createClient = <
  CustomRequestQuery extends GenericQuery,
  CustomOfferOptions extends GenericOfferOptions,
>(
  options: ClientOptions,
): Client<CustomRequestQuery, CustomOfferOptions> => {
  return new Client(options);
};

/**
 * Requests registry exports
 */
export * from './requestsManager.js';

/**
 * Deals registry exports
 */
export * from './dealsManager.js';
