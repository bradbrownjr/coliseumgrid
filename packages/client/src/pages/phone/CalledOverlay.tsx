import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import { keyframes, type Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { FLASH_SECONDS, type CalledAlert } from './alerts.ts';
import { calledWords } from './phoneWords.ts';

/**
 * Crimson to black and back, once a second. WCAG 2.2 success criterion 2.3.1 allows no more
 * than three flashes in any one second (the page flashes once), and the pulse is eased, not a
 * hard cut (https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).
 * Under `prefers-reduced-motion` the background stays steady.
 */
const flash = (theme: Theme) => keyframes`
  0%, 100% { background-color: ${theme.vars.palette.primary.main}; }
  50% { background-color: ${theme.vars.palette.common.black}; }
`;

interface CalledOverlayProps {
  calls: readonly CalledAlert[];
  /** "On my way": the player has seen it. */
  onDismiss: () => void;
}

/**
 * The full-screen alert when a followed player is called to a station (docs/PLAN.md, "Player
 * view"), over everything on the page. One big line for each player called.
 */
export function CalledOverlay({ calls, onDismiss }: CalledOverlayProps) {
  return (
    <Dialog
      fullScreen
      open={calls.length > 0}
      onClose={onDismiss}
      aria-labelledby="called-heading"
      slotProps={{
        paper: {
          sx: (theme) => ({
            // The theme gives every dialog a margin and a narrower width on a phone, and its rule
            // beats this one; the doubled selector wins, so a full-screen alert has neither.
            '&&': { m: 0, width: '100%' },
            bgcolor: 'primary.main',
            color: 'common.white',
            animation: `${flash(theme)} ${FLASH_SECONDS}s ease-in-out infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }),
        },
      }}
    >
      <Box
        sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, p: 3, textAlign: 'center', minHeight: 0, overflowY: 'auto' }}
      >
        <Typography id="called-heading" component="h2" variant="h4" sx={{ fontWeight: 700 }}>
          You&apos;re up!
        </Typography>
        {calls.map((call) => (
          <Box key={call.playerId} sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <Typography component="p" variant="h2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
              {calledWords(call.handle, call.station)}
            </Typography>
            {call.others.length > 0 && (
              <Typography component="p" variant="h5" sx={{ overflowWrap: 'anywhere' }}>
                With {call.others.join(', ')}
              </Typography>
            )}
          </Box>
        ))}
        <Button
          size="large"
          variant="contained"
          onClick={onDismiss}
          // White on crimson and on black, so it reads at both ends of the pulse.
          sx={{ width: '100%', maxWidth: (theme) => theme.spacing(48), minHeight: (theme) => theme.spacing(9), typography: 'h5', bgcolor: 'common.white', color: 'common.black', '&:hover': { bgcolor: 'grey.300' } }}
        >
          On my way
        </Button>
      </Box>
    </Dialog>
  );
}
