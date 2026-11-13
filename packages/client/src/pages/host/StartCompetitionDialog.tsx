import { DEFAULT_POINTS, HEAT_ROUNDS_DEFAULT, STATIONS_MAX, STATIONS_MIN, type BestOf, type Bracket, type BracketFormat, type Heats, type Player, type RacesPerHeat } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useState, type SubmitEventHandler } from 'react';
import { startBracket } from '../../api/bracket.ts';
import { failureWords } from '../../api/errors.ts';
import { startHeats } from '../../api/heats.ts';
import { BracketOptions } from './BracketOptions.tsx';
import { startProblem } from './bracketWords.ts';
import { GroupOptions } from './GroupOptions.tsx';
import { groupSizesWords, groupsProblem, parsePoints, pointsProblem } from './groupWords.ts';
import { PlayerPicker, usePlayerPick } from './PlayerPicker.tsx';

const STATION_CHOICES = Array.from({ length: STATIONS_MAX - STATIONS_MIN + 1 }, (_, i) => STATIONS_MIN + i);

type Kind = 'bracket' | 'groups';

const KIND_WORDS: Record<Kind, string> = {
  bracket: 'Players face off one on one. Winners move on.',
  groups: 'Groups of up to 4 score points by place. The top 4 play a final.',
};

interface StartCompetitionDialogProps {
  players: Player[];
  onStartedBracket: (bracket: Bracket) => void;
  onStartedGroups: (heats: Heats) => void;
  onClose: () => void;
}

/**
 * Picks what to run, its settings, the stations, and the players. Only one competition runs per
 * event (docs/PLAN.md, "Heats API"), so one dialog starts either. The limits are checked here in
 * plain words, and the server checks again.
 */
export function StartCompetitionDialog({ players, onStartedBracket, onStartedGroups, onClose }: StartCompetitionDialogProps) {
  const [kind, setKind] = useState<Kind>('bracket');
  const [format, setFormat] = useState<BracketFormat>('single');
  const [bestOf, setBestOf] = useState<BestOf>(1);
  const [races, setRaces] = useState<RacesPerHeat>(1);
  const [rounds, setRounds] = useState(HEAT_ROUNDS_DEFAULT);
  const [points, setPoints] = useState<string[]>(DEFAULT_POINTS.map(String));
  const [stations, setStations] = useState(1);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = usePlayerPick(players, () => setWords(null));

  const count = pick.chosen.length;
  const problem = kind === 'bracket' ? startProblem(format, count) : groupsProblem(count) ?? pointsProblem(points);
  // The points problem shows by the points fields; the count line only shows the player ones.
  const countProblem = kind === 'bracket' ? problem : groupsProblem(count);

  const submit: SubmitEventHandler = async (event) => {
    event.preventDefault();
    if (busy || problem !== null) return;
    setBusy(true);
    const playerIds = pick.chosen.map((player) => player.id);
    if (kind === 'bracket') {
      const result = await startBracket({ format, bestOf, stations, playerIds });
      setBusy(false);
      if (result.ok) return onStartedBracket(result.data.bracket);
      return setWords(failureWords(result));
    }
    const result = await startHeats({ stations, races, rounds, points: parsePoints(points) ?? [], playerIds });
    setBusy(false);
    if (result.ok) return onStartedGroups(result.data.heats);
    setWords(failureWords(result));
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth scroll="paper" slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
      <DialogTitle>Start a competition</DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <FormLabel id="start-kind" sx={{ display: 'block', mb: 1 }}>
            What are you running?
          </FormLabel>
          <ToggleButtonGroup
            exclusive
            fullWidth
            color="primary"
            aria-labelledby="start-kind"
            value={kind}
            onChange={(_event, value: Kind | null) => {
              if (value === null) return;
              setKind(value);
              setWords(null);
            }}
          >
            <ToggleButton value="bracket">Bracket</ToggleButton>
            <ToggleButton value="groups">Races and free-for-all</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {KIND_WORDS[kind]}
          </Typography>
        </Box>

        {kind === 'bracket' ? (
          <BracketOptions
            format={format}
            bestOf={bestOf}
            onFormat={(next) => {
              setFormat(next);
              setWords(null);
            }}
            onBestOf={setBestOf}
          />
        ) : (
          <GroupOptions races={races} rounds={rounds} points={points} playerCount={count} onRaces={setRaces} onRounds={setRounds} onPoints={setPoints} />
        )}

        <TextField
          select
          label="Stations"
          value={stations}
          onChange={(event) => setStations(Number(event.target.value))}
          helperText="One station is one console. You can't change this later."
          fullWidth
        >
          {STATION_CHOICES.map((choice) => (
            <MenuItem key={choice} value={choice}>
              {choice}
            </MenuItem>
          ))}
        </TextField>

        <PlayerPicker players={players} pick={pick} problem={countProblem} note={kind === 'groups' ? groupSizesWords(count) : null} />

        {words && <Alert severity="error">{words}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || pick.loading || problem !== null}>
          Start
        </Button>
      </DialogActions>
    </Dialog>
  );
}
