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
import { useState } from 'react';
import { deleteBracket } from '../../api/bracket.ts';
import { failureWords } from '../../api/errors.ts';
import { deleteHeats } from '../../api/heats.ts';
import type { Result } from '../../api/request.ts';
import { BracketBody } from './BracketBody.tsx';
import { GroupsBody } from './GroupsBody.tsx';
import type { BracketState } from './useBracket.ts';
import type { HeatsState } from './useHeats.ts';
import type { Say } from './useWriter.ts';

interface CompetitionSectionProps {
  bracket: BracketState;
  heats: HeatsState;
  say: Say;
  /** Opens the wizard at step 2 for a new competition, once this one has finished. */
  onNewCompetition: () => void;
}

type Kind = 'bracket' | 'groups';

/**
 * The host's competition in play mode: run the bracket or the groups, and delete it. An event
 * runs one of them (docs/PLAN.md, "Heats API"), so one section covers both. The setup wizard
 * starts one. The title is "Competition" because "Bracket" would be wrong over a race.
 */
export function CompetitionSection({ bracket, heats, say, onNewCompetition }: CompetitionSectionProps) {
  const [deleting, setDeleting] = useState(false);

  // At most one exists. A finished one is shown until a new one replaces it.
  const kind: Kind | null = bracket.value ? 'bracket' : heats.value ? 'groups' : null;
  const finished = bracket.value ? bracket.value.finished : (heats.value?.finished ?? false);
  const loading = bracket.value === undefined || heats.value === undefined;
  const loadWords = bracket.loadWords ?? heats.loadWords;
  const reloadBoth = async () => {
    await Promise.all([bracket.reload(), heats.reload()]);
  };

  const body = () => {
    if (bracket.value) return <BracketBody bracket={bracket.value} apply={bracket.apply} reload={bracket.reload} say={say} />;
    if (heats.value) return <GroupsBody heats={heats.value} apply={heats.apply} reload={heats.reload} say={say} />;
    if (loading && !loadWords) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading the competition" />
        </Box>
      );
    }
    return null;
  };

  return (
    <Box component="section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Typography variant="h4" component="h2">
          Competition
        </Typography>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          {finished && (
            <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={onNewCompetition}>
              New competition
            </Button>
          )}
          {kind && (
            <Button variant="outlined" color="error" size="large" startIcon={<DeleteIcon />} onClick={() => setDeleting(true)}>
              {kind === 'bracket' ? 'Delete bracket' : 'Delete groups'}
            </Button>
          )}
        </Stack>
      </Stack>

      {loadWords && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" onClick={() => void reloadBoth()}>
              Try again
            </Button>
          }
        >
          {loadWords}
        </Alert>
      )}
      {body()}

      {deleting && kind && (
        <DeleteDialog
          kind={kind}
          onClose={() => setDeleting(false)}
          onDone={() => {
            if (kind === 'bracket') bracket.apply(null);
            else heats.apply(null);
            setDeleting(false);
            say(kind === 'bracket' ? 'Bracket deleted' : 'Groups deleted');
          }}
        />
      )}
    </Box>
  );
}

const DELETE_WORDS: Record<Kind, { title: string; button: string; call: () => Promise<Result<void>> }> = {
  bracket: { title: 'Delete this bracket?', button: 'Delete bracket', call: deleteBracket },
  groups: { title: 'Delete these groups?', button: 'Delete groups', call: deleteHeats },
};

/**
 * Deleting drops every result for good, so it asks first (docs/DESIGN.md, "Undo, not Are you
 * sure"), like Unpair.
 */
function DeleteDialog({ kind, onDone, onClose }: { kind: Kind; onDone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState<string | null>(null);
  const { title, button, call } = DELETE_WORDS[kind];

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const result = await call();
    setBusy(false);
    // Already gone (not-found, or no-heats) is what the host wanted.
    if (result.ok || result.error === 'not-found' || result.error === 'no-heats' || result.error === 'no-bracket') return onDone();
    setWords(failureWords(result));
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
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
          {button}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
