import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The real SftpTransport, with ssh2-sftp-client replaced. connectSftpWithRetry is unit-tested on its own
// (sftp-connect.test.ts); THIS checks the seam: the transport must keep the client the retry connected
// and run every later call on it. Assigning nothing would leave each deploy after a retry on the dead
// first client, and no other test would notice.
const state = vi.hoisted(() => ({
  instances: [] as Array<{ calls: string[] }>,
  firstConnectError: null as Error | null,
}));

vi.mock('ssh2-sftp-client', () => {
  class FakeSftp {
    readonly calls: string[] = [];
    private readonly index: number;
    constructor() {
      this.index = state.instances.length;
      state.instances.push(this);
    }
    async connect(): Promise<void> {
      this.calls.push('connect');
      if (this.index === 0 && state.firstConnectError) throw state.firstConnectError;
    }
    async stat(): Promise<never> {
      this.calls.push('stat');
      throw new Error('No such file'); // no prior manifest: a first deploy
    }
    async end(): Promise<void> {
      this.calls.push('end');
    }
  }
  return { default: FakeSftp };
});

const { defaultTransport } = await import('../src/publish/adapters.js');
const { SFTP_CONNECT_RETRY_DELAY_MS } = await import('../src/publish/sftp-connect.js');

const cfg = { protocol: 'sftp', host: 'sftp.example', user: 'u', password: 'p', remoteDir: '/site' } as const;

describe('SftpTransport — connect retry seam', () => {
  beforeEach(() => {
    state.instances.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs everything after a dropped first connect on the RETRY client', async () => {
    state.firstConnectError = new Error('getConnection: Connection lost before handshake');
    const transport = defaultTransport(cfg);
    const connecting = transport.connect();
    await vi.advanceTimersByTimeAsync(SFTP_CONNECT_RETRY_DELAY_MS);
    await connecting;
    await expect(transport.readManifest('/site')).resolves.toBeNull();
    await transport.close();
    expect(state.instances.map((c) => c.calls)).toEqual([
      ['connect', 'end'], // dropped, then closed before the retry
      ['connect', 'stat', 'end'], // the retry client did the rest
    ]);
  });

  it('makes one attempt for rejected credentials and rejects with that error', async () => {
    state.firstConnectError = new Error('getConnection: All configured authentication methods failed');
    const transport = defaultTransport(cfg);
    await expect(transport.connect()).rejects.toThrow('All configured authentication methods failed');
    expect(state.instances).toHaveLength(1);
    expect(state.instances[0]!.calls).toEqual(['connect', 'end']);
  });
});
