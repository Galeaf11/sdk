import { stringify } from 'viem';
import { Storage, StorageInitializerFunction } from './abstract.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('LocalStorage');

/**
 * Generic localStorage interface
 */
export interface WindowStorage {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
  key(index: number): string | null;
  length: number;
}

/**
 * Local storage options type
 */
export interface LocalStorageOptions {
  session?: boolean;
}

/**
 * In-memory key-value storage implementation
 *
 * @class LocalStorage
 * @extends {Storage}
 */
export class LocalStorage extends Storage {
  db: WindowStorage;

  /**
   * Creates an instance of LocalStorage.
   *
   * @param {LocalStorageOptions} [options]
   * @memberof LocalStorage
   */
  constructor(options?: LocalStorageOptions) {
    super();
    options = options ?? {};

    // @todo Validate LocalStorageOptions

    this.db = options.session ? sessionStorage : localStorage;
    logger.trace('Local storage initialized');
  }

  /**
   * Serializes a value
   *
   * @template ValueType
   * @param {ValueType} value
   * @returns {string}
   * @memberof LocalStorage
   */
  serialize<ValueType>(value: ValueType): string {
    return stringify(value);
  }
  /**
   * Deserializes a value
   *
   * @template ValueType
   * @param {string} value
   * @returns {ValueType}
   * @memberof LocalStorage
   */
  deserialize<ValueType>(value: string): ValueType {
    return JSON.parse(value) as ValueType;
  }

  /**
   * Sets the key to the storage
   *
   * @template ValueType
   * @param {string} key
   * @param {ValueType} value
   * @memberof LocalStorage
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async set<ValueType>(key: string, value: ValueType) {
    this.db.setItem(key, this.serialize(value));
  }

  /**
   * Gets a key from the storage
   *
   * @template ValueType
   * @param {string} key
   * @returns {Promise<ValueType | undefined>}
   * @memberof LocalStorage
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async get<ValueType>(key: string): Promise<ValueType | undefined> {
    const value = this.db.getItem(key);
    if (value !== null) {
      return this.deserialize<ValueType>(value);
    }
    return;
  }

  /**
   * Deletes the key
   *
   * @param {string} key
   * @returns {Promise<boolean>}
   * @memberof LocalStorage
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(key: string): Promise<boolean> {
    this.db.removeItem(key);
    return this.db.getItem(key) === null;
  }

  /**
   * Returns the storage entries iterator
   *
   * @template ValueType
   * @returns {IterableIterator<[string, ValueType]>}
   * @memberof LocalStorage
   */
  entries<ValueType>(): IterableIterator<[string, ValueType]> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const source = this;

    function* entriesIterator(): IterableIterator<[string, ValueType]> {
      let index = 0;

      while (index < source.db.length) {
        const key = source.db.key(index++);

        if (key === null) {
          return;
        }

        const value = source.db.getItem(key);

        if (!value) {
          return;
        }

        yield [key, source.deserialize(value)];
      }
    }

    return entriesIterator();
  }
}

/**
 * Local storage configuration
 */
export const createInitializer: StorageInitializerFunction =
  (options?: LocalStorageOptions) =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async (): Promise<LocalStorage> => {
    return new LocalStorage(options);
  };
