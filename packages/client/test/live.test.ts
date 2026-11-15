import { describe, expect, it } from 'vitest';
import { RECONNECT_MAX_MS, RECONNECT_MIN_MS, liveUrl, parseLiveMessage, reconnectDelay } from '../src/api/live.ts';

describe('reconnect delay', () => {
  it('starts near 1 second and doubles', () => {
    // random() = 1 is the top of the jitter range; 0 is the bottom (half the wait).
    const top = [0, 1, 2, 3, 4].map((attempt) => reconnectDelay(attempt, () => 1));
    expect(top).toEqual([1000, 2000, 4000, 8000, 16000]);
    const bottom = [0, 1, 2, 3, 4].map((attempt) => reconnectDelay(attempt, () => 0));
    expect(bottom).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it('never goes past 30 seconds, however many tries have failed', () => {
    for (const attempt of [5, 6, 20, 1000]) {
      expect(reconnectDelay(attempt, () => 1)).toBe(RECONNECT_MAX_MS);
      expect(reconnectDelay(attempt, () => 0)).toBe(RECONNECT_MAX_MS / 2);
    }
  });

  it('adds jitter inside the range, from real randomness', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const ceiling = Math.min(RECONNECT_MIN_MS * 2 ** attempt, RECONNECT_MAX_MS);
      const delay = reconnectDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe('live address', () => {
  it('uses ws on an http page and wss on an https page', () => {
    expect(liveUrl({ protocol: 'http:', host: '10.0.0.5:8080' })).toBe('ws://10.0.0.5:8080/api/live');
    expect(liveUrl({ protocol: 'https:', host: 'play.example.com' })).toBe('wss://play.example.com/api/live');
  });
});

describe('live messages', () => {
  it('reads the messages the server sends', () => {
    expect(parseLiveMessage('{"type":"players"}')).toEqual({ type: 'players' });
    expect(parseLiveMessage('{"type":"unpaired"}')).toEqual({ type: 'unpaired' });
    expect(parseLiveMessage('{"type":"bracket"}')).toEqual({ type: 'bracket' });
    expect(parseLiveMessage('{"type":"heats"}')).toEqual({ type: 'heats' });
    expect(parseLiveMessage('{"type":"plan"}')).toEqual({ type: 'plan' });
    expect(parseLiveMessage('{"type":"event","event":{"name":"Spring Bash","game":"Tag"}}')).toEqual({
      type: 'event',
      event: { name: 'Spring Bash', game: 'Tag' },
    });
    // A game that is missing or not text is no game.
    expect(parseLiveMessage('{"type":"event","event":{"name":"Spring Bash","game":null}}')).toEqual({
      type: 'event',
      event: { name: 'Spring Bash', game: null },
    });
    expect(parseLiveMessage('{"type":"event","event":null}')).toEqual({ type: 'event', event: null });
  });

  it('keeps only the fields it knows', () => {
    expect(parseLiveMessage('{"type":"event","event":{"name":"A","extra":1}}')).toEqual({ type: 'event', event: { name: 'A', game: null } });
  });

  it('ignores anything else', () => {
    for (const data of ['', 'nope', 'null', '7', '[]', '{}', '{"type":"other"}', '{"type":"event"}', '{"type":"event","event":{"name":3}}']) {
      expect(parseLiveMessage(data)).toBeNull();
    }
    expect(parseLiveMessage(new ArrayBuffer(2))).toBeNull();
  });
});
