import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushSlot } from '../src/pages/phone/PushSlot.tsx';
import { pushSupport, sameKey, startState, turnOff, turnOn, unsubscribeLocal, urlBase64ToBytes, WORKER_URL } from '../src/pages/phone/pushClient.ts';

const api = vi.hoisted(() => ({ savePushSubscription: vi.fn(), removePushSubscription: vi.fn() }));
vi.mock('../src/api/phone.ts', () => api);

const bytesOf = (seed: number) => Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * seed) % 256));
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const KEY = toBase64Url(bytesOf(3));
const OTHER_KEY = toBase64Url(bytesOf(5));

interface Setup {
  secure?: boolean;
  serviceWorker?: boolean;
  pushManager?: boolean;
  notification?: boolean;
  permission?: NotificationPermission;
  /** What the prompt answers when asked. */
  asked?: NotificationPermission;
  userAgent?: string;
  standalone?: boolean;
  /** A worker is registered already, holding a subscription made with this key. */
  subscribedWith?: string;
}

/** Stubs the browser's push globals and returns the spies. */
function browser(setup: Setup = {}) {
  const { secure = true, serviceWorker = true, pushManager = true, notification = true, permission = 'default', asked = 'granted' } = setup;
  let current: ReturnType<typeof makeSubscription> | null = null;
  let registered = false;

  function makeSubscription(key: string) {
    const bytes = urlBase64ToBytes(key);
    const subscription = {
      options: { applicationServerKey: bytes.buffer },
      toJSON: () => ({ endpoint: 'https://fcm.example/send/abc', keys: { p256dh: 'P', auth: 'A' } }),
      unsubscribe: vi.fn(async () => {
        current = null;
        return true;
      }),
    };
    return subscription;
  }
  if (setup.subscribedWith) {
    current = makeSubscription(setup.subscribedWith);
    registered = true;
  }

  const manager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async (options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
      current = makeSubscription(toBase64Url(options.applicationServerKey));
      return current;
    }),
  };
  const registration = { pushManager: manager };
  const worker = {
    register: vi.fn(async () => {
      registered = true;
      return registration;
    }),
    ready: Promise.resolve(registration),
    getRegistration: vi.fn(async () => (registered ? registration : undefined)),
  };
  const requestPermission = vi.fn(async () => asked);

  vi.stubGlobal('isSecureContext', secure);
  vi.stubGlobal('navigator', {
    userAgent: setup.userAgent ?? 'Mozilla/5.0 (Linux; Android 15) Chrome/140',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    standalone: setup.standalone,
    ...(serviceWorker && { serviceWorker: worker }),
  });
  vi.stubGlobal('matchMedia', undefined);
  if (pushManager) vi.stubGlobal('PushManager', class {});
  else vi.stubGlobal('PushManager', undefined);
  if (notification) vi.stubGlobal('Notification', { permission, requestPermission });
  else vi.stubGlobal('Notification', undefined);
  return { worker, manager, requestPermission, current: () => current };
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';

beforeEach(() => {
  api.savePushSubscription.mockReset().mockResolvedValue({ ok: true, data: undefined });
  api.removePushSubscription.mockReset().mockResolvedValue({ ok: true, data: undefined });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('urlBase64ToBytes', () => {
  it('reads unpadded base64url, with the - and _ letters', () => {
    // 0xfb 0xff 0xfe is "-__-" in base64url and "+//+" in base64.
    expect([...urlBase64ToBytes('-__-')]).toEqual([0xfb, 0xff, 0xfe]);
    expect([...urlBase64ToBytes('AQID')]).toEqual([1, 2, 3]);
  });

  it('fills in the padding that base64url leaves out', () => {
    expect([...urlBase64ToBytes('AQ')]).toEqual([1]);
    expect([...urlBase64ToBytes('AQI')]).toEqual([1, 2]);
  });

  it('round-trips a P-256 public key', () => {
    const key = bytesOf(7);
    expect(urlBase64ToBytes(toBase64Url(key))).toEqual(key);
  });
});

describe('sameKey', () => {
  it('compares the bytes the subscription was made with', () => {
    const subscription = { options: { applicationServerKey: bytesOf(3).buffer } } as PushSubscription;
    expect(sameKey(subscription, bytesOf(3))).toBe(true);
    expect(sameKey(subscription, bytesOf(5))).toBe(false);
    expect(sameKey({ options: { applicationServerKey: null } } as PushSubscription, bytesOf(3))).toBe(false);
  });
});

describe('pushSupport', () => {
  it('is ok with every API', () => {
    browser();
    expect(pushSupport()).toBe('ok');
  });

  it.each([
    ['no secure context', { secure: false }],
    ['no service worker', { serviceWorker: false }],
    ['no PushManager', { pushManager: false }],
    ['no Notification', { notification: false }],
  ])('is unsupported with %s', (_name, setup) => {
    browser(setup);
    expect(pushSupport()).toBe('unsupported');
  });

  it('asks an iPhone in Safari to use the Home Screen', () => {
    browser({ pushManager: false, userAgent: IPHONE });
    expect(pushSupport()).toBe('ios-install');
  });

  it('knows an iPad that sends a Mac user agent', () => {
    browser({ pushManager: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15' });
    vi.stubGlobal('navigator', { ...globalThis.navigator, platform: 'MacIntel', maxTouchPoints: 5 });
    expect(pushSupport()).toBe('ios-install');
  });

  it('does not ask an iPhone that is already a Home Screen app', () => {
    browser({ pushManager: false, userAgent: IPHONE, standalone: true });
    expect(pushSupport()).toBe('unsupported');
  });

  it('reads the display-mode query too', () => {
    browser({ pushManager: false, userAgent: IPHONE });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' }));
    expect(pushSupport()).toBe('unsupported');
  });

  it('is ok on an iPhone Home Screen app that has push', () => {
    browser({ userAgent: IPHONE, standalone: true });
    expect(pushSupport()).toBe('ok');
  });
});

describe('startState', () => {
  it('is off for a browser with no subscription, and registers nothing', async () => {
    const b = browser();
    expect(await startState(KEY)).toBe('off');
    expect(b.worker.register).not.toHaveBeenCalled();
  });

  it('is blocked when the player said no', async () => {
    const b = browser({ permission: 'denied' });
    expect(await startState(KEY)).toBe('blocked');
    expect(b.worker.register).not.toHaveBeenCalled();
  });

  it('passes the browser support states through', async () => {
    browser({ pushManager: false });
    expect(await startState(KEY)).toBe('unsupported');
    browser({ pushManager: false, userAgent: IPHONE });
    expect(await startState(KEY)).toBe('ios-install');
  });

  it('is on with a subscription made with the same key, and tells the server again', async () => {
    const b = browser({ permission: 'granted', subscribedWith: KEY });
    expect(await startState(KEY)).toBe('on');
    expect(b.manager.subscribe).not.toHaveBeenCalled();
    expect(api.savePushSubscription).toHaveBeenCalledWith({ endpoint: 'https://fcm.example/send/abc', keys: { p256dh: 'P', auth: 'A' } });
  });

  it('replaces a subscription made with an old key', async () => {
    const b = browser({ permission: 'granted', subscribedWith: OTHER_KEY });
    expect(await startState(KEY)).toBe('on');
    expect(b.manager.subscribe).toHaveBeenCalledTimes(1);
    expect(b.manager.subscribe.mock.calls[0]?.[0]).toMatchObject({ userVisibleOnly: true });
    expect(sameKey(b.current() as unknown as PushSubscription, urlBase64ToBytes(KEY))).toBe(true);
    expect(api.savePushSubscription).toHaveBeenCalledTimes(1);
  });

  it('stays on when the server can not be reached', async () => {
    browser({ permission: 'granted', subscribedWith: KEY });
    api.savePushSubscription.mockResolvedValue({ ok: false, error: 'failed' });
    expect(await startState(KEY)).toBe('on');
  });
});

describe('turnOn', () => {
  it('asks, registers the worker, subscribes with the key, and saves it', async () => {
    const b = browser();
    expect(await turnOn(KEY)).toEqual({ state: 'on', words: null });
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    expect(b.worker.register).toHaveBeenCalledWith(WORKER_URL, { scope: '/' });
    const options = b.manager.subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect([...(options?.applicationServerKey ?? [])]).toEqual([...bytesOf(3)]);
    expect(api.savePushSubscription).toHaveBeenCalledWith({ endpoint: 'https://fcm.example/send/abc', keys: { p256dh: 'P', auth: 'A' } });
  });

  it('asks before it awaits anything else, so it still counts as the tap', async () => {
    const b = browser();
    const done = turnOn(KEY);
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    expect(b.worker.register).not.toHaveBeenCalled();
    await done;
  });

  it('is blocked when the player says no, and subscribes nothing', async () => {
    const b = browser({ asked: 'denied' });
    expect(await turnOn(KEY)).toEqual({ state: 'blocked', words: null });
    expect(b.worker.register).not.toHaveBeenCalled();
    expect(b.manager.subscribe).not.toHaveBeenCalled();
  });

  it('stays off when the question is dismissed', async () => {
    browser({ asked: 'default' });
    expect(await turnOn(KEY)).toEqual({ state: 'off', words: null });
  });

  it('keeps a subscription made with the same key', async () => {
    const b = browser({ permission: 'granted', subscribedWith: KEY });
    expect((await turnOn(KEY)).state).toBe('on');
    expect(b.manager.subscribe).not.toHaveBeenCalled();
  });

  it('says so and unsubscribes when the server refuses', async () => {
    const b = browser();
    api.savePushSubscription.mockResolvedValue({ ok: false, error: 'push-off' });
    const outcome = await turnOn(KEY);
    expect(outcome.state).toBe('off');
    expect(outcome.words).toBe("Lock screen alerts aren't on here.");
    expect(b.current()).toBeNull();
  });

  it('says so when the browser can not subscribe', async () => {
    const b = browser();
    b.manager.subscribe.mockRejectedValue(new Error('push service error'));
    const outcome = await turnOn(KEY);
    expect(outcome.state).toBe('off');
    expect(outcome.words).toMatch(/Try again/);
    expect(api.savePushSubscription).not.toHaveBeenCalled();
  });
});

describe('turnOff and unsubscribeLocal', () => {
  it('unsubscribes the browser and deletes the server row', async () => {
    const b = browser({ permission: 'granted', subscribedWith: KEY });
    expect(await turnOff()).toEqual({ state: 'off', words: null });
    expect(b.current()).toBeNull();
    expect(api.removePushSubscription).toHaveBeenCalledTimes(1);
  });

  it('drops only the browser side on sign-out, and registers nothing', async () => {
    const b = browser({ permission: 'granted', subscribedWith: KEY });
    await unsubscribeLocal();
    expect(b.current()).toBeNull();
    expect(api.removePushSubscription).not.toHaveBeenCalled();
    expect(b.worker.register).not.toHaveBeenCalled();
  });

  it('does nothing, and does not throw, with no worker or no API', async () => {
    const b = browser();
    await expect(unsubscribeLocal()).resolves.toBeUndefined();
    expect(b.worker.register).not.toHaveBeenCalled();
    browser({ serviceWorker: false });
    await expect(unsubscribeLocal()).resolves.toBeUndefined();
    const failing = browser();
    failing.worker.getRegistration.mockRejectedValue(new Error('no'));
    await expect(unsubscribeLocal()).resolves.toBeUndefined();
  });
});

describe('with no key from the server', () => {
  it('shows no control and registers nothing', () => {
    const b = browser();
    const html = PushSlot({ publicKey: null, children: () => 'control' });
    expect(html).toBeNull();
    expect(b.worker.register).not.toHaveBeenCalled();
    expect(b.worker.getRegistration).not.toHaveBeenCalled();
  });
});
