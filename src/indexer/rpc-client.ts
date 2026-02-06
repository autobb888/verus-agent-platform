import { config } from '../config/index.js';

interface RpcResponse<T> {
  result: T | null;
  error: { code: number; message: string } | null;
  id: string;
}

interface BlockInfo {
  hash: string;
  height: number;
  previousblockhash: string;
  tx: string[];
  time: number;
  confirmations: number;
}

interface TransactionInfo {
  txid: string;
  blockhash: string;
  blockheight: number;
  vout: Array<{
    value: number;
    scriptPubKey: {
      addresses?: string[];
      identityprimary?: {
        name: string;
        identityaddress: string;
        contentmap?: Record<string, string>;
      };
    };
  }>;
}

interface IdentityInfo {
  identity: {
    name: string;
    identityaddress: string;
    contentmap?: Record<string, string>;
    primaryaddresses: string[];
    minimumsignatures: number;
    revocationauthority: string;
    recoveryauthority: string;
  };
  status: string;
  canspendfor: boolean;
  cansignfor: boolean;
  blockheight: number;
}

export class VerusRpcClient {
  private url: string;
  private auth: string;
  private requestId = 0;

  constructor() {
    const { rpcHost, rpcPort, rpcUser, rpcPass } = config.verus;
    this.url = `http://${rpcHost}:${rpcPort}`;
    this.auth = Buffer.from(`${rpcUser}:${rpcPass}`).toString('base64');
  }

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = String(++this.requestId);
    
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${this.auth}`,
      },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as RpcResponse<T>;
    
    if (data.error) {
      throw new Error(`RPC error: ${data.error.code} - ${data.error.message}`);
    }

    return data.result as T;
  }

  // Get current blockchain info
  async getBlockchainInfo(): Promise<{ blocks: number; bestblockhash: string }> {
    return this.call('getblockchaininfo');
  }

  // Get block by height
  async getBlockByHeight(height: number): Promise<BlockInfo> {
    const hash = await this.call<string>('getblockhash', [height]);
    return this.call('getblock', [hash, 1]); // verbosity 1 for full tx list
  }

  // Get block by hash
  async getBlockByHash(hash: string): Promise<BlockInfo> {
    return this.call('getblock', [hash, 1]);
  }

  // Get transaction
  async getTransaction(txid: string): Promise<TransactionInfo> {
    return this.call('getrawtransaction', [txid, 1]); // verbosity 1 for decoded
  }

  // Get identity
  async getIdentity(nameOrAddress: string): Promise<IdentityInfo> {
    return this.call('getidentity', [nameOrAddress]);
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      await this.call('getblockchaininfo');
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let rpcClient: VerusRpcClient | null = null;

export function getRpcClient(): VerusRpcClient {
  if (!rpcClient) {
    rpcClient = new VerusRpcClient();
  }
  return rpcClient;
}
