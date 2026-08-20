import { createDatabaseClient, type WorkerLike } from './client';
import { DatabaseError } from './sql-executor';
import type { DbRequest, DbResponse } from './protocol';

interface FakeWorker extends WorkerLike {
  readonly sent: DbRequest[];
  emitMessage(response: DbResponse): void;
  emitError(message: string): void;
  readonly terminated: boolean;
}

function createFakeWorker(): FakeWorker {
  const sent: DbRequest[] = [];
  let messageListener: ((event: MessageEvent<DbResponse>) => void) | undefined;
  let errorListener: ((event: ErrorEvent) => void) | undefined;
  let terminated = false;

  return {
    sent,
    get terminated() {
      return terminated;
    },
    postMessage(message) {
      sent.push(message as DbRequest);
    },
    addEventListener(
      ...args:
        | [type: 'message', listener: (event: MessageEvent<DbResponse>) => void]
        | [type: 'error', listener: (event: ErrorEvent) => void]
    ) {
      const [type, listener] = args;
      if (type === 'message') {
        messageListener = listener;
      } else {
        errorListener = listener;
      }
    },
    terminate() {
      terminated = true;
    },
    emitMessage(response) {
      messageListener?.({ data: response } as MessageEvent<DbResponse>);
    },
    emitError(message) {
      errorListener?.({ message } as ErrorEvent);
    },
  };
}

describe('createDatabaseClient id correlation', () => {
  it('resolves each promise with the response matching its own request id, out of order', async () => {
    const worker = createFakeWorker();
    const client = createDatabaseClient(worker);

    const first = client.load();
    const second = client.load();
    expect(worker.sent).toHaveLength(2);
    const firstId = worker.sent[0]?.id;
    const secondId = worker.sent[1]?.id;
    expect(firstId).not.toBe(secondId);

    // Respond to the SECOND request first.
    worker.emitMessage({ id: secondId!, ok: true, result: 'second-result' });
    worker.emitMessage({ id: firstId!, ok: true, result: 'first-result' });

    await expect(second).resolves.toBe('second-result');
    await expect(first).resolves.toBe('first-result');
  });

  it('ignores a response whose id has no matching in-flight request', async () => {
    const worker = createFakeWorker();
    const client = createDatabaseClient(worker);

    const pending = client.load();
    worker.emitMessage({ id: 9999, ok: true, result: 'nobody-asked' });
    worker.emitMessage({ id: worker.sent[0]!.id, ok: true, result: 'real-result' });

    await expect(pending).resolves.toBe('real-result');
  });
});

describe('createDatabaseClient error propagation', () => {
  it('rejects with a DatabaseError carrying the worker message on { ok: false }', async () => {
    const worker = createFakeWorker();
    const client = createDatabaseClient(worker);

    const pending = client.load();
    worker.emitMessage({ id: worker.sent[0]!.id, ok: false, error: 'board is corrupt' });

    await expect(pending).rejects.toBeInstanceOf(DatabaseError);
    await expect(pending).rejects.toThrow('board is corrupt');
  });
});

describe('createDatabaseClient worker crash', () => {
  it('rejects every in-flight promise when the worker fires an "error" event', async () => {
    const worker = createFakeWorker();
    const client = createDatabaseClient(worker);

    const first = client.load();
    const second = client.send({
      kind: 'setDrafted',
      boardId: 'b1',
      playerId: 'p1',
      drafted: true,
    });

    worker.emitError('out of memory');

    await expect(first).rejects.toBeInstanceOf(DatabaseError);
    await expect(first).rejects.toThrow(/out of memory/);
    await expect(second).rejects.toBeInstanceOf(DatabaseError);
    await expect(second).rejects.toThrow(/out of memory/);
  });
});

describe('createDatabaseClient close', () => {
  it('terminates the worker and refuses further sends', async () => {
    const worker = createFakeWorker();
    const client = createDatabaseClient(worker);

    client.close();
    expect(worker.terminated).toBe(true);

    await expect(client.load()).rejects.toBeInstanceOf(DatabaseError);
  });
});
