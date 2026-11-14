import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: unknown) => void;

/** Loads the worker against a fake worker scope and returns what it registered and did. */
async function load() {
  const handlers = new Map<string, Handler>();
  const showNotification = vi.fn(async () => undefined);
  const clients = { matchAll: vi.fn(async () => [] as { url: string; focus: () => Promise<unknown> }[]), openWindow: vi.fn(async () => null) };
  vi.stubGlobal('self', {
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    registration: { showNotification },
    clients,
    location: { origin: 'https://grid.example' },
  });
  vi.resetModules();
  await import('../../src/worker/push-worker.ts');
  return { handlers, showNotification, clients };
}

/** An event whose waitUntil keeps the promise, so the test can wait for the work. */
function eventWith(extra: object) {
  const waits: Promise<unknown>[] = [];
  return { event: { ...extra, waitUntil: (promise: Promise<unknown>) => waits.push(promise) }, done: () => Promise.all(waits) };
}

const pushOf = (json: () => unknown) => ({ data: { json } });

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the push worker', () => {
  it('handles push and notificationclick, and has no fetch handler', async () => {
    const { handlers } = await load();
    expect([...handlers.keys()].sort()).toEqual(['notificationclick', 'push']);
  });

  it('shows the called alert, tagged by handle, and renotifies', async () => {
    const { handlers, showNotification } = await load();
    const { event, done } = eventWith(pushOf(() => ({ alert: 'called', handle: 'Zap', station: 2 })));
    handlers.get('push')?.(event);
    await done();
    expect(showNotification).toHaveBeenCalledWith('Zap, go to station 2!', expect.objectContaining({ tag: 'coliseumgrid-Zap', renotify: true, icon: '/icons/icon-192.png' }));
  });

  it('shows the next alert', async () => {
    const { handlers, showNotification } = await load();
    const { event, done } = eventWith(pushOf(() => ({ alert: 'next', handle: 'Zap', station: null })));
    handlers.get('push')?.(event);
    await done();
    expect(showNotification).toHaveBeenCalledWith("Zap, you're next!", expect.anything());
  });

  it.each([
    ['JSON that throws', pushOf(() => { throw new SyntaxError('bad'); })],
    ['no data', { data: null }],
    ['a payload of the wrong shape', pushOf(() => ({ alert: 'boom' }))],
  ])('still shows a plain notification for %s', async (_name, base) => {
    const { handlers, showNotification } = await load();
    const { event, done } = eventWith(base);
    handlers.get('push')?.(event);
    await done();
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledWith('ColiseumGrid', expect.objectContaining({ body: expect.any(String) }));
  });

  it('focuses an open player page on click', async () => {
    const { handlers, clients } = await load();
    const focus = vi.fn(async () => undefined);
    clients.matchAll.mockResolvedValue([
      { url: 'https://grid.example/host', focus: vi.fn() },
      { url: 'https://grid.example/follow', focus },
    ]);
    const close = vi.fn();
    const { event, done } = eventWith({ notification: { close } });
    handlers.get('notificationclick')?.(event);
    await done();
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens the player page on click when none is open', async () => {
    const { handlers, clients } = await load();
    const { event, done } = eventWith({ notification: { close: vi.fn() } });
    handlers.get('notificationclick')?.(event);
    await done();
    expect(clients.openWindow).toHaveBeenCalledWith('/follow');
  });
});
