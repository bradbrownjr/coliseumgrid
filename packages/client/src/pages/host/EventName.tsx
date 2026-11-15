import type { EventInfo } from '@coliseumgrid/core';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { useState, type SubmitEventHandler } from 'react';
import { failureWords } from '../../api/errors.ts';
import { saveEvent } from '../../api/host.ts';
import { EventFields, eventNameFits, useSyncedField } from './EventFields.tsx';

interface EventNameProps {
  /** The event the server has now; null before one is named. Changes when another window renames it. */
  event: EventInfo | null;
  onSaved: (event: EventInfo) => void;
}

/** The play-mode rename box: the name the TV shows and the game under it. */
export function EventName({ event, onSaved }: EventNameProps) {
  const savedName = event?.name ?? '';
  const savedGame = event?.game ?? '';
  const [name, setName] = useSyncedField(savedName);
  const [game, setGame] = useSyncedField(savedGame);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unchanged = name.trim() === savedName && game.trim() === savedGame;

  const submit: SubmitEventHandler<HTMLFormElement> = async (submitted) => {
    submitted.preventDefault();
    if (busy || !eventNameFits(name)) return;
    setBusy(true);
    const result = await saveEvent(name.trim(), game.trim());
    setBusy(false);
    if (!result.ok) return setWords(failureWords(result));
    setWords(null);
    if (result.data.event) {
      setName(result.data.event.name);
      setGame(result.data.event.game ?? '');
      onSaved(result.data.event);
    }
  };

  return (
    <Stack component="form" direction={{ xs: 'column', sm: 'row' }} onSubmit={submit} noValidate sx={{ gap: 2, alignItems: { sm: 'flex-start' } }}>
      <EventFields
        name={name}
        game={game}
        words={words}
        onName={(value) => {
          setName(value);
          setWords(null);
        }}
        onGame={setGame}
      />
      <Button type="submit" variant="contained" size="large" disabled={!eventNameFits(name) || busy || unchanged} sx={{ flexShrink: 0, minHeight: (theme) => theme.spacing(7) }}>
        Save
      </Button>
    </Stack>
  );
}
