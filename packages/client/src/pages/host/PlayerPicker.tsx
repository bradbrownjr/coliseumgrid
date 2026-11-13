import type { Player } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { getEventPlayers } from '../../api/bracket.ts';
import { failureWords } from '../../api/errors.ts';
import { byHandle, playerCountWords } from './bracketWords.ts';

export interface PlayerPick {
  picked: ReadonlySet<number>;
  /** The picked players that still exist. A pick can name a player who was merged away while the dialog was open. */
  chosen: Player[];
  inEvent: Player[];
  others: Player[];
  loading: boolean;
  loadWords: string | null;
  reload: () => Promise<void>;
  toggle: (id: number) => void;
  pickAll: () => void;
  clear: () => void;
}

/** The start dialog's player pick: this event's players start checked, everyone else unchecked. */
export function usePlayerPick(players: Player[], onChange: () => void): PlayerPick {
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [eventIds, setEventIds] = useState<ReadonlySet<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadWords, setLoadWords] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await getEventPlayers();
    setLoading(false);
    if (result.ok) {
      const ids = new Set(result.data.playerIds);
      setEventIds(ids);
      setPicked(ids);
      setLoadWords(null);
    } else {
      setLoadWords(failureWords(result));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    picked,
    chosen: players.filter((player) => picked.has(player.id)),
    inEvent: players.filter((player) => eventIds.has(player.id)).sort(byHandle),
    others: players.filter((player) => !eventIds.has(player.id)).sort(byHandle),
    loading,
    loadWords,
    reload,
    toggle: (id) => {
      onChange();
      setPicked((before) => {
        const after = new Set(before);
        if (!after.delete(id)) after.add(id);
        return after;
      });
    },
    pickAll: () => setPicked(new Set(players.map((player) => player.id))),
    clear: () => setPicked(new Set()),
  };
}

interface PlayerPickerProps {
  players: Player[];
  pick: PlayerPick;
  /** Why the pick can't start, or null. Shown in place of the count. */
  problem: string | null;
  /** A line under the count, such as the group sizes. */
  note?: string | null;
}

/** The checklist, "Pick all" and "Clear", and the count. Same for a bracket and for groups. */
export function PlayerPicker({ players, pick, problem, note = null }: PlayerPickerProps) {
  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <FormLabel id="start-players">Players</FormLabel>
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button size="small" disabled={pick.loading} onClick={pick.pickAll}>
            Pick all
          </Button>
          <Button size="small" disabled={pick.loading} onClick={pick.clear}>
            Clear
          </Button>
        </Stack>
      </Stack>
      {pick.loadWords && (
        <Alert
          severity="error"
          sx={{ mb: 1 }}
          action={
            <Button color="inherit" onClick={() => void pick.reload()}>
              Try again
            </Button>
          }
        >
          {pick.loadWords}
        </Alert>
      )}
      {pick.loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress aria-label="Loading players" />
        </Box>
      ) : players.length === 0 ? (
        <Typography>No players yet. Add players first.</Typography>
      ) : (
        <>
          <Checklist label="Signed up to this event" players={pick.inEvent} picked={pick.picked} onToggle={pick.toggle} />
          <Checklist label="Not signed up to this event" players={pick.others} picked={pick.picked} onToggle={pick.toggle} />
        </>
      )}
      <Typography aria-live="polite" color={problem ? 'error' : 'text.secondary'} sx={{ mt: 1 }}>
        {problem ?? `${playerCountWords(pick.chosen.length)} picked.`}
      </Typography>
      {note && !problem && (
        <Typography variant="body2" color="text.secondary">
          {note}
        </Typography>
      )}
    </Box>
  );
}

interface ChecklistProps {
  label: string;
  players: Player[];
  picked: ReadonlySet<number>;
  onToggle: (id: number) => void;
}

/** One group of players with a checkbox each. Nothing is drawn for an empty group. */
function Checklist({ label, players, picked, onToggle }: ChecklistProps) {
  if (players.length === 0) return null;
  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, mb: 1, minWidth: 0 }}>
      <Typography component="legend" variant="body2" color="text.secondary" sx={{ p: 0 }}>
        {label}
      </Typography>
      <FormGroup>
        {players.map((player) => (
          <FormControlLabel
            key={player.id}
            sx={{ m: 0, '.MuiFormControlLabel-label': { overflowWrap: 'anywhere', minWidth: 0 } }}
            control={<Checkbox checked={picked.has(player.id)} onChange={() => onToggle(player.id)} />}
            label={player.handle}
          />
        ))}
      </FormGroup>
    </Box>
  );
}
