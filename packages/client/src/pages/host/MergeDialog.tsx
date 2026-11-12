import type { Player } from '@coliseumgrid/core';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { useState, type SubmitEventHandler } from 'react';
import { failureWords } from '../../api/errors.ts';
import { mergePlayer } from '../../api/players.ts';

interface MergeDialogProps {
  player: Player;
  others: Player[];
  onDone: (kept: Player) => void;
  onClose: () => void;
}

/**
 * Merge can't be undone, so it is the one action that asks first (docs/DESIGN.md, "Undo,
 * not Are you sure"). The player picked in the list goes away; the player chosen here stays.
 */
export function MergeDialog({ player, others, onDone, onClose }: MergeDialogProps) {
  const [keepId, setKeepId] = useState<number | ''>('');
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit: SubmitEventHandler = async (event) => {
    event.preventDefault();
    if (busy || keepId === '') return;
    setBusy(true);
    const result = await mergePlayer(player.id, keepId);
    setBusy(false);
    if (result.ok) return onDone(result.data.player);
    setWords(failureWords(result));
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
      <DialogTitle>Merge {player.handle}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Alert severity="warning">
          {player.handle} goes away and can&apos;t come back. This can&apos;t be undone.
        </Alert>
        <FormControl fullWidth margin="dense">
          <InputLabel id="merge-keep-label">Player to keep</InputLabel>
          <Select
            labelId="merge-keep-label"
            label="Player to keep"
            value={keepId}
            onChange={(event) => {
              setKeepId(event.target.value);
              setWords(null);
            }}
          >
            {others.map((other) => (
              <MenuItem key={other.id} value={other.id}>
                {other.handle}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {words && <Alert severity="error">{words}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" color="error" disabled={keepId === '' || busy}>
          Merge
        </Button>
      </DialogActions>
    </Dialog>
  );
}
