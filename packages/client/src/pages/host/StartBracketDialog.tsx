import { STATIONS_MAX, STATIONS_MIN, type BestOf, type Bracket, type BracketFormat, type Player } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState, type SubmitEventHandler } from 'react';
import { getEventPlayers, startBracket } from '../../api/bracket.ts';
import { failureWords } from '../../api/errors.ts';
import { FORMAT_CHOICES, bestOfWords, byHandle, playerCountWords, startProblem } from './bracketWords.ts';

const BEST_OF: readonly BestOf[] = [1, 3, 5];
const STATION_CHOICES = Array.from({ length: STATIONS_MAX - STATIONS_MIN + 1 }, (_, i) => STATIONS_MIN + i);

interface StartBracketDialogProps {
  players: Player[];
  onStarted: (bracket: Bracket) => void;
  onClose: () => void;
}

/**
 * Picks the format, best of, stations, and players for a new bracket. This event's players start
 * checked; everyone else is listed unchecked. The limits are checked here in plain words, and the
 * server checks again (docs/PLAN.md, "Brackets API").
 */
export function StartBracketDialog({ players, onStarted, onClose }: StartBracketDialogProps) {
  const [format, setFormat] = useState<BracketFormat>('single');
  const [bestOf, setBestOf] = useState<BestOf>(1);
  const [stations, setStations] = useState(1);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [eventIds, setEventIds] = useState<ReadonlySet<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadWords, setLoadWords] = useState<string | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadEventPlayers = useCallback(async () => {
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
    void loadEventPlayers();
  }, [loadEventPlayers]);

  // A pick can name a player who was merged away while the dialog was open.
  const chosen = players.filter((player) => picked.has(player.id));
  const problem = startProblem(format, chosen.length);
  const inEvent = players.filter((player) => eventIds.has(player.id)).sort(byHandle);
  const others = players.filter((player) => !eventIds.has(player.id)).sort(byHandle);

  const toggle = (id: number) => {
    setWords(null);
    setPicked((before) => {
      const after = new Set(before);
      if (!after.delete(id)) after.add(id);
      return after;
    });
  };

  const submit: SubmitEventHandler = async (event) => {
    event.preventDefault();
    if (busy || problem !== null) return;
    setBusy(true);
    const result = await startBracket({ format, bestOf, stations, playerIds: chosen.map((player) => player.id) });
    setBusy(false);
    if (result.ok) return onStarted(result.data.bracket);
    setWords(failureWords(result));
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth scroll="paper" slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
      <DialogTitle>Start a bracket</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          <FormLabel component="legend" sx={{ mb: 1 }}>
            Format
          </FormLabel>
          <RadioGroup
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as BracketFormat);
              setWords(null);
            }}
            sx={{ gap: 1 }}
          >
            {FORMAT_CHOICES.map((choice) => (
              <Paper
                key={choice.format}
                variant="outlined"
                sx={(theme) => ({
                  px: 1,
                  borderColor: format === choice.format ? theme.vars.palette.primary.main : undefined,
                  borderWidth: theme.spacing(0.25),
                  ...theme.applyStyles('dark', format === choice.format ? { borderColor: theme.vars.palette.primary.light } : {}),
                })}
              >
                <FormControlLabel
                  value={choice.format}
                  control={<Radio />}
                  sx={{ display: 'flex', alignItems: 'flex-start', m: 0, py: 0.5 }}
                  label={
                    <Box sx={{ pt: 1.25 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        {choice.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {choice.line}
                      </Typography>
                    </Box>
                  }
                />
              </Paper>
            ))}
          </RadioGroup>
        </Box>

        <Box>
          <FormLabel id="start-best-of" sx={{ display: 'block', mb: 1 }}>
            Best of
          </FormLabel>
          <ToggleButtonGroup
            exclusive
            color="primary"
            aria-labelledby="start-best-of"
            value={bestOf}
            onChange={(_event, value: BestOf | null) => value !== null && setBestOf(value)}
          >
            {BEST_OF.map((count) => (
              <ToggleButton key={count} value={count} aria-label={`Best of ${count}`} sx={{ px: 3 }}>
                {count}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {bestOfWords(bestOf)}
          </Typography>
        </Box>

        <TextField
          select
          label="Stations"
          value={stations}
          onChange={(event) => setStations(Number(event.target.value))}
          helperText="One station is one console. You can't change this later."
          fullWidth
        >
          {STATION_CHOICES.map((count) => (
            <MenuItem key={count} value={count}>
              {count}
            </MenuItem>
          ))}
        </TextField>

        <Box>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 1 }}>
            <FormLabel id="start-players">Players</FormLabel>
            <Stack direction="row" sx={{ gap: 1 }}>
              <Button size="small" disabled={loading} onClick={() => setPicked(new Set(players.map((player) => player.id)))}>
                Pick all
              </Button>
              <Button size="small" disabled={loading} onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </Stack>
          </Stack>
          {loadWords && (
            <Alert
              severity="error"
              sx={{ mb: 1 }}
              action={
                <Button color="inherit" onClick={() => void loadEventPlayers()}>
                  Try again
                </Button>
              }
            >
              {loadWords}
            </Alert>
          )}
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress aria-label="Loading players" />
            </Box>
          ) : players.length === 0 ? (
            <Typography>No players yet. Add players first.</Typography>
          ) : (
            <>
              <Checklist label="Signed up to this event" players={inEvent} picked={picked} onToggle={toggle} />
              <Checklist label="Not signed up to this event" players={others} picked={picked} onToggle={toggle} />
            </>
          )}
          <Typography aria-live="polite" color={problem ? 'error' : 'text.secondary'} sx={{ mt: 1 }}>
            {problem ?? `${playerCountWords(chosen.length)} picked.`}
          </Typography>
        </Box>

        {words && <Alert severity="error">{words}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || loading || problem !== null}>
          Start
        </Button>
      </DialogActions>
    </Dialog>
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
