import { estimatePlan, isTooLong, suggestFixes, type EventPlan } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { startProblem } from './bracketWords.ts';
import { groupsProblem } from './groupWords.ts';
import {
  ESTIMATE_PLAYERS_MAX,
  ESTIMATE_PLAYERS_MIN,
  FIX_WORDS,
  aboutWords,
  estimateTail,
  finishWords,
  tooLongWords,
} from './wizardWords.ts';

const PLAYER_CHOICES = Array.from({ length: ESTIMATE_PLAYERS_MAX - ESTIMATE_PLAYERS_MIN + 1 }, (_, i) => ESTIMATE_PLAYERS_MIN + i);

/** Why the format can't start with this many players, in the words the start checks use. */
function countProblem(plan: EventPlan, players: number): string | null {
  return plan.format === 'heats' ? groupsProblem(players) : startProblem(plan.format, players);
}

interface EstimatePanelProps {
  plan: EventPlan;
  players: number;
  /** Step 2: the players count is a picker, only for the estimate. Step 3 counts the players picked. */
  onPlayers?: (players: number) => void;
  /** Step 3 adds the finish time from the laptop's clock. */
  now?: number;
  onFix: (plan: EventPlan) => void;
}

/**
 * The time estimate and the too-long warning (docs/PLAN.md, "Time estimate"). The warning has
 * an icon and words, never color alone, and up to two fixes that apply at once. It never
 * blocks Next or Start.
 */
export function EstimatePanel({ plan, players, onPlayers, now, onFix }: EstimatePanelProps) {
  const estimate = estimatePlan(plan, players);
  const problem = estimate ? null : countProblem(plan, players);
  const tooLong = estimate !== null && isTooLong(estimate, plan.hours);
  const fixes = tooLong ? suggestFixes(plan, players) : [];

  return (
    <Stack sx={{ gap: 2 }}>
      {onPlayers ? (
        <Stack direction="row" sx={{ alignItems: 'center', columnGap: 1, rowGap: 1, flexWrap: 'wrap' }}>
          <Typography component="span">With</Typography>
          <TextField
            select
            value={players}
            onChange={(event) => onPlayers(Number(event.target.value))}
            slotProps={{ htmlInput: { 'aria-label': 'Players for the estimate' } }}
            sx={{ minWidth: (theme) => theme.spacing(11) }}
          >
            {PLAYER_CHOICES.map((choice) => (
              <MenuItem key={choice} value={choice}>
                {choice}
              </MenuItem>
            ))}
          </TextField>
          <Typography component="span" aria-live="polite" color={problem ? 'error' : undefined}>
            {estimate ? estimateTail(players, estimate) : `players. ${problem ?? ''}`}
          </Typography>
        </Stack>
      ) : estimate ? (
        <Box aria-live="polite">
          <Typography variant="h5" component="p">
            {aboutWords(estimate)}
          </Typography>
          {now !== undefined && <Typography color="text.secondary">{finishWords(estimate, now)}</Typography>}
        </Box>
      ) : null}

      {tooLong && (
        <Alert severity="warning" sx={{ '.MuiAlert-message': { flex: 1, minWidth: 0 } }}>
          <Stack sx={{ gap: 1.5, alignItems: 'flex-start' }}>
            <Typography>{tooLongWords(plan.hours)}</Typography>
            {fixes.length > 0 && (
              <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                {fixes.map((fix) => (
                  <Button key={fix.id} color="inherit" variant="outlined" onClick={() => onFix(fix.plan)}>
                    {FIX_WORDS[fix.id]}
                  </Button>
                ))}
              </Stack>
            )}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
