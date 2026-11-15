import { PLAN_BEST_OF, type BestOf, type BracketFormat } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import FormLabel from '@mui/material/FormLabel';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { FORMAT_CHOICES, bestOfWords } from './bracketWords.ts';

/** One life and Two lives: the 1 vs 1 bracket card's choice. */
export type Lives = Exclude<BracketFormat, 'round_robin'>;
const LIVES = FORMAT_CHOICES.filter((choice): choice is (typeof FORMAT_CHOICES)[number] & { format: Lives } => choice.format !== 'round_robin');

interface BracketOptionsProps {
  /** Null for Everyone plays everyone, which has no lives. */
  lives: Lives | null;
  bestOf: BestOf;
  onLives: (lives: Lives) => void;
  onBestOf: (bestOf: BestOf) => void;
}

/**
 * Lives and best of, under "More options" for a bracket (docs/PLAN.md, "1 vs 1 bracket"). The
 * format itself is a card in the wizard's step 2.
 */
export function BracketOptions({ lives, bestOf, onLives, onBestOf }: BracketOptionsProps) {
  return (
    <>
      {lives !== null && (
        <Box>
          <FormLabel id="plan-lives" sx={{ display: 'block', mb: 1 }}>
            Lives
          </FormLabel>
          <ToggleButtonGroup
            exclusive
            color="primary"
            aria-labelledby="plan-lives"
            value={lives}
            onChange={(_event, value: Lives | null) => value !== null && onLives(value)}
          >
            {LIVES.map((choice) => (
              <ToggleButton key={choice.format} value={choice.format} sx={{ px: 2 }}>
                {choice.name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {LIVES.find((choice) => choice.format === lives)?.line}
          </Typography>
        </Box>
      )}

      <Box>
        <FormLabel id="plan-best-of" sx={{ display: 'block', mb: 1 }}>
          Best of
        </FormLabel>
        <ToggleButtonGroup
          exclusive
          color="primary"
          aria-labelledby="plan-best-of"
          value={bestOf}
          onChange={(_event, value: BestOf | null) => value !== null && onBestOf(value)}
        >
          {PLAN_BEST_OF.map((count) => (
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
