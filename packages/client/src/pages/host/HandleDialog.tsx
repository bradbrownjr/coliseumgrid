import { HANDLE_MAX, HANDLE_MIN, checkHandle } from '@coliseumgrid/core';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useState, type SubmitEventHandler } from 'react';
import { failureWords, HANDLE_REFUSAL_WORDS } from '../../api/errors.ts';
import type { Result } from '../../api/players.ts';

interface HandleDialogProps<T> {
  title: string;
  label: string;
  submitLabel: string;
  initial?: string;
  /** Sends the checked handle to the server. */
  send: (handle: string) => Promise<Result<T>>;
  onDone: (data: T, handle: string) => void;
  onClose: () => void;
}

/** One handle field in a dialog. Add player and Rename are both this. */
export function HandleDialog<T>({ title, label, submitLabel, initial = '', send, onDone, onClose }: HandleDialogProps<T>) {
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [serverWords, setServerWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = checkHandle(value);
  const liveWords =
    value !== '' && !check.ok && (check.reason !== 'too-short' || attempted) ? HANDLE_REFUSAL_WORDS[check.reason] : null;
  const words = liveWords ?? serverWords;

  const submit: SubmitEventHandler = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!check.ok) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    const result = await send(check.handle);
    setBusy(false);
    if (result.ok) return onDone(result.data, check.handle);
    setServerWords(failureWords(result));
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth slotProps={{ paper: { component: 'form', onSubmit: submit } }}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label={label}
          value={value}
          error={words !== null}
          helperText={words ?? `Use ${HANDLE_MIN} to ${HANDLE_MAX} letters or numbers.`}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            setServerWords(null);
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={value.trim() === '' || busy}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
