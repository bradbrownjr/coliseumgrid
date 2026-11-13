import type { Bracket, BracketMatch, Player } from '@coliseumgrid/core';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useRef, useState } from 'react';
import { deleteBracket, recordResult, startTieBreak, undoResult } from '../../api/bracket.ts';
import { failureWords } from '../../api/errors.ts';
import type { Result } from '../../api/request.ts';
import { Results, Standings, TieNotices, UpNext } from './BracketLists.tsx';
import { byePlayer, doneMatches, formatName, resultWords } from './bracketWords.ts';
import { StartBracketDialog } from './StartBracketDialog.tsx';
import { StationGrid } from './StationGrid.tsx';
import { useNow } from './useNow.ts';

/** Shows a message in the host screen's snackbar, with an Undo button when `undo` is given. */
export type Say = (message: string, undo?: () => void) => void;

interface BracketSectionProps {
  /** undefined while loading; null when there is no bracket. */
  bracket: Bracket | null | undefined;
  loadWords: string | null;
  players: Player[] | null;
  /** Takes the bracket from the answer to a write. */
  apply: (bracket: Bracket | null) => void;
  reload: () => Promise<void>;
  say: Say;
}

/**
 * The host's bracket controls: start one, tap each winner, undo a result, play a tie-break, see
 * the standings, and delete it. The server sends the bracket whole each time, and this section
 * only shows it (docs/PLAN.md, "Brackets API").
 */
export function BracketSection({ bracket, loadWords, players, apply, reload, say }: BracketSectionProps) {
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  // The ref stops a second tap in the same instant; the state disables the buttons.
  const working = useRef(false);
  const now = useNow(bracket?.stations.some((station) => station.match !== null) ?? false);

  /** Runs one write. A refusal is read out and the bracket is loaded again, since the screen was out of date. */
  const run = async <T extends { bracket: Bracket }>(call: () => Promise<Result<T>>, done: (data: T) => void) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const result = await call();
    working.current = false;
    setBusy(false);
    if (result.ok) {
      apply(result.data.bracket);
      done(result.data);
    } else {
      say(failureWords(result));
      void reload();
    }
  };

  const undo = (resultId: number, message: string) =>
    run(
      () => undoResult(resultId),
      () => say(message),
    );

  const winner = (matchId: number, winnerId: number, handle: string) =>
    run(
      () => recordResult(matchId, winnerId),
      (data) => say(`${handle} won`, () => void undo(data.resultId, 'Result undone')),
    );

  const undoMatch = (match: BracketMatch) => {
    if (match.resultId !== null) void undo(match.resultId, `Undid: ${resultWords(match)}`);
  };

  const playTieBreak = () =>
    run(
      () => startTieBreak(),
      () => say('Tie-break matches are on the stations'),
    );

  const body = () => {
    if (bracket === undefined) {
      return loadWords ? null : (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading the bracket" />
        </Box>
      );
    }
    if (bracket === null) return <Typography>No bracket yet. Start one when the players have signed up.</Typography>;
    const done = doneMatches(bracket);
    const byes = bracket.matches.filter((match) => byePlayer(match) !== null);
    return (
      <Stack sx={{ gap: 3 }}>
        <Typography color="text.secondary">
          {formatName(bracket.format)}, best of {bracket.bestOf}, {bracket.stations.length === 1 ? '1 station' : `${bracket.stations.length} stations`}
        </Typography>
        <TieNotices ties={bracket.ties} busy={busy} onPlay={() => void playTieBreak()} />
        {bracket.finished ? (
          <Standings rows={bracket.standings} />
        ) : (
          <>
            <StationGrid stations={bracket.stations} bestOf={bracket.bestOf} now={now} busy={busy} onWinner={(...args) => void winner(...args)} />
            <UpNext matches={bracket.upNext} />
          </>
        )}
        <Results done={done} byes={byes} busy={busy} onUndo={undoMatch} />
      </Stack>
    );
  };

  return (
    <Box component="section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Typography variant="h4" component="h2">
          Bracket
        </Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {(bracket === null || bracket?.finished) && (
            <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={() => setStarting(true)}>
              {bracket ? 'New bracket' : 'Start a bracket'}
            </Button>
          )}
          {bracket && (
            <Button variant="outlined" color="error" size="large" startIcon={<DeleteIcon />} onClick={() => setDeleting(true)}>
              Delete bracket
            </Button>
          )}
        </Stack>
      </Stack>

      {loadWords && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" onClick={() => void reload()}>
              Try again
            </Button>
          }
        >
          {loadWords}
        </Alert>
      )}
      {body()}

      {starting && (
        <StartBracketDialog
          players={players ?? []}
          onStarted={(started) => {
            apply(started);
            setStarting(false);
            say('Bracket started');
          }}
          onClose={() => setStarting(false)}
        />
      )}
      {deleting && (
        <DeleteBracketDialog
          onClose={() => setDeleting(false)}
          onDone={() => {
            apply(null);
            setDeleting(false);
            say('Bracket deleted');
          }}
        />
      )}
    </Box>
  );
}

/**
 * Deleting a bracket drops its results for good, so it asks first (docs/DESIGN.md, "Undo, not
 * Are you sure"), like Unpair.
 */
function DeleteBracketDialog({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const result = await deleteBracket();
    setBusy(false);
    // Already gone (not-found) is what the host wanted.
    if (result.ok || result.error === 'not-found') return onDone();
    setWords(failureWords(result));
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete this bracket?</DialogTitle>
      <DialogContent>
        <DialogContentText>Every result in it goes away. This can&apos;t be undone.</DialogContentText>
        {words && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {words}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={() => void remove()} disabled={busy}>
          Delete bracket
        </Button>
      </DialogActions>
    </Dialog>
  );
}
