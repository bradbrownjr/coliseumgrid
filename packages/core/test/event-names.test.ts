import { describe, expect, it } from 'vitest';
import {
  EVENT_NAME_MAX,
  PLAN_TEMPLATES,
  allEventNames,
  createSeededRandom,
  eventName,
  isVulgar,
  type PlanTemplate,
} from '../src/index.ts';

describe.each(PLAN_TEMPLATES)('event names for the %s template', (template: PlanTemplate) => {
  const names = allEventNames(template);

  it('has a long list of names', () => {
    expect(names.length).toBeGreaterThan(1500);
    expect(new Set(names).size).toBe(names.length);
  });

  it('makes every name at most the event name limit, with printable ASCII only', () => {
    for (const name of names) {
      expect(name.length, name).toBeGreaterThan(0);
      expect(name.length, name).toBeLessThanOrEqual(EVENT_NAME_MAX);
      expect(name, name).toBe(name.trim());
      // Printable ASCII only: no control characters, no em-dash, no emoji.
      expect([...name].every((c) => c >= ' ' && c <= '~'), name).toBe(true);
    }
  });

  it('passes the vulgarity filter as written and with the spaces taken out', () => {
    const refused = names.filter((name) => isVulgar(name) || isVulgar(name.replaceAll(' ', '')));
    expect(refused).toEqual([]);
  });

  it('never repeats a word, compounds included', () => {
    // "Knockout Knockout", "Grand Grand Prix", and "Stormstorm" read as a slip. A compound
    // repeats when it is one chunk of three or more letters written twice.
    for (const name of names) {
      const words = name.toLowerCase().split(/[\s-]+/);
      expect(new Set(words).size, name).toBe(words.length);
      for (const word of words) expect(/^(.{3,})\1$/.test(word), name).toBe(false);
    }
  });

  it('gives only names from the list', () => {
    const random = createSeededRandom(2026);
    const all = new Set(names);
    for (let i = 0; i < 500; i++) expect(all.has(eventName(template, random))).toBe(true);
  });

  it('gives the same name for the same seed and different names across seeds', () => {
    expect(eventName(template, createSeededRandom(7))).toBe(eventName(template, createSeededRandom(7)));
    const seen = new Set(Array.from({ length: 50 }, (_, seed) => eventName(template, createSeededRandom(seed))));
    expect(seen.size).toBeGreaterThan(30);
  });

  it('makes both two-word names and compounds', () => {
    const random = createSeededRandom(1);
    const made = Array.from({ length: 200 }, () => eventName(template, random));
    expect(made.some((n) => n.includes(' '))).toBe(true);
    expect(made.some((n) => !n.includes(' '))).toBe(true);
  });
});

it('keeps the words of each template apart', () => {
  const fighting = new Set(allEventNames('fighting'));
  const racing = new Set(allEventNames('racing'));
  expect(fighting.has('Thunder Showdown')).toBe(true);
  expect(racing.has('Turbo Grand Prix')).toBe(true);
  expect(fighting.has('Turbo Grand Prix')).toBe(false);
  expect(racing.has('Ninja Dojo')).toBe(false);
  expect(fighting.has('Ninja Dojo')).toBe(true);
});
