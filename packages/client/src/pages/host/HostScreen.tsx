import type { EventInfo, Player } from '@coliseumgrid/core';
import AddIcon from '@mui/icons-material/Add';
import LogoutIcon from '@mui/icons-material/Logout';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { addLatePlayer } from '../../api/bracket.ts';
import { failureWords } from '../../api/errors.ts';
import { getEvent, getHostSession, signOutHost } from '../../api/host.ts';
import { addPlayer, listPlayers, renamePlayer, resetPin } from '../../api/players.ts';
import { ColorModePicker } from '../../components/ColorModePicker.tsx';
import { Logo } from '../../components/Logo.tsx';
import { useLive } from '../../components/useLive.ts';
import { BracketSection } from './BracketSection.tsx';
import { playersInBracket } from './bracketWords.ts';
import { DeviceList } from './DeviceList.tsx';
import { EventName } from './EventName.tsx';
import { HandleDialog } from './HandleDialog.tsx';
import { MergeDialog } from './MergeDialog.tsx';
import { PairingPanel } from './PairingPanel.tsx';
import { PinDialog } from './PinDialog.tsx';
import { PlayerActions } from './PlayerActions.tsx';
import { useBracket } from './useBracket.ts';

type Dialog =
  | { kind: 'add' }
  | { kind: 'rename'; player: Player }
  | { kind: 'merge'; player: Player }
  | { kind: 'pin'; title: string; pin: string | null; words?: string };

interface HostScreenProps {
  /** The host's session ended (signed out here, or expired). */
  onSignedOut: () => void;
}

/** What a signed-in host sees: the event, the screens, and the players. */
export function HostScreen({ onSignedOut }: HostScreenProps) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [loadWords, setLoadWords] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  // `id` restarts the snackbar's timer when a new message replaces one still showing. `undo`
  // adds an Undo button (docs/DESIGN.md, "Undo, not Are you sure").
  const [notice, setNotice] = useState<{ id: number; message: string; undo?: () => void } | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const { bracket, loadWords: bracketWords, reload: reloadBracket, apply: applyBracket } = useBracket();
  // Which reset the open PIN dialog is waiting on, so a reset the host closed can't reopen it.
  const resetting = useRef(0);

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

  const loadEvent = useCallback(async () => {
    const result = await getEvent();
    if (result.ok) setEvent(result.data.event);
  }, []);

  // The live connection reloads the player list when it changes anywhere (a sign-up tablet),
  // and the event name when another host window renames it. A message sent while the socket
  // was down is lost, so each (re)connect reloads both. An ended sign-in is the same as a 401.
  useLive({
    onMessage: (message) => {
      if (message.type === 'players') void load();
      if (message.type === 'event') setEvent(message.event);
      if (message.type === 'bracket') void reloadBracket();
    },
    onOpen: () => {
      void load();
      void loadEvent();
      void reloadBracket();
    },
    onEnded: onSignedOut,
  });

  const signOut = async () => {
    const result = await signOutHost();
    if (!result.ok) return say(failureWords(result));
    // The laptop itself offline is the host without a password (docs/PLAN.md, "Host sign-in"),
    // so signing out there ends the cookie and nothing more.
    const session = await getHostSession();
    if (session.ok && session.data.signedIn) return say('This laptop stays signed in.');
    onSignedOut();
  };

  const say = (message: string, undo?: () => void) => {
    setNotice((before) => ({ id: (before?.id ?? 0) + 1, message, undo }));
    setNoticeOpen(true);
  };

  const addToBracket = async (player: Player) => {
    const result = await addLatePlayer(player.id);
    if (!result.ok) {
      void reloadBracket();
      return say(failureWords(result));
    }
    applyBracket(result.data.bracket);
    say(`Added ${player.handle} to the bracket`);
  };

  // Late players come in while the bracket says so, and only the players not in it yet.
  const inBracket = bracket && bracket.lateOpen ? playersInBracket(bracket) : null;

  const close = () => {
    resetting.current += 1;
    setDialog(null);
  };
  const changed = (message: string, next: Dialog | null = null) => {
    setDialog(next);
    say(message);
    void load();
  };

  // The dialog opens at the tap, not when the answer arrives: a PIN dialog that waits for the
  // network leaves the host looking at nothing, and a second tap would make a second PIN.
  const reset = async (player: Player) => {
    const title = `New PIN for ${player.handle}`;
    const mine = ++resetting.current;
    setDialog({ kind: 'pin', title, pin: null });
    const result = await resetPin(player.id);
    if (mine !== resetting.current) return;
    if (!result.ok) return setDialog({ kind: 'pin', title, pin: null, words: failureWords(result) });
    changed(title, { kind: 'pin', title, pin: result.data.pin });
  };

  return (
    <>
      <AppBar position="static" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2, py: 1 }}>
          <Logo />
          {/* The logo stays; the name hides on a phone so the mode picker fits the same row. */}
          <Typography variant="h6" component="h1" sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }}>
            ColiseumGrid
          </Typography>
          <Box sx={{ flexGrow: { xs: 1, sm: 0 }, display: 'flex', justifyContent: 'flex-end' }}>
            <ColorModePicker />
          </Box>
          {/* Same one-list idea as the mode picker: the name hides on a phone, the icon stays. */}
          <Button variant="outlined" startIcon={<LogoutIcon />} onClick={() => void signOut()} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            Sign out
          </Button>
          <IconButton aria-label="Sign out" onClick={() => void signOut()} sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Container component="main" sx={{ py: { xs: 2, sm: 4 }, display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }}>
        <Section title="Event">
          <EventName event={event} onSaved={(saved) => { setEvent(saved); say('Event name saved'); }} />
        </Section>

        <Section title="Screens">
          <PairingPanel />
          <DeviceList onUnpaired={say} />
        </Section>

        <BracketSection bracket={bracket} loadWords={bracketWords} players={players} apply={applyBracket} reload={reloadBracket} say={say} />

        <Box component="section">
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 3 }}>
          <Typography variant="h4" component="h2">
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
                      <PlayerActions
                        player={player}
                        canMerge={players.length >= 2}
                        onRename={() => setDialog({ kind: 'rename', player })}
                        onResetPin={() => void reset(player)}
                        onMerge={() => setDialog({ kind: 'merge', player })}
                        onAddToBracket={inBracket && !inBracket.has(player.id) ? () => void addToBracket(player) : undefined}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        </Box>
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
      {dialog?.kind === 'pin' && <PinDialog title={dialog.title} pin={dialog.pin} words={dialog.words} onClose={close} />}

      <Snackbar
        open={noticeOpen}
        key={notice?.id}
        autoHideDuration={notice?.undo ? 8000 : 4000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setNoticeOpen(false);
        }}
        message={notice?.message}
        action={
          notice?.undo && (
            <Button
              color="inherit"
              onClick={() => {
                setNoticeOpen(false);
                notice.undo?.();
              }}
            >
              Undo
            </Button>
          )
        }
      />
    </>
  );
}

/** A titled block of the host screen. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography variant="h4" component="h2" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Stack sx={{ gap: 3 }}>{children}</Stack>
    </Box>
  );
}
