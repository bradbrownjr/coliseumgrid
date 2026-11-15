import type { EventInfo } from '@coliseumgrid/core';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeGraphic, uploadGraphic, graphicUrl, queueTag, markTagsPrinted } from '../src/api/tags.ts';
import { EventPicture } from '../src/components/EventPicture.tsx';
import { NameTagsPanel } from '../src/pages/host/NameTagsPanel.tsx';
import { PlayerActions } from '../src/pages/host/PlayerActions.tsx';
import { TagFace } from '../src/pages/host/PrintSheet.tsx';
import { NAME_TAGS_TITLE, printButtonWords, printedHelp, printedQuestion, REPRINT_ADDED } from '../src/pages/host/nameTagWords.ts';
import { theme } from '../src/theme/theme.ts';

const render = (element: ReactElement) => renderToString(<ThemeProvider theme={theme}>{element}</ThemeProvider>);
const none = () => undefined;
const graphic = { width: 400, height: 300, version: 'abc123' };
const face = { page: { widthMm: 62, heightMm: 100 }, eventName: 'Spring Showdown', game: 'Fighting game', graphic: null };

describe('the words', () => {
  it('counts the tags', () => {
    expect(printButtonWords(5)).toBe('Print 5 new tags');
    expect(printButtonWords(1)).toBe('Print 1 new tag');
    expect(printButtonWords(0)).toBe('Print 0 new tags');
    expect(printedQuestion(5)).toBe('Did all 5 tags print?');
    expect(printedQuestion(1)).toBe('Did the tag print?');
    expect(printedHelp(3)).toContain('Pick No to keep them.');
    expect(NAME_TAGS_TITLE).toBe('Name tags');
    expect(REPRINT_ADDED).toBe('Added to the print list. Reprints have no PIN.');
  });
});

describe('a tag page', () => {
  it('has the handle, the event, the game, and the PIN', () => {
    const html = render(<TagFace tag={{ handle: 'Zap', pin: '4821' }} {...face} />);
    expect(html).toContain('>Zap<');
    expect(html).toContain('Spring Showdown');
    expect(html).toContain('Fighting game');
    expect(html).toContain('PIN 4821');
  });

  it('leaves the PIN corner empty for a reprint', () => {
    const html = render(<TagFace tag={{ handle: 'Zap', pin: null }} {...face} />);
    expect(html).not.toContain('PIN');
  });

  it('is one page the size of the label, and the handle starts at the biggest size', () => {
    const html = render(<TagFace tag={{ handle: 'Zap', pin: null }} {...face} />);
    expect(html).toMatch(/width:62mm|width: ?62mm/);
    expect(html).toContain('data-max-pt="72"');
  });

  it('shows the event graphic from its versioned address, in its own proportions', () => {
    const html = render(<TagFace tag={{ handle: 'Zap', pin: null }} {...face} graphic={graphic} />);
    expect(html).toContain('src="/api/event/graphic?v=abc123"');
    expect(html).toContain('<img');
  });

  it('has no picture when the event has none', () => {
    expect(render(<TagFace tag={{ handle: 'Zap', pin: null }} {...face} />)).not.toContain('<img');
  });

  it('draws the outline only on the test tag', () => {
    const plain = render(<TagFace tag={{ handle: 'SampleName', pin: '0000' }} {...face} />);
    const test = render(<TagFace tag={{ handle: 'SampleName', pin: '0000' }} {...face} outline />);
    expect(test.length).toBeGreaterThan(plain.length);
    expect(test).toContain('PIN 0000');
  });

  it('is black on white with no hex colors', () => {
    // The theme's own variables (:root) are in the page and are not the tag's styles.
    const html = render(<TagFace tag={{ handle: 'Zap', pin: '1' }} {...face} outline />).replace(/<style data-emotion="css-global[^>]*>.*?<\/style>/gs, '');
    expect(html).toContain('black');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('the Name tags panel', () => {
  const event = (g: EventInfo['graphic']): EventInfo => ({ name: 'Spring Showdown', game: null, graphic: g });
  const panel = (g: EventInfo['graphic']) => render(<NameTagsPanel event={event(g)} tagsVersion={0} onEventChanged={none} />);

  it('has the label size, both print buttons, and the picture controls', () => {
    const html = panel(null);
    expect(html).toContain('Label size');
    expect(html).toContain('62 x 100 mm (Brother DK-11202)');
    expect(html).toContain('Print 0 new tags');
    expect(html).toContain('Print a test tag');
    expect(html).toContain('Choose a picture');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(html).toContain('No picture yet.');
    expect(html).not.toContain('Remove');
  });

  it('turns Print 0 new tags off until the list loads and has tags', () => {
    const html = panel(null);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Print 0 new tags/s);
  });

  it('shows the picture and Remove when the event has one', () => {
    const html = panel(graphic);
    expect(html).toContain('alt="The event picture"');
    expect(html).toContain(graphicUrl(graphic));
    expect(html).toContain('Remove');
    expect(html).not.toContain('No picture yet.');
  });
});

describe('Print tag on a player row', () => {
  it('is an icon button with the label as its name', () => {
    const html = render(<PlayerActions player={{ id: 1, handle: 'Zap' }} canMerge onRename={none} onResetPin={none} onMerge={none} onPrintTag={none} />);
    expect(html).toContain('aria-label="Print tag"');
  });
});

describe('the event picture', () => {
  it('is decoration beside the name unless it is given a description', () => {
    expect(render(<EventPicture graphic={graphic} />)).toContain('alt=""');
    expect(render(<EventPicture graphic={graphic} alt="The event picture" />)).toContain('alt="The event picture"');
  });
});

describe('the name tag calls', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const answer = (status: number, body?: unknown) =>
    fetchMock.mockResolvedValueOnce(body === undefined ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads the file as the raw body with its own type', async () => {
    answer(200, { event: { name: 'A', game: null, graphic } });
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    const result = await uploadGraphic(file);
    expect(result.ok).toBe(true);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/event/graphic');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ 'content-type': 'image/png' });
    expect(init?.body).toBe(file);
  });

  it('reads a refused upload as the server\'s code', async () => {
    answer(400, { error: 'bad-size' });
    const result = await uploadGraphic(new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    expect(result).toEqual({ ok: false, error: 'bad-size' });
  });

  it('removes the picture, queues a reprint, and reports the printed tags', async () => {
    answer(200, { event: { name: 'A', game: null, graphic: null } });
    await removeGraphic();
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('DELETE');
    answer(201, { tag: { playerId: 4, handle: 'Zap', pin: null } });
    await queueTag(4);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe('{"playerId":4}');
    answer(204);
    const printed = await markTagsPrinted([4, 5]);
    expect(printed.ok).toBe(true);
    const [path, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(path).toBe('/api/tags/printed');
    expect(init?.body).toBe('{"playerIds":[4,5]}');
  });
});
