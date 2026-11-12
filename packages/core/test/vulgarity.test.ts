// The vulgarity filter (src/vulgarity.ts), ported from Pattern Break's name.test.ts: obvious
// vulgarities, and innocent handles that contain one (the "Scunthorpe problem"). Every case
// is also run in mixed case, because handles are typed in any case.

import { describe, expect, it } from 'vitest';
import { handleReadings, isVulgar } from '../src/vulgarity.ts';

const BAD = [
  'FUCK',
  'FUUUCK',
  'F U C K',
  'F.U.C.K',
  'FCKFUCK',
  'SH1T',
  'BULLSHIT',
  'ASS',
  'A55',
  'A.S.S',
  'ASS MAN',
  'ASSHOLE',
  'JACKASS',
  'DUMBASS',
  'BITCH',
  'B1TCH',
  'CUNT',
  'PUSSY',
  'DICK',
  'D1CK',
  'DICKHEAD',
  'COCK',
  'TITS',
  'FAG',
  'FAGGOT',
  'N1GGER',
  'NIGGA',
  'WH0RE',
  'SLUT',
  'P0RN',
  'PENIS',
  'CUM',
  'SEX',
  'RAPE',
  'NAZI',
  'HITLER',
  'KKK',
  'PISS',
  'TWAT',
  'KUNT',
  'CNUT',
  'PHUCK',
  'PHUK',
  'FUK',
  'FUQ',
  'SHEIT',
  'SHYT',
  'SHIIT',
  'BIATCH',
  'BIOTCH',
  'AZZ',
  'PR0N',
  'PRON',
  'B00B',
  'B00BS',
  'BOOB',
  'BOOBS',
];

// Capital-letter joins: only as typed, since lower-casing removes the word breaks.
const BAD_CAMEL = [
  'BigAss',
  'MyDick',
  'XXAssXX',
  'BigCock',
  'MyCum',
  'xXAssXx',
  'BigAzz',
  'MrKunt',
  'TheTits',
  'BigBoobs',
  'MyPron',
  'A55Man',
  'FatAss',
  'ISeeSex',
];

const INNOCENT = [
  'CUTLASS',
  'CLASS',
  'BASS',
  'PASSWORD',
  'ASSET',
  'ASSASSIN',
  'MASSES',
  'GLASS',
  'SCUNTHOR',
  'COCKPIT',
  'PEACOCK',
  'HANCOCK',
  'COCKBURN',
  'DICKENS',
  'DICKSON',
  'TITAN',
  'TITLE',
  'PETITE',
  'CUCUMBER',
  'DOCUMENT',
  'GRAPE',
  'DRAPE',
  'ESSEX',
  'SUSSEX',
  'SEXTANT',
  'SWANK',
  'JANUS',
  'URANUS',
  'ANALOG',
  'CANAL',
  'SHIPMENT',
  'PUSH IT',
  'WISH IT',
  'NIGER',
  'NIGEL',
  'NAZIR',
  'SPERMWHL',
  'HOMER',
  'BOOBOO',
  'KC1JMH',
  'BRAD',
  'JORDAN',
  'AMY',
  'ACE',
  'R2D2',
  'XXX',
  'HELLO',
  'DAMN',
  'PRONTO',
  'CANUTE',
  'SCUNTHORPE',
  'CASSIDY',
  'CLASSIC',
  'BASSIST',
  'SHUTTLECOCK',
  'COCKATOO',
  'MACARTHUR',
  'MCDONALD',
  'DESHAWN',
  'LEBRON',
  'JOJO',
  'PACMAN',
  'SPONGEBOB',
  'BIGBOSS',
  'PROGAMER',
  'PHUKET',
  'FUKUDA',
  'JAZZ',
];

// Mixed-case innocents: the capitals here must not make a bad word.
const INNOCENT_CAMEL = [
  'ClassAct',
  'GrassHopper',
  'Peacock',
  'Hancock',
  'MacArthur',
  'McDonald',
  'DeShawn',
  'LeBron',
  'JoJo',
  'PacMan',
  'SpongeBob',
  'BigBoss',
  'ProGamer',
  'Pronto',
  'Canute',
  'Scunthorpe',
  'Cassidy',
  'Classic',
  'Bassist',
  'Shuttlecock',
  'Cockatoo',
  'Dickens',
  'Sussex',
  'Assassin',
  'R2D2',
  'KC1JMH',
  'JazzBand',
  'MrBassman',
];

/** "Fuck" style: first letter up, the rest down. */
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** "fUcK" style: letters alternate, starting low. */
const alternating = (s: string) => [...s].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join('');

const CASES: ReadonlyArray<readonly [label: string, fn: (s: string) => string]> = [
  ['as listed', (s) => s],
  ['lower case', (s) => s.toLowerCase()],
  ['capitalized', capitalized],
  ['alternating case', alternating],
];

describe('isVulgar', () => {
  describe.each(CASES)('%s', (_label, change) => {
    it('finds obvious vulgarities, spaced out or spelled with look-alikes', () => {
      for (const name of BAD) expect(isVulgar(change(name)), change(name)).toBe(true);
    });

    it('passes innocent handles that contain a root', () => {
      for (const name of INNOCENT) expect(isVulgar(change(name)), change(name)).toBe(false);
    });
  });

  it('splits at capital letters and refuses the joins', () => {
    for (const name of BAD_CAMEL) expect(isVulgar(name), name).toBe(true);
  });

  it('passes innocent handles that use capitals', () => {
    for (const name of INNOCENT_CAMEL) expect(isVulgar(name), name).toBe(false);
  });

  it('accepts the known cost: PeaCock fails, Peacock and PEACOCK pass', () => {
    expect(isVulgar('PeaCock')).toBe(true);
    expect(isVulgar('Peacock')).toBe(false);
    expect(isVulgar('PEACOCK')).toBe(false);
  });

  it('splits only where a lowercase letter or digit meets a capital', () => {
    expect(handleReadings('CLASS').camel).toBe('CLASS');
    expect(handleReadings('class').camel).toBe('CLASS');
    expect(handleReadings('BigAss').camel).toBe('BIG ASS');
    expect(handleReadings('A55Man').camel).toBe('ASS MAN');
  });

  it('reads an underscore and the digits with no letter look-alike as marks', () => {
    expect(isVulgar('A_S_S')).toBe(true);
    expect(isVulgar('ass_man')).toBe(true);
    expect(isVulgar('F2U6C_K')).toBe(true);
    expect(isVulgar('class_act')).toBe(false);
  });

  it('checks handles up to 16 characters', () => {
    expect(isVulgar('BigStrongFuckFace')).toBe(true);
    expect(isVulgar('Mr Big Ass Dumbo')).toBe(true);
    expect(isVulgar('Cutlass Classics')).toBe(false);
    expect(isVulgar('Peacock Hancock')).toBe(false);
  });
});

describe('handleReadings', () => {
  it('reads look-alikes as letters and joins runs of single letters, not words', () => {
    expect(handleReadings('A55-MAN')).toEqual({ spaced: 'ASS MAN', joined: 'ASS MAN', camel: 'ASS MAN' });
    expect(handleReadings('A S S')).toEqual({ spaced: 'A S S', joined: 'ASS', camel: 'A S S' });
    expect(handleReadings('PUSH IT')).toEqual({ spaced: 'PUSH IT', joined: 'PUSH IT', camel: 'PUSH IT' });
  });

  it('gives the same readings in any case', () => {
    expect(handleReadings('a55-Man')).toEqual(handleReadings('A55-MAN'));
    expect(handleReadings('a.S.s')).toEqual({ spaced: 'A S S', joined: 'ASS', camel: 'A S S' });
  });
});
