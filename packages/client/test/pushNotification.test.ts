import { describe, expect, it } from 'vitest';
import { calledWords, nextWords } from '../src/pages/phone/phoneWords.ts';
import { isFollowPage, notificationFor, parsePushAlert } from '../src/pages/phone/pushNotification.ts';

describe('parsePushAlert', () => {
  it('reads what the server sends', () => {
    expect(parsePushAlert({ alert: 'called', handle: 'Zap', station: 2 })).toEqual({ alert: 'called', handle: 'Zap', station: 2 });
    expect(parsePushAlert({ alert: 'next', handle: 'Zap', station: null })).toEqual({ alert: 'next', handle: 'Zap', station: null });
  });

  it('takes a missing station as none', () => {
    expect(parsePushAlert({ alert: 'called', handle: 'Zap' })).toEqual({ alert: 'called', handle: 'Zap', station: null });
  });

  it.each([
    ['null', null],
    ['a string', 'called'],
    ['a number', 7],
    ['an array', ['called']],
    ['an unknown alert', { alert: 'later', handle: 'Zap', station: null }],
    ['no alert', { handle: 'Zap', station: 1 }],
    ['no handle', { alert: 'called', station: 1 }],
    ['an empty handle', { alert: 'called', handle: '  ', station: 1 }],
    ['a handle that is not a string', { alert: 'called', handle: 4, station: 1 }],
    ['a handle that is far too long', { alert: 'called', handle: 'x'.repeat(65), station: 1 }],
    ['a station that is a string', { alert: 'called', handle: 'Zap', station: '2' }],
    ['a station of 0', { alert: 'called', handle: 'Zap', station: 0 }],
    ['a station that is not whole', { alert: 'called', handle: 'Zap', station: 1.5 }],
  ])('refuses %s', (_name, data) => {
    expect(parsePushAlert(data)).toBeNull();
  });
});

describe('notificationFor', () => {
  it('uses the same words as the page', () => {
    expect(notificationFor({ alert: 'called', handle: 'Zap', station: 2 }).title).toBe(calledWords('Zap', 2));
    expect(notificationFor({ alert: 'called', handle: 'Zap', station: 2 }).title).toBe('Zap, go to station 2!');
    expect(notificationFor({ alert: 'called', handle: 'Zap', station: null }).title).toBe("Zap, you're up!");
    expect(notificationFor({ alert: 'next', handle: 'Zap', station: null }).title).toBe(nextWords('Zap'));
  });

  it('gives each handle its own tag, so a newer alert replaces the older one', () => {
    const called = notificationFor({ alert: 'called', handle: 'Zap', station: 2 });
    const next = notificationFor({ alert: 'next', handle: 'Zap', station: null });
    expect(called.tag).toBe(next.tag);
    expect(called.tag).not.toBe(notificationFor({ alert: 'next', handle: 'Kai', station: null }).tag);
  });

  it('is still a notification when the payload was not readable', () => {
    const plain = notificationFor(null);
    expect(plain.title).toBe('ColiseumGrid');
    expect(plain.body).toBeTruthy();
    expect(plain.tag).toBeTruthy();
  });
});

describe('isFollowPage', () => {
  const origin = 'https://grid.example';
  it('matches the player page with or without a query', () => {
    expect(isFollowPage(`${origin}/follow`, origin)).toBe(true);
    expect(isFollowPage(`${origin}/follow?code=K7M4QX`, origin)).toBe(true);
  });
  it('does not match other pages or other sites', () => {
    expect(isFollowPage(`${origin}/host`, origin)).toBe(false);
    expect(isFollowPage(`${origin}/follow/x`, origin)).toBe(false);
    expect(isFollowPage('https://other.example/follow', origin)).toBe(false);
    expect(isFollowPage('http://[bad', origin)).toBe(false);
  });
});
