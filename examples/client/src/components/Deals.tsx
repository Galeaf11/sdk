import { useState, useCallback, useEffect } from 'react';
import { DateTime } from 'luxon';
import { Address } from 'viem';
import { Client, DealRecord, DealStatus } from '../../../../src/index.js'; // @windingtree/sdk
import { RequestQuery, OfferOptions } from '../../../shared/index.js';
import { centerEllipsis, formatBalance, parseWalletError } from '../utils.js';
import { useWallet } from '../providers/WalletProvider/WalletProviderContext.js';

export type DealsRegistryRecord = Required<DealRecord<RequestQuery, OfferOptions>>;

export interface DealsProps {
  deals: DealsRegistryRecord[];
  client?: Client<RequestQuery, OfferOptions>;
}

export interface TransferFormProps {
  deal?: DealsRegistryRecord;
  client?: Client<RequestQuery, OfferOptions>;
  onClose: () => void
}

export interface CancelProps {
  deal?: DealsRegistryRecord;
  client?: Client<RequestQuery, OfferOptions>;
  onClose: () => void
}

// Transfer deal to...
export const TransferForm = ({ deal, client, onClose }: TransferFormProps) => {
  const { publicClient, walletClient } = useWallet();
  const [to, setTo] = useState<string>('');
  const [tx, setTx] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);

  const close = () => {
    setTo('');
    setTx(undefined);
    setError(undefined);
    setLoading(false);
    setSuccess(false);
    onClose();
  };

  const transferHandler = useCallback(
    async () => {
      try {
        setTx(undefined);
        setError(undefined);
        setLoading(true);

        if (!client || !deal) {
          throw new Error('Client not ready');
        }

        if (!publicClient || !walletClient) {
          throw new Error('Ethereum client not ready');
        }

        await client.deals.transfer(deal.offer.payload.id, to as Address, walletClient, setTx);
        setLoading(false);
        setSuccess(true);
      } catch (err) {
        console.log(err);
        setError(parseWalletError(err));
        setLoading(false);
      }
    },
    [client, deal, to, publicClient, walletClient],
  );

  if (!client || !deal) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column'}}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', alignContent: 'space-between' }}>
        <div>
          <h3>Transfer deal {centerEllipsis(deal.offer.payload.id)}</h3>
        </div>
        <div style={{ marginLeft: 10 }}>
          <button onClick={close}>Close</button>
        </div>
      </div>
      {success &&
        <div>
          Deal has been successfully transferred to: {to}
        </div>
      }
      {!success &&
        <div>
          <strong style={{ marginRight: 10 }}>To (address):</strong>
          <input value={to} onChange={(e) => setTo(e.target.value)} />
          <button
            style={{ marginLeft: 10 }}
            onClick={transferHandler}
          >
            Send "transfer" transaction
          </button>
          {tx && <div style={{ marginTop: 20 }}>Tx hash: {tx}</div>}
          {loading && <div style={{ marginTop: 20 }}>Loading...</div>}
        </div>
      }
      <div>
        {error && (
          <div style={{ marginTop: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.1)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

// Cancel the deal
export const Cancel = ({ deal, client, onClose }: CancelProps) => {
  const { publicClient, walletClient } = useWallet();
  const [tx, setTx] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);

  const close = () => {
    setTx(undefined);
    setError(undefined);
    setLoading(false);
    setSuccess(false);
    onClose();
  };

  const cancelHandler = useCallback(
    async () => {
      try {
        setTx(undefined);
        setError(undefined);
        setLoading(true);

        if (!client || !deal) {
          throw new Error('Client not ready');
        }

        if (!publicClient || !walletClient) {
          throw new Error('Ethereum client not ready');
        }

        await client.deals.cancel(deal.offer.payload.id, walletClient, setTx);
        setLoading(false);
        setSuccess(true);
      } catch (err) {
        console.log(err);
        setError(parseWalletError(err));
        setLoading(false);
      }
    },
    [client, deal, publicClient, walletClient],
  );

  if (!client || !deal) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column'}}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', alignContent: 'space-between' }}>
        <div>
          <h3>Cancel deal {centerEllipsis(deal.offer.payload.id)}</h3>
        </div>
        <div style={{ marginLeft: 10 }}>
          <button onClick={close}>Close</button>
        </div>
      </div>
      {success &&
        <div>Deal has be successfully cancelled</div>
      }
      {!success &&
        <div>
          <button
            style={{ marginLeft: 10 }}
            onClick={cancelHandler}
          >
            Send "cancel" transaction
          </button>
          {tx && <div style={{ marginTop: 20 }}>Tx hash: {tx}</div>}
          {loading && <div style={{ marginTop: 20 }}>Loading...</div>}
        </div>
      }
      <div>
        {error && (
          <div style={{ marginTop: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.1)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Created deals table
 */
export const Deals = ({ deals, client }: DealsProps) => {
  const [dealStates, setDealStates] = useState<Record<string, DealStatus>>({});
  const [transferDeal, setTransferDeal] = useState<DealsRegistryRecord | undefined>();
  const [cancelDeal, setCancelDeal] = useState<DealsRegistryRecord | undefined>();

  useEffect(() => {
    if (deals && deals.length > 0) {
      const expireHandler = () => {
        const newDealStates: Record<string, DealStatus> = {};
        deals.forEach((d) => {
          newDealStates[d.offer.id] = d.status;
        });
        setDealStates(newDealStates);
      };

      const interval = setInterval(expireHandler, 1000);
      expireHandler();

      return () => clearInterval(interval);
    }
  }, [deals]);

  if (!client || deals.length === 0) {
    return null;
  }

  return (
    <div style={{ marginTop: 20 }}>
      <table border={1} cellPadding={5}>
        <thead>
          <tr>
            <td>Asset</td>
            <td>Buyer</td>
            <td>Created</td>
            <td>Offer</td>
            <td>Price</td>
            <td>Status</td>
            <td>Action</td>
          </tr>
        </thead>
        <tbody>
          {deals.map((d, index) => (
            <tr key={index}>
              <td>{centerEllipsis(d.asset)}</td>
              <td>{centerEllipsis(d.buyer)}</td>
              <td>{DateTime.fromSeconds(Number(d.created)).toISODate()}</td>
              <td>{centerEllipsis(d.offer.payload.id)}</td>
              <td>{formatBalance(d.price, 4)}</td>
              <td style={{ color: dealStates[d.offer.id] === 1 ? 'green' : 'red' }}>{DealStatus[dealStates[d.offer.id]]}</td>
              <td>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ marginBottom: 5 }}>
                    <button
                      onClick={() => setCancelDeal(d)}
                      disabled={
                        ![0, 1].includes(dealStates[d.offer.id]) ||
                        (transferDeal && transferDeal.offer.payload.id === d.offer.payload.id) ||
                        (cancelDeal && cancelDeal.offer.payload.id === d.offer.payload.id)
                      }
                    >
                      Cancel
                    </button>
                  </div>
                  <div>
                    <button
                      onClick={() => setTransferDeal(d)}
                      disabled={
                        ![0, 1].includes(dealStates[d.offer.id]) ||
                        (transferDeal && transferDeal.offer.payload.id === d.offer.payload.id) ||
                        (cancelDeal && cancelDeal.offer.payload.id === d.offer.payload.id)
                      }
                    >
                      Transfer
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 20 }}>
        <TransferForm
          deal={transferDeal}
          client={client}
          onClose={() => setTransferDeal(undefined)}
        />
        <Cancel
          deal={cancelDeal}
          client={client}
          onClose={() => setCancelDeal(undefined)}
        />
      </div>
    </div>
  );
};
