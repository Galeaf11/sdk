import { createLibp2p, Libp2pInit, Libp2pOptions, Libp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { EventEmitter, CustomEvent } from '@libp2p/interfaces/events';
import { OPEN } from '@libp2p/interface-connection/status';
import { multiaddr, Multiaddr } from '@multiformats/multiaddr';
import { PeerId } from '@libp2p/interface-peer-id';
import { peerIdFromString } from '@libp2p/peer-id';
import {
  Hex,
  Hash,
  Chain,
  PublicClient,
  WalletClient,
  createPublicClient,
  createWalletClient,
  http,
  stringify,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import {
  Contracts,
  GenericOfferOptions,
  GenericQuery,
  OfferData,
} from '../shared/types.js';
import { Account, buildOffer, BuildOfferOptions } from '../shared/messages.js';
import { ServerAddressOption, ChainsConfigOption } from '../shared/options.js';
import { CenterSub, centerSub } from '../shared/pubsub.js';
import { RequestEvent } from './requestManager.js';
import { decodeText, encodeText } from '../utils/text.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Node');

/**
 * Decoded message
 */
export interface RawDecodedMessage {
  topic: string;
  data: string;
}

/**
 * The protocol node events interface
 */
export interface NodeEvents {
  /**
   * @example
   *
   * ```js
   * node.addEventListener('start', () => {
   *    // ... started
   * })
   * ```
   */
  start: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * node.addEventListener('stop', () => {
   *    // ... stopped
   * })
   * ```
   */
  stop: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * node.addEventListener('heartbeat', () => {
   *    // ... tick
   * })
   * ```
   */
  heartbeat: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * node.addEventListener('connected', () => {
   *    // ... connected
   * })
   * ```
   */
  connected: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * node.addEventListener('disconnected', () => {
   *    // ... disconnected
   * })
   * ```
   */
  disconnected: CustomEvent<void>;

  /**
   * @example
   *
   * ```js
   * node.addEventListener('message', ({ detail }) => {
   *    // detail.topic
   *    // detail.data // encoded
   * })
   * ```
   */
  message: CustomEvent<RawDecodedMessage>;
}

/**
 * The protocol node initialization options type
 */
export interface NodeOptions extends ServerAddressOption, ChainsConfigOption {
  /** libp2p configuration options */
  libp2p?: Libp2pInit;
  /** Subscription topics of node */
  topics: string[];
  /** Unique supplier Id */
  supplierId: Hash;
  /** Seed phrase of the node signer wallet */
  signerSeedPhrase?: string;
  /** Signer private key */
  signerPk?: Hex;
}

/**
 * The protocol node
 *
 * @class Node
 * @extends {EventEmitter<NodeEvents<CustomRequestQuery>>}
 * @template {CustomRequestQuery}
 * @template {CustomOfferOptions}
 */
export class Node<
  CustomRequestQuery extends GenericQuery = GenericQuery,
  CustomOfferOptions extends GenericOfferOptions = GenericOfferOptions,
> extends EventEmitter<NodeEvents> {
  /** libp2p initialization options */
  private libp2pInit: Libp2pOptions;
  /** Blockchain network public client */
  publicClient: PublicClient;
  /** Blockchain network wallet client */
  walletClient: WalletClient;
  /** libp2p instance */
  libp2p?: Libp2p;
  /** The server multiaddr */
  serverMultiaddr: Multiaddr;
  /** The server peer Id */
  serverPeerId: PeerId;
  /** The node supplier Id */
  supplierId: Hash;
  /** Topics this node is subscribed */
  topics: string[];
  /** Offers signer */
  signer: Account;
  /** Blockchain network configuration */
  chain: Chain;
  /** The protocol smart contracts configuration */
  contracts: Contracts;

  /**
   * @param {NodeOptions} options Node initialization options
   */
  constructor(options: NodeOptions) {
    super();

    const {
      libp2p,
      topics,
      supplierId,
      signerSeedPhrase,
      signerPk,
      chain,
      contracts,
      serverAddress,
    } = options;

    // @todo Validate NodeOptions

    this.chain = chain;
    this.libp2pInit = libp2p ?? {};
    this.topics = topics;
    this.supplierId = supplierId;

    if (signerSeedPhrase) {
      this.signer = mnemonicToAccount(signerSeedPhrase);
    } else if (signerPk) {
      this.signer = privateKeyToAccount(signerPk);
    } else {
      throw new Error('Invalid signer account configuration');
    }

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(),
    });

    this.walletClient = createWalletClient({
      chain: this.chain,
      transport: http(),
      account: this.signer,
    });

    this.contracts = contracts;

    this.serverMultiaddr = multiaddr(serverAddress);
    const serverPeerIdString = this.serverMultiaddr.getPeerId();

    if (!serverPeerIdString) {
      throw new Error('Unable to extract peer id from the server address');
    }

    this.serverPeerId = peerIdFromString(serverPeerIdString);

    logger.trace('Node instantiated');
  }

  /**
   * Node connection indicator
   *
   * @readonly
   * @type {boolean}
   * @memberof Node
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
   * Enables the node. When enabled the node starts listening to all configured topics
   *
   * @memberof Node
   */
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

  /**
   * Disables the node
   *
   * @memberof Node
   */
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

  /**
   * Handles requests
   *
   * @param {CustomEvent<RequestEvent<CustomRequestQuery>>} event Request event
   * @memberof Node
   */
  handleRequest(event: CustomEvent<RequestEvent<CustomRequestQuery>>) {
    try {
      if (!this.libp2p) {
        throw new Error('libp2p not initialized yet');
      }

      this.dispatchEvent(
        new CustomEvent<RequestEvent<CustomRequestQuery>>('request', event),
      );
      logger.trace('Request event', event);
    } catch (error) {
      logger.error(error);
    }
  }

  /**
   * Builds and publishes an offer
   *
   * @param {(Omit<
   *   BuildOfferOptions<CustomRequestQuery, CustomOfferOptions>,
   *   'domain' | 'walletClient' | 'supplierId'
   * >)} offerOptions Offer creation options
   * @returns {Promise<OfferData<CustomRequestQuery, CustomOfferOptions>>} Built offer
   * @memberof Node
   */
  async makeOffer(
    offerOptions: Omit<
      BuildOfferOptions<CustomRequestQuery, CustomOfferOptions>,
      'domain' | 'supplierId'
    >,
  ): Promise<OfferData<CustomRequestQuery, CustomOfferOptions>> {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }

    const offer = await buildOffer<CustomRequestQuery, CustomOfferOptions>({
      ...offerOptions,
      domain: {
        chainId: this.chain.id,
        name: this.contracts.market.name,
        version: this.contracts.market.version,
        verifyingContract: this.contracts.market.address,
      },
      supplierId: this.supplierId,
      account: this.signer,
    });
    logger.trace(`Offer #${offer.id} is built`);

    await this.libp2p.pubsub.publish(
      offer.request.id,
      encodeText(stringify(offer)),
    );
    logger.trace(`Offer #${offer.id} is published`);

    return offer;
  }

  /**
   * Starts the node
   *
   * @returns {Promise<void>}
   * @memberof Node
   */
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
            '🔗 Node connected to server at:',
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
            '🔌 Node disconnected from server at:',
            new Date().toISOString(),
          );
        }
      } catch (error) {
        logger.error(error);
      }
    });

    this.libp2p.pubsub.addEventListener('message', ({ detail }) => {
      try {
        const topic = detail.topic;
        const data = decodeText(detail.data);
        logger.trace(`Message on topic ${detail.topic} with data: ${data}`);
        this.dispatchEvent(
          new CustomEvent<RawDecodedMessage>('message', {
            detail: {
              topic,
              data,
            },
          }),
        );
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

  /**
   * Stops the node
   *
   * @returns {Promise<void>}
   * @memberof Node
   */
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

/**
 * Creates the protocol node
 *
 * @param {NodeOptions<CustomRequestQuery, CustomOfferOptions>} options Node instance creation options
 * @returns {Node<CustomRequestQuery, CustomOfferOptions>} Node instance
 */
export const createNode = <
  CustomRequestQuery extends GenericQuery,
  CustomOfferOptions extends GenericOfferOptions,
>(
  options: NodeOptions,
): Node<CustomRequestQuery, CustomOfferOptions> => {
  return new Node<CustomRequestQuery, CustomOfferOptions>(options);
};

/**
 * Request manager exports
 */
export * from './requestManager.js';
