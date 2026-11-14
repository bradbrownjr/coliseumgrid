// The PIN check against a host that changes the PIN while it runs (docs/PLAN.md, "Player view",
// "Signing in, two ways"), and what an unknown handle costs. verifyPin is wrapped so a test can
// hold a check after its hash is done and do the reset in that gap, which a real race only
// hits by luck.

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppOptions } from '../src/app.ts';
import { openDatabase, type Database } from '../src/database.ts';
import { CLAIM_MAX_WRONG_PER_HANDLE } from '../src/rate-limit.ts';
import { makeCallers, type Api, type Callers } from './bracket-api-helpers.ts';
import { HOST_PASSWORD, REMOTE, signInHost } from './helpers.ts';
import { PHONE_IP, PIN, addPinPlayers, from, otherIp } from './phone-helpers.ts';

const gate = vi.hoisted(() => ({
  /** Every verifyPin call since the test began. */
  calls: 0,
  /** When set, a verifyPin call waits for it after its hash is done. */
  hold: undefined as Promise<void> | undefined,
  /** Called once a held verifyPin has its hash. */
  entered: undefined as (() => void) | undefined,
}));

vi.mock('../src/pin-hash.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/pin-hash.ts')>();
  return {
    ...actual,
    async verifyPin(pin: string, stored: string): Promise<boolean> {
      gate.calls++;
      const right = await actual.verifyPin(pin, stored);
      const { hold, entered } = gate;
      entered?.();
      await hold;
      return right;
    },
  };
});

let app: FastifyInstance;
let db: Database;
let callers: Callers;
let ids: number[];
let host: Api;

async function start(options: AppOptions = {}): Promise<void> {
  db = openDatabase(':memory:');
  app = await buildApp({ db, ...options });
  await app.ready();
  ids = addPinPlayers(db, 3);
  // Online has no localhost host and the helper's pairing doesn't apply, so the host signs in with the password.
  if (options.mode === 'online') host = from(app, REMOTE, await signInHost(app, REMOTE));
  else {
    callers = await makeCallers(app);
    host = callers.host;
  }
  gate.calls = 0;
}

beforeEach(() => start());
afterEach(async () => {
  gate.hold = undefined;
  gate.entered = undefined;
  await app.close();
});

const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Holds the next verifyPin after its hash is done; `release` lets it finish. Resolves `inFlight` once it is held. */
function holdNextCheck(): { inFlight: Promise<void>; release: () => void } {
  let release!: () => void;
  let entered!: () => void;
  gate.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inFlight = new Promise<void>((resolve) => {
    entered = resolve;
  });
  gate.entered = entered;
  return { inFlight, release };
}

/** The gap is open: later checks are not held. */
function endGate(): void {
  gate.hold = undefined;
  gate.entered = undefined;
}

describe('a PIN reset while a check is running', () => {
  it('leaves no phone follow when the old PIN was right at the start of the follow', async () => {
    const held = holdNextCheck();
    const pending = from(app, PHONE_IP)('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    await held.inFlight;
    endGate();
    expect((await host('POST', `/api/players/${ids[0]}/reset-pin`)).statusCode).toBe(200);
    held.release();
    const res = await pending;
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'wrong-pin' });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(count('phones')).toBe(0);
    expect(count('phone_follows')).toBe(0);
  });

  it('leaves no follow code with the old PIN when a claim straddles the reset', async () => {
    const held = holdNextCheck();
    const pending = callers.signup('POST', '/api/signup/claim', { handle: 'Player1', pin: PIN });
    await held.inFlight;
    endGate();
    expect((await host('POST', `/api/players/${ids[0]}/reset-pin`)).statusCode).toBe(200);
    held.release();
    const res = await pending;
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'wrong-pin' });
    expect(count('follow_codes')).toBe(0);
    expect(count('event_players')).toBe(0);
  });

  it('refuses a follow that straddles a rename of the player too', async () => {
    const held = holdNextCheck();
    const pending = from(app, PHONE_IP)('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    await held.inFlight;
    endGate();
    expect((await host('PATCH', `/api/players/${ids[0]}`, { handle: 'Renamed' })).statusCode).toBe(200);
    held.release();
    expect((await pending).statusCode).toBe(401);
    expect(count('phone_follows')).toBe(0);
  });

  it('does not count the refused try as a wrong one: the handle still has all 5', async () => {
    await app.close();
    await start({ mode: 'online', hostPassword: HOST_PASSWORD });
    const held = holdNextCheck();
    const pending = from(app, PHONE_IP)('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    await held.inFlight;
    endGate();
    expect((await host('POST', `/api/players/${ids[0]}/reset-pin`)).statusCode).toBe(200);
    held.release();
    expect((await pending).statusCode).toBe(401);
    // abcd is not a PIN: wrong without a hash, and counted. The reset cleared the count, and
    // the refused try left nothing, so all 5 are free and the 6th is the first to be refused.
    for (let i = 0; i < CLAIM_MAX_WRONG_PER_HANDLE; i++) {
      expect((await from(app, otherIp(10 + i))('POST', '/api/phone/follow', { handle: 'Player1', pin: 'abcd' })).statusCode).toBe(401);
    }
    expect((await from(app, otherIp(40))('POST', '/api/phone/follow', { handle: 'Player1', pin: 'abcd' })).statusCode).toBe(429);
  });

  it('still lets a follow that no reset touched through', async () => {
    const held = holdNextCheck();
    const pending = from(app, PHONE_IP)('POST', '/api/phone/follow', { handle: 'Player1', pin: PIN });
    await held.inFlight;
    endGate();
    held.release();
    expect((await pending).statusCode).toBe(201);
    expect(count('phone_follows')).toBe(1);
  });
});

describe('an unknown handle on the phone route', () => {
  const follow = (handle: string, pin: string, ip = PHONE_IP) => from(app, ip)('POST', '/api/phone/follow', { handle, pin });

  it('spends one hash, like a wrong PIN for a handle that exists', async () => {
    await follow('Player1', '0000');
    const forKnown = gate.calls;
    await follow('Nobody', '0000', otherIp(2));
    expect(forKnown).toBe(1);
    expect(gate.calls - forKnown).toBe(1);
  });

  it('spends none for something that is not a PIN, as a real handle does not either', async () => {
    await follow('Player1', 'abcd');
    await follow('Nobody', 'abcd', otherIp(2));
    expect(gate.calls).toBe(0);
  });
});
