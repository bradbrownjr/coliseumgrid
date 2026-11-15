import type { Player } from '@coliseumgrid/core';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { BOTH_MISSING_WORDS, MISSING_QUESTION } from './bracketWords.ts';

interface ForfeitDialogProps {
  /** Where the match sits, such as "Round 2". */
  title: string;
  players: readonly [Player, Player];
  /** The player who didn't come; the other is recorded as the winner. */
  onMissing: (missing: Player, winner: Player) => void;
  onClose: () => void;
}

/**
 * **Forfeit** on a match: "Who is missing?" with one large button for each player. A tap records
 * the other player as the winner, with the snackbar's Undo and no confirmation (docs/DESIGN.md,
 * "Setup wizard", "Forfeit"). Centered, like the other entry panels.
 */
export function ForfeitDialog({ title, players, onMissing, onClose }: ForfeitDialogProps) {
  const [first, second] = players;
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="forfeit-title">
      <DialogTitle id="forfeit-title" component="div">
        <Typography variant="body2" color="text.secondary" component="p">
          {title}
        </Typography>
        <Typography variant="h5" component="h2">
          {MISSING_QUESTION}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack sx={{ gap: 1.5 }}>
          {[first, second].map((player) => (
            <Button
              key={player.id}
              variant="contained"
              size="large"
              startIcon={<PersonOffIcon />}
              onClick={() => onMissing(player, player === first ? second : first)}
              sx={(theme) => ({ minHeight: theme.spacing(9), typography: 'h6', overflowWrap: 'anywhere' })}
            >
              {player.handle}
            </Button>
          ))}
          <Typography variant="body2" color="text.secondary">
            {BOTH_MISSING_WORDS}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
