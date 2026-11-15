import { isHeatResult, type Heat, type Player, type RacesPerHeat } from '@coliseumgrid/core';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { MISSING_QUESTION, placeWords } from './bracketWords.ts';
import { ONE_HERE_WORDS, heatTitle, orderEntry, orderQuestion, recordHelp } from './groupWords.ts';

interface RecordDialogProps {
  heat: Heat;
  races: RacesPerHeat;
  /** Every heat made so far, to number the tie-break groups. */
  heats: readonly Heat[];
  /** Opened from Forfeit: first ask who is missing, then the order of the others. */
  askMissing?: boolean;
  /** The finishing order of those who played, 1st first, and the players who didn't come. */
  onSave: (heat: Heat, order: Player[], missing: Player[]) => void;
  onClose: () => void;
}

/**
 * The host taps the players in finishing order: "Who came 1st?", then 2nd, and so on. The last
 * player is filled in, since they can only be last. It is centered, like the other entry panels
 * (docs/DESIGN.md). Saving shows the snackbar's Undo, and nothing here asks "Are you sure?".
 *
 * From **Forfeit** it first asks "Who is missing?" with a toggle for each player. A missing
 * player scores 0 points, and at least one player has to be there (docs/PLAN.md, "Waiting for a
 * missing player").
 */
export function RecordDialog({ heat, races, heats, askMissing = false, onSave, onClose }: RecordDialogProps) {
  const [missingIds, setMissingIds] = useState<ReadonlySet<number>>(new Set());
  const [marking, setMarking] = useState(askMissing);
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const missing = heat.players.filter((player) => missingIds.has(player.id));
  const present = heat.players.filter((player) => !missingIds.has(player.id));
  const entry = orderEntry(present, pickedIds);
  const { complete } = entry;
  const ids = (list: readonly Player[]) => list.map((player) => player.id);
  const valid = complete !== null && isHeatResult(ids(heat.players), ids(complete), ids(missing));

  const toggle = (id: number) =>
    setMissingIds((before) => {
      const after = new Set(before);
      if (!after.delete(id)) after.add(id);
      return after;
    });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth scroll="paper" aria-labelledby="record-title">
      <DialogTitle id="record-title" component="div">
        <Typography variant="body2" color="text.secondary" component="p">
          {heatTitle(heat, heats)}
        </Typography>
        <Typography variant="h5" component="h2" aria-live="polite">
          {marking ? MISSING_QUESTION : orderQuestion(entry)}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {marking ? (
          <Stack sx={{ gap: 1.5 }}>
            {heat.players.map((player) => (
              <ToggleButton
                key={player.id}
                value={player.id}
                color="primary"
                selected={missingIds.has(player.id)}
                onChange={() => toggle(player.id)}
                sx={(theme) => ({ minHeight: theme.spacing(9), typography: 'h6', textTransform: 'none', overflowWrap: 'anywhere', justifyContent: 'flex-start', gap: 1 })}
              >
                {missingIds.has(player.id) && <PersonOffIcon aria-hidden />}
                {missingIds.has(player.id) ? `${player.handle}: Missing` : player.handle}
              </ToggleButton>
            ))}
            {present.length === 0 && (
              <Typography role="alert" color="error">
                {ONE_HERE_WORDS}
              </Typography>
            )}
          </Stack>
        ) : (
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
            {missing.map((player) => (
              <Paper key={player.id} variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, minHeight: (theme) => theme.spacing(6) }}>
                <PersonOffIcon aria-hidden color="action" />
                <Typography sx={{ overflowWrap: 'anywhere' }}>{player.handle}: Missing</Typography>
              </Paper>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button onClick={onClose}>Cancel</Button>
        {marking ? (
          <Button
            variant="contained"
            disabled={present.length === 0}
            onClick={() => {
              setPickedIds([]);
              setMarking(false);
            }}
          >
            Next
          </Button>
        ) : (
          <>
            {askMissing && <Button onClick={() => setMarking(true)}>Back</Button>}
            <Button disabled={pickedIds.length === 0} onClick={() => setPickedIds([])}>
              Start over
            </Button>
            <Button variant="contained" disabled={!valid} onClick={() => complete && valid && onSave(heat, complete, missing)}>
              Save
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
