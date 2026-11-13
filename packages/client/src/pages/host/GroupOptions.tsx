import { HEAT_RACES_MAX, HEAT_RACES_MIN, HEAT_ROUNDS_MAX, HEAT_ROUNDS_MIN, HEAT_SIZE_MAX, DEFAULT_POINTS, hasQualifying, type RacesPerHeat } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormLabel from '@mui/material/FormLabel';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { placeWords } from './bracketWords.ts';
import { pointsProblem, racesWords, roundsWords } from './groupWords.ts';

const RACES: readonly RacesPerHeat[] = Array.from({ length: HEAT_RACES_MAX - HEAT_RACES_MIN + 1 }, (_, i) => (HEAT_RACES_MIN + i) as RacesPerHeat);
const ROUNDS = Array.from({ length: HEAT_ROUNDS_MAX - HEAT_ROUNDS_MIN + 1 }, (_, i) => HEAT_ROUNDS_MIN + i);

interface GroupOptionsProps {
  races: RacesPerHeat;
  rounds: number;
  /** What the host typed for 1st to 4th. Text, so a half-typed number stays as typed. */
  points: string[];
  playerCount: number;
  onRaces: (races: RacesPerHeat) => void;
  onRounds: (rounds: number) => void;
  onPoints: (points: string[]) => void;
}

/** Races per group, rounds, and the points table, for new groups (docs/PLAN.md, "Races and free-for-all"). */
export function GroupOptions({ races, rounds, points, playerCount, onRaces, onRounds, onPoints }: GroupOptionsProps) {
  const problem = pointsProblem(points);
  const noRounds = !hasQualifying(playerCount);
  return (
    <>
      <Box>
        <FormLabel id="start-races" sx={{ display: 'block', mb: 1 }}>
          Races in each group
        </FormLabel>
        <ToggleButtonGroup
          exclusive
          color="primary"
          aria-labelledby="start-races"
          value={races}
          onChange={(_event, value: RacesPerHeat | null) => value !== null && onRaces(value)}
        >
          {RACES.map((count) => (
            <ToggleButton key={count} value={count} aria-label={`${count} ${count === 1 ? 'race' : 'races'}`} sx={{ px: 3 }}>
              {count}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {racesWords(races)}
        </Typography>
      </Box>

      <Box>
        <FormLabel id="start-rounds" sx={{ display: 'block', mb: 1 }}>
          Rounds before the final
        </FormLabel>
        <ToggleButtonGroup
          exclusive
          color="primary"
          aria-labelledby="start-rounds"
          value={rounds}
          disabled={noRounds}
          onChange={(_event, value: number | null) => value !== null && onRounds(value)}
        >
          {ROUNDS.map((count) => (
            <ToggleButton key={count} value={count} aria-label={`${count} ${count === 1 ? 'round' : 'rounds'}`} sx={{ px: 3 }}>
              {count}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {roundsWords(rounds, playerCount)}
        </Typography>
      </Box>

      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <FormLabel component="legend" sx={{ mb: 1 }}>
          Points for each place
        </FormLabel>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: `repeat(${HEAT_SIZE_MAX}, minmax(0, 1fr))` } }}>
          {points.map((text, i) => (
            <TextField
              key={i}
              label={placeWords(i + 1)}
              value={text}
              error={problem !== null}
              onChange={(event) => onPoints(points.map((old, j) => (j === i ? event.target.value : old)))}
              slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*' } }}
            />
          ))}
        </Box>
        <Typography aria-live="polite" variant="body2" color={problem ? 'error' : 'text.secondary'} sx={{ mt: 1 }}>
          {problem ?? 'A group of 3 uses the first 3 places.'}
        </Typography>
        {points.join(',') !== DEFAULT_POINTS.join(',') && (
          <Button size="small" sx={{ mt: 0.5 }} onClick={() => onPoints(DEFAULT_POINTS.map(String))}>
            Use {DEFAULT_POINTS.join(', ')}
          </Button>
        )}
      </Box>
    </>
  );
}
