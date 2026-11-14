import type { Heat, Player, RacesPerHeat } from '@coliseumgrid/core';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { placeWords } from './bracketWords.ts';
import { heatTitle, orderEntry, orderQuestion, recordHelp } from './groupWords.ts';

interface RecordDialogProps {
  heat: Heat;
  races: RacesPerHeat;
  /** Every heat made so far, to number the tie-break groups. */
  heats: readonly Heat[];
  /** The finishing order, 1st first. */
  onSave: (heat: Heat, order: Player[]) => void;
  onClose: () => void;
}

/**
 * The host taps the players in finishing order: "Who came 1st?", then 2nd, and so on. The last
 * player is filled in, since they can only be last. It is centered, like the other entry panels
 * (docs/DESIGN.md). Saving shows the snackbar's Undo, and nothing here asks "Are you sure?".
 */
export function RecordDialog({ heat, races, heats, onSave, onClose }: RecordDialogProps) {
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const entry = orderEntry(heat.players, pickedIds);
  const { complete } = entry;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth scroll="paper" aria-labelledby="record-title">
      <DialogTitle id="record-title" component="div">
        <Typography variant="body2" color="text.secondary" component="p">
          {heatTitle(heat, heats)}
        </Typography>
        <Typography variant="h5" component="h2" aria-live="polite">
          {orderQuestion(entry)}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack sx={{ gap: 1.5 }}>
          {!complete && (
            <Typography variant="body2" color="text.secondary">
              {recordHelp(races)}
            </Typography>
          )}
          {entry.picked.map((player, i) => (
            <Paper key={player.id} variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, minHeight: (theme) => theme.spacing(6) }}>
              <Typography sx={{ fontWeight: 'bold', minWidth: '3ch' }}>{placeWords(i + 1)}</Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{player.handle}</Typography>
            </Paper>
          ))}
          {entry.remaining.map((player) => (
            <Button
              key={player.id}
              variant="contained"
              size="large"
              onClick={() => setPickedIds((before) => [...before, player.id])}
              sx={(theme) => ({ minHeight: theme.spacing(9), typography: 'h6', overflowWrap: 'anywhere' })}
            >
              {player.handle}
            </Button>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={pickedIds.length === 0} onClick={() => setPickedIds([])}>
          Start over
        </Button>
        <Button variant="contained" disabled={!complete} onClick={() => complete && onSave(heat, complete)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
