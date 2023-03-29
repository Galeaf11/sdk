import { z } from 'zod';
import { Storage, createStorageInitializerFactorySchema } from './abstract.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MemoryStorage');

/**
 * Memory storage options
 */
export const MemoryStorageOptionsSchema = z.object({
  entries: z.array(z.tuple([z.string(), z.any()])).optional(),
});

/**
 * Memory storage type
 */
export type MemoryStorageOptions = z.infer<typeof MemoryStorageOptionsSchema>;

/**
 * In-memory key-value storage implementation
 *
 * @class MemoryStorage
 * @extends {Storage}
 */
export class MemoryStorage extends Storage {
  /** Map as in-memory key-value storage */
  private db: Map<string, unknown>;

  /**
   * Creates an instance of MemoryStorage.
   *
   * @param {MemoryStorageOptions} [options]
   * @memberof MemoryStorage
   */
  constructor(options?: MemoryStorageOptions) {
    super();
    options = MemoryStorageOptionsSchema.parse(options ?? {});
    this.db = new Map<string, unknown>(options?.entries);
    logger.trace('Memory storage initialized');
  }

  /**
   * Sets the key to the storage
   *
   * @template ValueType
   * @param {string} key
   * @param {ValueType} value
   * @memberof MemoryStorage
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async set<ValueType>(key: string, value: ValueType) {
    this.db.set(key, value);
  }

  /**
   * Gets the key from the storage
   *
   * @template ValueType
   * @param {string} key
   * @returns {Promise<ValueType>}
   * @memberof MemoryStorage
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async get<ValueType>(key: string): Promise<ValueType> {
    return this.db.get(key) as ValueType;
  }

  /**
   * Deletes the key
   *
   * @param {string} key
   * @returns
   * @memberof MemoryStorage
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(key: string) {
    return this.db.delete(key);
  }

  /**
   * Returns the storage entries iterator
   *
   * @template ValueType
   * @returns {IterableIterator<[string, ValueType]>}
   * @memberof MemoryStorage
   */
  entries<ValueType>(): IterableIterator<[string, ValueType]> {
    return this.db.entries() as IterableIterator<[string, ValueType]>;
  }
}

// Storage configuration
export const init = (options?: MemoryStorageOptions) =>
  createStorageInitializerFactorySchema<typeof MemoryStorageOptionsSchema>(
    MemoryStorageOptionsSchema,
  )
    // eslint-disable-next-line @typescript-eslint/require-await
    .implement((options) => async (): Promise<MemoryStorage> => {
      return new MemoryStorage(options);
    })(options ?? {});
