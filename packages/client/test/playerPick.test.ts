import { describe, expect, it } from 'vitest';
import { nextPick } from '../src/pages/host/PlayerPicker.tsx';

const set = (...ids: number[]) => new Set(ids);

describe('the player pick after a reload', () => {
  it('checks everyone signed up on the first load', () => {
    expect(nextPick(set(), set(), set(1, 2, 3))).toEqual(set(1, 2, 3));
  });

  it('checks a player who just signed up and keeps the host unchecking another', () => {
    // The host unchecked 2; then 4 signed up on the tablet.
    expect(nextPick(set(1, 3), set(1, 2, 3), set(1, 2, 3, 4))).toEqual(set(1, 3, 4));
  });

  it('keeps a player the host picked from outside the event', () => {
    expect(nextPick(set(1, 2, 9), set(1, 2), set(1, 2, 3))).toEqual(set(1, 2, 3, 9));
  });

  it('unchecks the old event players once a new event starts with nobody', () => {
    expect(nextPick(set(1, 2, 3), set(1, 2, 3), set())).toEqual(set());
  });
});
