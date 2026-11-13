import type { BestOf, BracketFormat } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { FORMAT_CHOICES, bestOfWords } from './bracketWords.ts';

const BEST_OF: readonly BestOf[] = [1, 3, 5];

interface BracketOptionsProps {
  format: BracketFormat;
  bestOf: BestOf;
  onFormat: (format: BracketFormat) => void;
  onBestOf: (bestOf: BestOf) => void;
}

/** The format cards and best of, for a new bracket (docs/PLAN.md, "1 vs 1 bracket"). */
export function BracketOptions({ format, bestOf, onFormat, onBestOf }: BracketOptionsProps) {
  return (
    <>
      <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <FormLabel component="legend" sx={{ mb: 1 }}>
          Format
        </FormLabel>
        <RadioGroup value={format} onChange={(event) => onFormat(event.target.value as BracketFormat)} sx={{ gap: 1 }}>
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
          onChange={(_event, value: BestOf | null) => value !== null && onBestOf(value)}
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
    </>
  );
}
