import { EVENT_NAME_MAX } from '@coliseumgrid/core';
import CasinoIcon from '@mui/icons-material/Casino';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useEffect, useRef, useState } from 'react';

/** The server's limits (`cleanEventName` and `cleanGameName` in packages/server/src/events.ts): 1 to 60 characters for a name, up to 60 for a game. */
export const EVENT_NAME_MIN = 1;

/** True when the server will take the name: 1 to 60 characters once trimmed. */
export function eventNameFits(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= EVENT_NAME_MIN && trimmed.length <= EVENT_NAME_MAX;
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
  /** The server's refusal, shown under the name. */
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
  return (
    <Stack sx={{ gap: 2, flex: 1, minWidth: 0 }}>
      <TextField
        fullWidth
        label="Event name"
        value={name}
        error={words !== null}
        helperText={words ?? `Shows on the TV. Up to ${EVENT_NAME_MAX} characters.`}
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
        helperText="You can leave this empty."
        onChange={(event) => onGame(event.target.value)}
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: EVENT_NAME_MAX } }}
      />
    </Stack>
  );
}
