import type { EventInfo, Player } from '@coliseumgrid/core';
import AddIcon from '@mui/icons-material/Add';
import EventIcon from '@mui/icons-material/Event';
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
import { addLateHeatPlayer } from '../../api/heats.ts';
import { failureWords } from '../../api/errors.ts';
import { getEvent, getHostSession, signOutHost } from '../../api/host.ts';
import { addPlayer, listPlayers, renamePlayer, resetPin } from '../../api/players.ts';
import { ColorModePicker } from '../../components/ColorModePicker.tsx';
import { Logo } from '../../components/Logo.tsx';
import { useLive } from '../../components/useLive.ts';
import { playersInBracket } from './bracketWords.ts';
import { CompetitionSection } from './CompetitionSection.tsx';
import { DeviceList } from './DeviceList.tsx';
import { EventName } from './EventName.tsx';
import { playersInHeats } from './groupWords.ts';
import { HandleDialog } from './HandleDialog.tsx';
import { MergeDialog } from './MergeDialog.tsx';
import { PairingPanel } from './PairingPanel.tsx';
import { PinDialog } from './PinDialog.tsx';
import { PlayerActions } from './PlayerActions.tsx';
import { SetupWizard, type WizardMode } from './SetupWizard.tsx';
import { useBracket } from './useBracket.ts';
import { useHeats } from './useHeats.ts';

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
  // Bumped on each player list load, so the wizard's step 3 reloads who signed up.
  const [playersVersion, setPlayersVersion] = useState(0);
  // The wizard opened from play mode: New event, or New competition after a finish.
  const [wizard, setWizard] = useState<Exclude<WizardMode, 'setup'> | null>(null);
  // `id` restarts the snackbar's timer when a new message replaces one still showing. `undo`
  // adds an Undo button (docs/DESIGN.md, "Undo, not Are you sure").
  const [notice, setNotice] = useState<{ id: number; message: string; undo?: () => void } | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const bracketState = useBracket();
  const heatsState = useHeats();
  const { value: bracket, reload: reloadBracket, apply: applyBracket } = bracketState;
  const { value: heats, reload: reloadHeats, apply: applyHeats } = heatsState;
  // Which reset the open PIN dialog is waiting on, so a reset the host closed can't reopen it.
  const resetting = useRef(0);
  // The ref stops a second "Add to bracket" tap in the same instant; the state disables the buttons.
  const adding = useRef(false);
  const [addBusy, setAddBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await listPlayers();
    if (result.ok) {
      setPlayers(result.data.players);
      setPlayersVersion((before) => before + 1);
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
  // and the event name when another host window renames it. The bracket and the groups reload
  // with the players too, since they show handles and a rename changes one. A message sent while
  // the socket was down is lost, so each (re)connect reloads all of them. An ended sign-in is the
  // same as a 401.
  useLive({
    onMessage: (message) => {
      if (message.type === 'players') {
        void load();
        void reloadBracket();
        void reloadHeats();
      }
      if (message.type === 'event') setEvent(message.event);
      if (message.type === 'bracket') void reloadBracket();
      if (message.type === 'heats') void reloadHeats();
    },
    onOpen: () => {
      void load();
      void loadEvent();
      void reloadBracket();
      void reloadHeats();
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

  const addToCompetition = async (player: Player) => {
    if (adding.current) return;
    adding.current = true;
    setAddBusy(true);
    // Whichever competition is running takes the late player.
    const result = heats && !bracket ? await addLateHeatPlayer(player.id) : await addLatePlayer(player.id);
    adding.current = false;
    setAddBusy(false);
    if (!result.ok) {
      void reloadBracket();
      void reloadHeats();
      return say(failureWords(result));
    }
    if ('heats' in result.data) {
      applyHeats(result.data.heats);
      say(`Added ${player.handle} to a group`);
    } else {
      applyBracket(result.data.bracket);
      say(`Added ${player.handle} to the bracket`);
    }
  };

  // Late players come in while the competition says so, and only the players not in it yet.
  const alreadyIn = bracket && bracket.lateOpen ? playersInBracket(bracket) : heats && heats.lateOpen ? playersInHeats(heats) : null;
  const lateLabel = heats && !bracket ? 'Add to group' : 'Add to bracket';

  // Setup mode while the event has no bracket and no groups (docs/PLAN.md, "The setup wizard"):
  // the wizard takes the place of the Event and Competition sections. Until both are loaded
  // neither mode shows, so the rename box doesn't flash up before the wizard.
  const loaded = bracket !== undefined && heats !== undefined;
  const setupMode = bracket === null && heats === null;
  const wizardMode: WizardMode | null = setupMode ? 'setup' : wizard;

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
        {/* One element in one place for setup and play-mode openings alike, so the wizard keeps its step when a new event turns play mode into setup mode. */}
        {wizardMode ? (
          <SetupWizard
            mode={wizardMode}
            event={event}
            players={players ?? []}
            playersVersion={playersVersion}
            onCancel={setupMode ? undefined : () => setWizard(null)}
            onEventSaved={setEvent}
            onEventCreated={(created) => {
              setEvent(created);
              // The new event has no bracket and no groups; the old one keeps its own.
              applyBracket(null);
              applyHeats(null);
              setWizard(null);
              say('New event made');
            }}
            onStartedBracket={(started) => {
              applyBracket(started);
              // A new one replaces a finished one of either kind.
              applyHeats(null);
              setWizard(null);
              say('Bracket started');
            }}
            onStartedGroups={(started) => {
              applyHeats(started);
              applyBracket(null);
              setWizard(null);
              say('Groups started');
            }}
          />
        ) : (
          loaded && (
            <Section
              title="Event"
              action={
                <Button variant="outlined" size="large" startIcon={<EventIcon />} onClick={() => setWizard('new-event')}>
                  New event
                </Button>
              }
            >
              <EventName
                event={event}
                onSaved={(saved) => {
                  setEvent(saved);
                  say('Event saved');
                }}
              />
            </Section>
          )
        )}

        <Section title="Screens">
          <PairingPanel />
          <DeviceList onUnpaired={say} />
        </Section>

        {!wizardMode && <CompetitionSection bracket={bracketState} heats={heatsState} say={say} onNewCompetition={() => setWizard('new-competition')} />}

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
                        addLate={alreadyIn && !alreadyIn.has(player.id) ? { label: lateLabel, run: () => void addToCompetition(player) } : undefined}
                        addBusy={addBusy}
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

/** A titled block of the host screen, with an optional button by the title. */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box component="section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="h4" component="h2">
          {title}
        </Typography>
        {action}
      </Stack>
      <Stack sx={{ gap: 3 }}>{children}</Stack>
    </Box>
  );
}
