import { createLibp2p, Libp2pOptions, Libp2p } from 'libp2p';
import { createFromJSON } from '@libp2p/peer-id-factory';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { z } from 'zod';
import { centerSub, CenterSub } from '../common/pubsub.js';
import { decodeText } from '../utils/text.js';
import { CachedMessage } from '../common/cache.js';
import { Storage, StorageInitializer } from '../storage/abstract.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Server');

export const NodeKeyJsonSchema = z
  .object({
    id: z.string(), // Peer Id
    privKey: z.string(), // Private key
    pubKey: z.string(), // Public key
  })
  .strict();

export type NodeKeyJson = z.infer<typeof NodeKeyJsonSchema>;

// Peer configuration options
export const PeerOptionsSchema = z
  .object({
    peerKey: NodeKeyJsonSchema.optional(), // Peer key
  })
  .strict();

export type PeerOptions = z.infer<typeof PeerOptionsSchema>;

// Server options schema
export const ServerOptionsSchema = PeerOptionsSchema.required()
  .extend({
    address: z.string().optional(), // Optional IP address of the server, defaults to '0.0.0.0'
    port: z.number(),
  })
  .strict();

export type ServerOptions = z.infer<typeof ServerOptionsSchema>;

export class CoordinationServer {
  public port: number;
  protected nodeKeyJson: NodeKeyJson;
  protected libp2p?: Libp2p;
  protected options: ServerOptions;
  protected messagesStorageInit?: ReturnType<StorageInitializer>;

  constructor(options: ServerOptions, messagesStorageInit?: ReturnType<StorageInitializer>) {
    this.options = ServerOptionsSchema.parse(options);
    this.messagesStorageInit = messagesStorageInit;
    this.port = this.options.port;
    this.nodeKeyJson = this.options.peerKey;
  }

  get multiaddrs() {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }
    return this.libp2p.getMultiaddrs();
  }

  async start(): Promise<void> {
    let messagesStorage: Storage<CachedMessage> | undefined;

    if (this.messagesStorageInit) {
      messagesStorage = await this.messagesStorageInit<CachedMessage>();
    }

    const config: Libp2pOptions = {
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${this.port}/ws`],
      },
      transports: [webSockets({ filter: all })],
      streamMuxers: [mplex()],
      connectionEncryption: [noise()],
      pubsub: centerSub(
        {
          messageTransformer: <GenericMessage>(data: BufferSource) => {
            const dataString = decodeText(data);
            const dataObj = JSON.parse(dataString) as GenericMessage;
            return dataObj;
          },
        },
        messagesStorage,
      ),
    };
    const peerId = await createFromJSON(this.nodeKeyJson);
    this.libp2p = await createLibp2p({ peerId, ...config });

    this.libp2p.addEventListener('peer:discovery', async ({ detail }) => {
      const id = detail.id.toString();
      logger.trace('Peer discovery:', id);
    });

    this.libp2p.addEventListener('peer:connect', async ({ detail }) => {
      const id = detail.id.toString();
      logger.trace('Peer connected:', id);
    });

    this.libp2p.addEventListener('peer:disconnect', async ({ detail }) => {
      const id = detail.id.toString();
      logger.trace('Peer disconnected:', id);
    });

    (this.libp2p.pubsub as CenterSub).addEventListener('message', ({ detail }) => {
      logger.trace(`Message: ${decodeText(detail.data)} on topic ${detail.topic}`);
    });

    await this.libp2p.start();
    logger.trace('🚀 Started at:', new Date().toISOString());
    logger.trace('Listened for peers at:', this.multiaddrs);
  }

  async stop(): Promise<void> {
    if (!this.libp2p) {
      throw new Error('libp2p not initialized yet');
    }
    await this.libp2p.stop();
  }
}

export const createServer = (
  options: ServerOptions,
  messagesStorageInit?: ReturnType<StorageInitializer>,
): CoordinationServer => {
  return new CoordinationServer(options, messagesStorageInit);
};