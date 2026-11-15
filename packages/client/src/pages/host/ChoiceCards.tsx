import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import type { Choice } from './wizardWords.ts';

interface ChoiceCardsProps<T extends string> {
  legend: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
}

/**
 * A radio group drawn as cards, each with a bold name and a line: the wizard's template cards
 * and format cards (docs/DESIGN.md, "Setup wizard"). The picked card gets a crimson border, or
 * `primary.light` in dark mode, as well as the filled radio.
 */
export function ChoiceCards<T extends string>({ legend, value, choices, onChange }: ChoiceCardsProps<T>) {
  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
      <FormLabel component="legend" sx={{ mb: 1 }}>
        {legend}
      </FormLabel>
      <RadioGroup value={value} onChange={(event) => onChange(event.target.value as T)} sx={{ gap: 1 }}>
        {choices.map((choice) => (
          <Paper
            key={choice.value}
            variant="outlined"
            sx={(theme) => ({
              px: 1,
              borderColor: value === choice.value ? theme.vars.palette.primary.main : undefined,
              borderWidth: theme.spacing(0.25),
              ...theme.applyStyles('dark', value === choice.value ? { borderColor: theme.vars.palette.primary.light } : {}),
            })}
          >
            <FormControlLabel
              value={choice.value}
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
  );
}
