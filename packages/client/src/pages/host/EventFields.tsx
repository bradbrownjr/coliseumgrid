import { EVENT_NAME_MAX } from '@coliseumgrid/core';
import CasinoIcon from '@mui/icons-material/Casino';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useEffect, useRef, useState } from 'react';

/** The server's limits (`cleanEventName` and `cleanGameName` in packages/server/src/events.ts): 1 to 60 characters for a name, up to 60 for a game. */
export const EVENT_NAME_MIN = 1;

/**
 * True when the server will take the text as an event name or a game: 1 to 60 characters once
 * runs of spaces are joined and the ends trimmed, and no control character (`cleanEventName`).
 */
export function eventNameFits(name: string): boolean {
  const tidy = name.replace(/\s+/g, ' ').trim();
  return tidy.length >= EVENT_NAME_MIN && tidy.length <= EVENT_NAME_MAX && !/[\p{Cc}\p{Cf}]/u.test(tidy);
}

/**
 * Which field a refusal from the server belongs to. The server answers `bad-request` for either
 * (`PUT /api/event`), so the client looks at what was typed: the game is the culprit when it has
 * text the server can't take and the name is fine. Anything else is the name's.
 */
export function refusedField(name: string, game: string): 'name' | 'game' {
  return eventNameFits(name) && game.trim() !== '' && !eventNameFits(game) ? 'game' : 'name';
}

/**
 * Keeps a typed field when the server's value changes under it, so a rename from another window
 * doesn't overwrite what the host is typing. The field follows the server while it still shows
 * what the server last had.
 */
export function useSyncedField(saved: string): [string, (value: string) => void] {
  const [value, setValue] = useState(saved);
  const matched = useRef(saved);
  useEffect(() => {
    // Read the old value now: React may run the updater after the ref has moved on.
    const before = matched.current;
    setValue((typed) => (typed === before ? saved : typed));
    matched.current = saved;
  }, [saved]);
  return [value, setValue];
}

interface EventFieldsProps {
  name: string;
  game: string;
  /** The server's refusal, shown under the field it belongs to (`refusedField`). */
  words: string | null;
  onName: (name: string) => void;
  onGame: (game: string) => void;
  /** The wizard's dice: fills in a name made for the template. Left out in the rename box. */
  onDice?: () => void;
}

/**
 * The event name and the game, for the wizard's step 1 and the rename box. The game is optional
 * and shows next to the name on the TV, the Sign-up tablet, and the phone page (docs/PLAN.md,
 * "The setup wizard").
 */
export function EventFields({ name, game, words, onName, onGame, onDice }: EventFieldsProps) {
  const gameRefused = words !== null && refusedField(name, game) === 'game';
  const nameWords = gameRefused ? null : words;
  const gameWords = gameRefused ? words : null;
  return (
    <Stack sx={{ gap: 2, flex: 1, minWidth: 0 }}>
      <TextField
        fullWidth
        label="Event name"
        value={name}
        error={nameWords !== null}
        helperText={nameWords ?? `Shows on the TV. Up to ${EVENT_NAME_MAX} characters.`}
        onChange={(event) => onName(event.target.value)}
        autoComplete="off"
        slotProps={{
          htmlInput: { maxLength: EVENT_NAME_MAX },
          input: onDice && {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton aria-label="Pick a name for me" title="Pick a name for me" edge="end" color="primary" onClick={onDice}>
                  <CasinoIcon />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      <TextField
        fullWidth
        label="What game are you playing?"
        value={game}
        error={gameWords !== null}
        helperText={gameWords ?? 'You can leave this empty.'}
        onChange={(event) => onGame(event.target.value)}
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: EVENT_NAME_MAX } }}
      />
    </Stack>
  );
}
