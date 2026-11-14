import type { FollowedPlayer } from '@coliseumgrid/core';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PhoneStandings } from '../src/pages/phone/PhoneStandings.tsx';
import { PlayerCard } from '../src/pages/phone/PlayerCard.tsx';
import { PushSlot } from '../src/pages/phone/PushSlot.tsx';
import { theme } from '../src/theme/theme.ts';

const render = (element: ReactElement) => renderToString(<ThemeProvider theme={theme}>{element}</ThemeProvider>);

const zap = { id: 3, handle: 'Zap' };
const followed = (extra: Partial<FollowedPlayer>): FollowedPlayer => ({
  player: zap,
  status: 'later',
  away: 3,
  station: null,
  matchId: 1,
  others: [{ id: 2, handle: 'Kai' }],
  place: null,
  ...extra,
});

describe('the player card', () => {
  it('shows the handle, the status in words, the opponent, and a way to stop', () => {
    const html = render(<PlayerCard followed={followed({ status: 'next', away: 1 })} standings={null} onStop={() => undefined} />);
    expect(html).toContain('Zap');
    expect(html).toContain('You&#x27;re next');
    expect(html).toContain('Against Kai');
    expect(html).toContain('Stop following');
  });
});

describe('the standings', () => {
  const heats = {
    kind: 'heats' as const,
    finished: false,
    finalSize: 2,
    rows: [1, 2, 3].map((id) => ({ place: id, points: 9 - id, heatsPlayed: 1, player: { id, handle: `P${id}` } })),
  };

  it('draws the cut line and marks followed players', () => {
    const html = render(<PhoneStandings standings={heats} followedIds={new Set([2])} />);
    expect(html).toContain('Top 2 go to the final');
    expect(html).toContain('You follow this player');
    expect(html.match(/You follow this player/g)).toHaveLength(1);
  });
});

describe('the push slot', () => {
  it('shows nothing without a key', () => {
    expect(render(<PushSlot publicKey={null}>{(key) => <p>{`subscribe ${key}`}</p>}</PushSlot>)).not.toContain('subscribe');
  });

  it('gives the control the key when there is one', () => {
    expect(render(<PushSlot publicKey="BKEY">{(key) => <p>{`subscribe ${key}`}</p>}</PushSlot>)).toContain('subscribe BKEY');
  });
});
