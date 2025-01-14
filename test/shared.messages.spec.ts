import {
  expect,
  expectDeepEqual,
  CustomQuery,
  CustomOfferOptions,
  createRequest,
  createOffer,
} from './setup.js';
import { mnemonicToAccount } from 'viem/accounts';
import { generateMnemonic } from '../src/utils/wallet.js';
import { supplierId as spId } from '../src/utils/uid.js';
import { randomSalt } from '@windingtree/contracts';
import { RequestData, OfferData } from '../src/shared/types.js';
import { buildOffer, verifyOffer } from '../src/shared/messages.js';

describe('Shared.messages', () => {
  const topic = 'test';
  const signer = mnemonicToAccount(generateMnemonic());
  const typedDomain = {
    chainId: 1,
    name: 'Test',
    version: '1',
    contract: signer.address,
  };
  const supplierId = spId(randomSalt(), signer.address);

  let request: RequestData<CustomQuery>;

  before(async () => {
    request = await createRequest(topic);
  });

  describe('#buildRequest', () => {
    it('should build a request', async () => {
      await expect(createRequest(topic)).to.not.rejected;
      await expect(createRequest(topic, '1h')).to.not.rejected;
    });
  });

  describe('#buildOffer', () => {
    it('should build an offer', async () => {
      try {
        await createOffer(request, '30s', typedDomain, supplierId, signer);
      } catch (error) {
        console.log(error);
      }
      await expect(
        createOffer(request, BigInt(1), typedDomain, supplierId, signer),
      ).to.not.rejected;
      await expect(createOffer(request, '30s', typedDomain, supplierId, signer))
        .to.not.rejected;
    });

    describe('Offer restoration', () => {
      let offer: OfferData<CustomQuery, CustomOfferOptions>;

      before(async () => {
        offer = await createOffer(
          request,
          BigInt(1),
          typedDomain,
          supplierId,
          signer,
        );
      });

      it('should restore an offer from raw data', async () => {
        const fromRaw = await buildOffer<CustomQuery, CustomOfferOptions>({
          domain: typedDomain,
          account: signer,
          supplierId,
          expire: offer.expire,
          request: offer.request,
          options: offer.options,
          payment: offer.payment,
          cancel: offer.cancel,
          checkIn: offer.payload.checkIn,
          checkOut: offer.payload.checkOut,
          transferable: offer.payload.transferable,
          idOverride: offer.id,
          signatureOverride: offer.signature,
        });
        expectDeepEqual(fromRaw, offer);
      });

      it('should throw is signatureOverride not been provided', async () => {
        await expect(
          buildOffer<CustomQuery, CustomOfferOptions>({
            domain: typedDomain,
            supplierId,
            expire: offer.expire,
            request: offer.request,
            options: offer.options,
            payment: offer.payment,
            cancel: offer.cancel,
            checkIn: offer.payload.checkIn,
            checkOut: offer.payload.checkOut,
            transferable: offer.payload.transferable,
            idOverride: offer.id,
          }),
        ).to.rejectedWith(
          'Either account or signatureOverride must be provided with options',
        );
      });
    });
  });

  describe('#verifyOffer', () => {
    let offer: OfferData<CustomQuery, CustomOfferOptions>;

    before(async () => {
      offer = await createOffer(
        request,
        BigInt(1),
        typedDomain,
        supplierId,
        signer,
      );
    });

    it('should throw if wrong signer provided', async () => {
      const unknownSigner = mnemonicToAccount(generateMnemonic());
      await expect(
        verifyOffer({
          domain: typedDomain,
          address: unknownSigner.address,
          offer,
        }),
      ).to.rejectedWith(`Invalid offer signer ${unknownSigner.address}`);
    });

    it('should verify an offer', async () => {
      await expect(
        verifyOffer({
          domain: typedDomain,
          address: signer.address,
          offer,
        }),
      ).to.not.rejected;
    });
  });
});
