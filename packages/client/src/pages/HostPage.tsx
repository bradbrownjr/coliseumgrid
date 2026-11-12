import type { Player } from '@coliseumgrid/core';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import KeyIcon from '@mui/icons-material/VpnKey';
import MergeIcon from '@mui/icons-material/MergeType';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { failureWords } from '../api/errors.ts';
import { addPlayer, listPlayers, renamePlayer, resetPin } from '../api/players.ts';
import { ColorModePicker } from '../components/ColorModePicker.tsx';
import { Logo } from '../components/Logo.tsx';
import { HandleDialog } from './host/HandleDialog.tsx';
import { MergeDialog } from './host/MergeDialog.tsx';
import { PinDialog } from './host/PinDialog.tsx';

type Dialog =
  | { kind: 'add' }
  | { kind: 'rename'; player: Player }
  | { kind: 'merge'; player: Player }
  | { kind: 'pin'; title: string; pin: string };

export function HostPage() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [loadWords, setLoadWords] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const load = useCallback(async () => {
    const result = await listPlayers();
    if (result.ok) {
      setPlayers(result.data.players);
      setLoadWords(null);
    } else {
      setLoadWords(failureWords(result));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const say = (message: string) => {
    setNotice(message);
    setNoticeOpen(true);
  };

  const close = () => setDialog(null);
  const changed = (message: string, next: Dialog | null = null) => {
    setDialog(next);
    say(message);
    void load();
  };

  // A failed reset has no dialog to show its words in, so they go to the snackbar.
  const reset = async (player: Player) => {
    const result = await resetPin(player.id);
    if (!result.ok) return say(failureWords(result));
    changed(`New PIN for ${player.handle}`, { kind: 'pin', title: `New PIN for ${player.handle}`, pin: result.data.pin });
  };

  return (
    <>
      <AppBar position="static" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
          <Logo />
          <Typography variant="h6" component="p" sx={{ flexGrow: 1 }}>
            ColiseumGrid
          </Typography>
          <ColorModePicker />
        </Toolbar>
      </AppBar>
      <Container component="main" sx={{ py: 4 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
          <Typography variant="h3" component="h1">
            Players
          </Typography>
          <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={() => setDialog({ kind: 'add' })}>
            Add player
          </Button>
        </Stack>

        {loadWords && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button color="inherit" onClick={() => void load()}>
                Try again
              </Button>
            }
          >
            {loadWords}
          </Alert>
        )}

        {players === null ? (
          !loadWords && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress aria-label="Loading players" />
            </Box>
          )
        ) : players.length === 0 ? (
          <Typography>No players yet. Add the first one.</Typography>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Handle</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {players.map((player) => (
                  <TableRow key={player.id}>
                    <TableCell component="th" scope="row" sx={{ typography: 'h6', overflowWrap: 'anywhere' }}>
                      {player.handle}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setDialog({ kind: 'rename', player })}>
                          Rename
                        </Button>
                        <Button variant="outlined" startIcon={<KeyIcon />} onClick={() => void reset(player)}>
                          Reset PIN
                        </Button>
                        <Button
                          variant="outlined"
                          startIcon={<MergeIcon />}
                          disabled={players.length < 2}
                          onClick={() => setDialog({ kind: 'merge', player })}
                        >
                          Merge
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Container>

      {dialog?.kind === 'add' && (
        <HandleDialog
          title="Add player"
          label="Handle"
          submitLabel="Add"
          send={addPlayer}
          onDone={(data) =>
            changed(`Added ${data.player.handle}`, { kind: 'pin', title: `PIN for ${data.player.handle}`, pin: data.pin })
          }
          onClose={close}
        />
      )}
      {dialog?.kind === 'rename' && (
        <HandleDialog
          title={`Rename ${dialog.player.handle}`}
          label="New handle"
          submitLabel="Rename"
          initial={dialog.player.handle}
          send={(handle) => renamePlayer(dialog.player.id, handle)}
          onDone={(data) => changed(`Renamed to ${data.player.handle}`)}
          onClose={close}
        />
      )}
      {dialog?.kind === 'merge' && (
        <MergeDialog
          player={dialog.player}
          others={(players ?? []).filter((other) => other.id !== dialog.player.id)}
          onDone={(kept) => changed(`Merged ${dialog.player.handle} into ${kept.handle}`)}
          onClose={close}
        />
      )}
      {dialog?.kind === 'pin' && <PinDialog title={dialog.title} pin={dialog.pin} onClose={close} />}

      <Snackbar
        open={noticeOpen}
        autoHideDuration={4000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setNoticeOpen(false);
        }}
        message={notice}
      />
    </>
  );
}
