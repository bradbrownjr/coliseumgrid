// The hub against a stand-in socket, for what a real client can't be made to do over injectWS's
// in-memory streams: a client that stops reading, so a send never completes and a close frame
// is never answered.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveHub, type LiveHub, type LiveSocket } from '../src/live.ts';

class StalledSocket implements LiveSocket {
  readyState = 1;
  sent: string[] = [];
  closedWith: number | undefined;
  terminated = false;
  readonly #listeners = new Map<string, Array<() => void>>();
  /** Send callbacks that never ran, because the client is not reading. */
  stuck: Array<(error?: Error) => void> = [];

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    if (callback) this.stuck.push(callback);
  }
  close(code?: number): void {
    this.closedWith = code;
  }
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
    this.#emit('close');
  }
  ping(): void {}
  on(event: 'pong' | 'close', listener: () => void): this {
    this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener]);
    return this;
  }
  /** The peer answers: the connection closes normally. */
  peerCloses(): void {
    this.readyState = 3;
    this.#emit('close');
  }
  #emit(event: string): void {
    for (const listener of this.#listeners.get(event) ?? []) listener();
  }
}

let hub: LiveHub;
beforeEach(() => {
  vi.useFakeTimers();
  hub = createLiveHub(60_000);
});
afterEach(() => {
  hub.stop();
  vi.useRealTimers();
});

function attach(info: { deviceId?: number; phoneId?: number; sessionHash?: string; local?: boolean; hostAllowed?: () => boolean; stillAllowed?: () => boolean }): StalledSocket {
  const socket = new StalledSocket();
  hub.attach(socket, { stillAllowed: () => true, ...info });
  return socket;
}

describe('a connection that stops reading', () => {
  it('is terminated a couple of seconds after the unpaired message, when its send never finishes', () => {
    const socket = attach({ deviceId: 1 });
    hub.unpair(1);
    expect(socket.sent).toEqual(['{"type":"unpaired"}']);
    expect(socket.terminated).toBe(false);
    vi.advanceTimersByTime(1_900);
    expect(socket.terminated).toBe(false);
    vi.advanceTimersByTime(200);
    expect(socket.terminated).toBe(true);
  });

  it('is left alone when the connection closes within the grace period', () => {
    const socket = attach({ deviceId: 1 });
    hub.unpair(1);
    socket.stuck[0]?.();
    expect(socket.closedWith).toBe(1000);
    socket.peerCloses();
    vi.advanceTimersByTime(10_000);
    expect(socket.terminated).toBe(false);
  });

  it('is terminated a couple of seconds after a host sign-out, when its send never finishes', () => {
    const socket = attach({ sessionHash: 'abc', hostAllowed: () => true });
    hub.endSession('abc');
    expect(socket.sent).toEqual(['{"type":"unpaired"}']);
    expect(socket.terminated).toBe(false);
    vi.advanceTimersByTime(2_100);
    expect(socket.terminated).toBe(true);
  });

  it('is terminated after a session-expiry close at the heartbeat that the client never answers', () => {
    const socket = attach({ stillAllowed: () => false });
    vi.advanceTimersByTime(60_000);
    expect(socket.closedWith).toBe(1008);
    expect(socket.terminated).toBe(false);
    vi.advanceTimersByTime(2_100);
    expect(socket.terminated).toBe(true);
  });
});

describe('signing out a phone', () => {
  it('sends unpaired to that phone only, cuts one that stops reading, and leaves a device with the same number alone', () => {
    const phone = attach({ phoneId: 1 });
    const otherPhone = attach({ phoneId: 2 });
    const device = attach({ deviceId: 1 });
    hub.signOutPhone(1);
    expect(phone.sent).toEqual(['{"type":"unpaired"}']);
    expect(otherPhone.sent).toEqual([]);
    expect(device.sent).toEqual([]);
    vi.advanceTimersByTime(2_100);
    expect(phone.terminated).toBe(true);
    expect(otherPhone.terminated).toBe(false);
  });
});

describe('a connection with more than one identity', () => {
  it('signing out its phone drops only the phone when it is also a device, a host session, or the laptop', () => {
    const withDevice = attach({ phoneId: 1, deviceId: 5 });
    const withSession = attach({ phoneId: 1, sessionHash: 'abc' });
    const laptop = attach({ phoneId: 1, local: true });
    const phoneOnly = attach({ phoneId: 1 });
    hub.signOutPhone(1);
    for (const socket of [withDevice, withSession, laptop]) expect(socket.sent).toEqual([]);
    expect(phoneOnly.sent).toEqual(['{"type":"unpaired"}']);
    vi.advanceTimersByTime(2_100);
    for (const socket of [withDevice, withSession, laptop]) expect(socket.terminated).toBe(false);
    expect(phoneOnly.terminated).toBe(true);
  });

  it('unpairing its device drops only the device when it is also a phone, a host session, or the laptop', () => {
    const withPhone = attach({ deviceId: 1, phoneId: 5 });
    const withSession = attach({ deviceId: 1, sessionHash: 'abc' });
    const laptop = attach({ deviceId: 1, local: true });
    const deviceOnly = attach({ deviceId: 1 });
    hub.unpair(1);
    for (const socket of [withPhone, withSession, laptop]) expect(socket.sent).toEqual([]);
    expect(deviceOnly.sent).toEqual(['{"type":"unpaired"}']);
    vi.advanceTimersByTime(2_100);
    for (const socket of [withPhone, withSession, laptop]) expect(socket.terminated).toBe(false);
    expect(deviceOnly.terminated).toBe(true);
  });

  it('signing out the host session drops only the session when it is also a device, a phone, or the laptop', () => {
    const withDevice = attach({ sessionHash: 'abc', deviceId: 1, hostAllowed: () => true });
    const withPhone = attach({ sessionHash: 'abc', phoneId: 1, hostAllowed: () => true });
    const laptop = attach({ sessionHash: 'abc', local: true, hostAllowed: () => true });
    const hostOnly = attach({ sessionHash: 'abc', hostAllowed: () => true });
    const otherSession = attach({ sessionHash: 'xyz', hostAllowed: () => true });
    hub.endSession('abc');
    for (const socket of [withDevice, withPhone, laptop, otherSession]) expect(socket.sent).toEqual([]);
    expect(hostOnly.sent).toEqual(['{"type":"unpaired"}']);
    hostOnly.stuck[0]?.();
    expect(hostOnly.closedWith).toBe(1000);
    vi.advanceTimersByTime(2_100);
    for (const socket of [withDevice, withPhone, laptop, otherSession]) expect(socket.terminated).toBe(false);
    expect(hostOnly.terminated).toBe(true);
  });

  it('a device whose host session ended keeps getting broadcasts, but no longer the host-only ones', () => {
    // hostAllowed stays true here, so only the sign-out itself can take the host messages away.
    const both = attach({ sessionHash: 'abc', deviceId: 1, hostAllowed: () => true });
    const laptop = attach({ sessionHash: 'abc', local: true, hostAllowed: () => true });
    hub.endSession('abc');
    hub.broadcast({ type: 'players' });
    hub.broadcastToHosts({ type: 'tags' });
    expect(both.sent).toEqual(['{"type":"players"}']);
    // The laptop is still the host without its session.
    expect(laptop.sent).toEqual(['{"type":"players"}', '{"type":"tags"}']);
    // The session is gone from the connection: unpairing the device now ends it.
    hub.unpair(1);
    expect(both.sent).toEqual(['{"type":"players"}', '{"type":"unpaired"}']);
  });

  it('ends the connection once its last identity goes, and still receives broadcasts before that', () => {
    const both = attach({ deviceId: 1, phoneId: 2 });
    hub.signOutPhone(2);
    hub.broadcast({ type: 'players' });
    expect(both.sent).toEqual(['{"type":"players"}']);
    hub.unpair(1);
    expect(both.sent).toEqual(['{"type":"players"}', '{"type":"unpaired"}']);
  });
});

describe('broadcastToHosts', () => {
  it('reaches a connection that is the host now, and no other', () => {
    const laptop = attach({ local: true, hostAllowed: () => true });
    const session = attach({ sessionHash: 'abc', hostAllowed: () => true });
    const device = attach({ deviceId: 1 });
    const phone = attach({ phoneId: 1 });
    hub.broadcastToHosts({ type: 'tags' });
    expect(laptop.sent).toEqual(['{"type":"tags"}']);
    expect(session.sent).toEqual(['{"type":"tags"}']);
    expect(device.sent).toEqual([]);
    expect(phone.sent).toEqual([]);
  });

  it('skips a connection whose host session ended, even while it stays open as a paired device', () => {
    let valid = true;
    const both = attach({ sessionHash: 'abc', deviceId: 1, hostAllowed: () => valid });
    hub.broadcastToHosts({ type: 'tags' });
    expect(both.sent).toHaveLength(1);
    valid = false;
    hub.broadcastToHosts({ type: 'tags' });
    expect(both.sent).toHaveLength(1);
    // Everything else still reaches it.
    hub.broadcast({ type: 'players' });
    expect(both.sent).toHaveLength(2);
  });
});
