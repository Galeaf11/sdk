import { expect, createRequest, createOffer } from './setup.js';
import { mnemonicToAccount } from 'viem/accounts';
import { generateMnemonic } from '../src/utils/wallet.js';
import { supplierId as spId } from '../src/utils/uid.js';
import { nowSec } from '../src/utils/time.js';
import { randomSalt } from '@windingtree/contracts';
import { memoryStorage } from '../src/storage/index.js';
import { ClientRequestsManager } from '../src/client/requestsManager.js';

const expTime = (sec: number): bigint => BigInt(nowSec() + sec);

describe('Client.ClientRequestManager', () => {
  let clientRequestManager: ClientRequestsManager;
  const topic = 'test';
  const signer = mnemonicToAccount(generateMnemonic());
  const typedDomain = {
    chainId: 1,
    name: 'Test',
    version: '1',
    contract: signer.address,
  };
  const supplierId = spId(randomSalt(), signer.address);

  beforeEach(async () => {
    const init = memoryStorage.createInitializer();
    const storage = await init();
    clientRequestManager = new ClientRequestsManager({
      storage,
      prefix: 'test',
    });
  });

  describe('#add', () => {
    it('should add a request and emit a request event', async () => {
      const request = await createRequest(topic, expTime(10));
      await new Promise<void>((resolve) => {
        clientRequestManager.addEventListener('request', ({ detail }) => {
          expect(detail.data).to.equal(request);
          resolve();
        });
        clientRequestManager.add(request);
      });
    });
  });

  describe('#get', () => {
    it('should get a request by id', async () => {
      const request = await createRequest(topic, expTime(10));
      clientRequestManager.add(request);
      const result = clientRequestManager.get(request.id);
      expect(result?.data).to.equal(request);
    });
  });

  describe('#getAll', () => {
    it('should get all requests', async () => {
      const request1 = await createRequest(topic, expTime(10));
      const request2 = await createRequest(topic, expTime(10));
      clientRequestManager.add(request1);
      clientRequestManager.add(request2);
      const result = clientRequestManager.getAll();
      expect(result.map((r) => r.data)).to.include.members([
        request1,
        request2,
      ]);
    });
  });

  describe('#cancel', () => {
    it('should return false if the request does not exist', () => {
      const result = clientRequestManager.cancel('nonexistent_id');
      expect(result).to.be.false;
    });

    it('should cancel a request and emit a cancel event', async () => {
      const request = await createRequest(topic, expTime(10));
      clientRequestManager.add(request);
      await new Promise<void>((resolve) => {
        clientRequestManager.addEventListener('cancel', ({ detail }) => {
          expect(detail.data).to.equal(request);
          resolve();
        });
        clientRequestManager.cancel(request.id);
      });
    });
  });

  describe('#delete', () => {
    it('should return false if the request does not exist', () => {
      const result = clientRequestManager.delete('nonexistent_id');
      expect(result).to.be.false;
    });

    it('should delete a request and emit a delete event', async () => {
      const request = await createRequest(topic, expTime(10));
      clientRequestManager.add(request);
      await new Promise<void>((resolve) => {
        clientRequestManager.addEventListener('delete', ({ detail }) => {
          expect(detail.data).to.equal(request);
          resolve();
        });
        clientRequestManager.delete(request.id);
      });
    });
  });

  describe('#clear', () => {
    it('should clear all requests and emit a clear event', async () => {
      const request1 = await createRequest(topic, expTime(10));
      const request2 = await createRequest(topic, expTime(10));
      clientRequestManager.add(request1);
      clientRequestManager.add(request2);
      await new Promise<void>((resolve) => {
        clientRequestManager.addEventListener('clear', () => {
          const result = clientRequestManager.getAll();
          expect(result).to.be.empty;
          resolve();
        });
        clientRequestManager.clear();
      });
    });
  });

  describe('#prune', () => {
    it('should unsubscribe expired requests and emit an expire event', async () => {
      const request = await createRequest(topic, expTime(1));
      clientRequestManager.add(request);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await new Promise<void>((resolve) => {
        clientRequestManager.addEventListener('expire', ({ detail }) => {
          expect(detail.data).to.equal(request);
          resolve();
        });
        clientRequestManager.prune();
      });
    });
  });

  describe('#addOffer', () => {
    it('should throw an error if the request does not exist', async () => {
      const request = await createRequest(topic, expTime(10));
      const offer = await createOffer(
        request,
        '30s',
        typedDomain,
        supplierId,
        signer,
      );
      expect(() => clientRequestManager.addOffer(offer)).to.throw(
        `Request #${request.id} not found`,
      );
    });

    it('should add an offer to a request and emit an offer event', async () => {
      const request = await createRequest(topic, expTime(10));
      const offer = await createOffer(
        request,
        '30s',
        typedDomain,
        supplierId,
        signer,
      );
      clientRequestManager.add(request);
      await new Promise<void>((resolve) => {
        clientRequestManager.addEventListener('offer', (event) => {
          expect(event.detail).to.equal(request.id);
          resolve();
        });
        clientRequestManager.addOffer(offer);
      });
    });
  });
});
