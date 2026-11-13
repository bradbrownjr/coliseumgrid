import type { EventInfo } from '@coliseumgrid/core';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useEffect, useRef, useState, type SubmitEventHandler } from 'react';
import { failureWords } from '../../api/errors.ts';
import { setEventName } from '../../api/host.ts';

/** The server's limits (docs/PLAN.md, "Host sign-in"): 1 to 60 characters. */
export const EVENT_NAME_MIN = 1;
export const EVENT_NAME_MAX = 60;

interface EventNameProps {
  /** The event the server has now; null before one is named. Changes when another window renames it. */
  event: EventInfo | null;
  onSaved: (event: EventInfo) => void;
}

/** The name the TV shows. */
export function EventName({ event, onSaved }: EventNameProps) {
  const saved = event?.name ?? '';
  const [value, setValue] = useState(saved);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What the field last matched, so a name that arrives while the host is typing doesn't overwrite it.
  const matched = useRef(saved);

  useEffect(() => {
    setValue((typed) => (typed === matched.current ? saved : typed));
    matched.current = saved;
  }, [saved]);

  const trimmed = value.trim();
  const valid = trimmed.length >= EVENT_NAME_MIN && trimmed.length <= EVENT_NAME_MAX;

  const submit: SubmitEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    const result = await setEventName(trimmed);
    setBusy(false);
    if (!result.ok) return setWords(failureWords(result));
    setWords(null);
    if (result.data.event) {
      setValue(result.data.event.name);
      onSaved(result.data.event);
    }
  };

  return (
    <Stack component="form" direction={{ xs: 'column', sm: 'row' }} onSubmit={submit} noValidate sx={{ gap: 2, alignItems: { sm: 'flex-start' } }}>
      <TextField
        fullWidth
        label="Event name"
        value={value}
        error={words !== null}
        helperText={words ?? `Shows on the TV. Up to ${EVENT_NAME_MAX} characters.`}
        onChange={(event) => {
          setValue(event.target.value);
          setWords(null);
        }}
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: EVENT_NAME_MAX } }}
      />
      <Button type="submit" variant="contained" size="large" disabled={!valid || busy || trimmed === saved} sx={{ flexShrink: 0, minHeight: (theme) => theme.spacing(7) }}>
        Save name
      </Button>
    </Stack>
  );
}
