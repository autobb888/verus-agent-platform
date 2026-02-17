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
  confirmations?: number;
  vout: Array<{
    value: number;
    scriptPubKey: {
      addresses?: string[];
      identityprimary?: {
        name: string;
        identityaddress: string;
        contentmap?: Record<string, string>;
        contentmultimap?: Record<string, string[]>;
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

    // Verus daemon returns HTTP 500 for RPC-level errors (e.g. "Identity not found"),
    // so we must parse the JSON body before rejecting on HTTP status.
    const data = (await response.json()) as RpcResponse<T>;
    
    if (data.error) {
      throw new Error(`RPC error: ${data.error.code} - ${data.error.message}`);
    }

    if (!response.ok) {
      throw new Error(`RPC HTTP error: ${response.status} ${response.statusText}`);
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

  // Verify a signed message (VerusID signature)
  async verifyMessage(identity: string, message: string, signature: string): Promise<boolean> {
    try {
      // checklatest=true: verify against current chain tip identity, not at signature's blockHeight
      // This allows offline signing with blockHeight=0 (SDK agents without daemon access)
      const result = await this.call<boolean>('verifymessage', [identity, signature, message, true]);
      return result === true;
    } catch (error) {
      // Log but don't throw - invalid signatures return false
      console.error('[RPC] verifyMessage error:', error);
      return false;
    }
  }

  // Sign a message (for testing - requires wallet access)
  async signMessage(identity: string, message: string): Promise<string> {
    const result = await this.call<{ hash: string; signature: string }>('signmessage', [identity, message]);
    return result.signature;
  }

  // Sign data using signdata RPC (for VerusID login consent)
  async signData(params: { address: string; datahash?: string; message?: string }): Promise<{ hash: string; signature: string }> {
    return this.call('signdata', [params]);
  }

  // Verify signature using verifysignature RPC
  async verifySignature(params: { address: string; vdxfdata?: string; hash?: string; signature?: string }): Promise<{ valid: boolean }> {
    return this.call('verifysignature', [params]);
  }

  // Generic RPC call for custom methods
  async rpcCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.call<T>(method, params);
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
