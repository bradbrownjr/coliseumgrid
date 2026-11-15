import type { Bracket, BracketMatch, Player } from '@coliseumgrid/core';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { recordResult, startTieBreak, undoResult } from '../../api/bracket.ts';
import { useNow } from '../../components/useNow.ts';
import { Results, Standings, TieNotices, UpNext } from './BracketLists.tsx';
import { byePlayer, doneMatches, forfeitWords, formatName, matchTitle, resultWords, stationWords } from './bracketWords.ts';
import { ForfeitDialog } from './ForfeitDialog.tsx';
import { StationGrid } from './StationGrid.tsx';
import { useWriter, type Say } from './useWriter.ts';

interface BracketBodyProps {
  bracket: Bracket;
  /** Takes the bracket from the answer to a write. */
  apply: (bracket: Bracket) => void;
  reload: () => Promise<void>;
  say: Say;
}

/**
 * The host's bracket controls: tap each winner, undo a result, play a tie-break, and see the
 * standings. The server sends the bracket whole each time, and this only shows it (docs/PLAN.md,
 * "Brackets API").
 */
export function BracketBody({ bracket, apply, reload, say }: BracketBodyProps) {
  const { busy, run } = useWriter(apply, reload, say);
  const now = useNow(bracket.stations.some((station) => station.match !== null));
  const [forfeiting, setForfeiting] = useState<BracketMatch | null>(null);

  const undo = (resultId: number, message: string) =>
    run(
      () => undoResult(resultId),
      (data) => data.bracket,
      () => say(message),
    );

  const winner = (matchId: number, winnerId: number, handle: string) =>
    run(
      () => recordResult(matchId, winnerId),
      (data) => data.bracket,
      (data) => say(`${handle} won`, () => void undo(data.resultId, 'Result undone')),
    );

  // A forfeit is an ordinary result for the player who came, flagged so the lists can say so
  // (docs/PLAN.md, "Waiting for a missing player").
  const forfeit = (matchId: number, missing: Player, winnerPlayer: Player) => {
    setForfeiting(null);
    void run(
      () => recordResult(matchId, winnerPlayer.id, true),
      (data) => data.bracket,
      (data) => say(forfeitWords(missing, winnerPlayer), () => void undo(data.resultId, 'Result undone')),
    );
  };

  // The panel closes with its match, as the groups' record panel does, so a tap never goes to a
  // match that a live update or an Undo took off its station.
  const forfeitPlayers = forfeiting && bracket.stations.some((station) => station.match?.id === forfeiting.id) ? bothPlayers(forfeiting) : null;

  const undoMatch = (match: BracketMatch) => {
    if (match.resultId !== null) void undo(match.resultId, `Undid: ${resultWords(match)}`);
  };

  const playTieBreak = () =>
    run(
      () => startTieBreak(),
      (data) => data.bracket,
      () => say('Tie-break matches are on the stations'),
    );

  const done = doneMatches(bracket);
  const byes = bracket.matches.filter((match) => byePlayer(match) !== null);
  return (
    <Stack sx={{ gap: 3 }}>
      <Typography color="text.secondary">
        {formatName(bracket.format)}, best of {bracket.bestOf}, {stationWords(bracket.stations.length)}
      </Typography>
      <TieNotices ties={bracket.ties} busy={busy} onPlay={() => void playTieBreak()} />
      {bracket.finished ? (
        <Standings rows={bracket.standings} />
      ) : (
        <>
          <StationGrid
            stations={bracket.stations}
            bestOf={bracket.bestOf}
            now={now}
            busy={busy}
            noShowMinutes={bracket.noShowMinutes}
            onWinner={(...args) => void winner(...args)}
            onForfeit={setForfeiting}
          />
          <UpNext matches={bracket.upNext} />
        </>
      )}
      <Results done={done} byes={byes} busy={busy} onUndo={undoMatch} />
      {forfeiting && forfeitPlayers && (
        <ForfeitDialog
          title={matchTitle(forfeiting)}
          players={forfeitPlayers}
          onMissing={(missing, other) => forfeit(forfeiting.id, missing, other)}
          onClose={() => setForfeiting(null)}
        />
      )}
    </Stack>
  );
}

/** Both players of a match, or null while one is still to be decided. */
function bothPlayers(match: BracketMatch): [Player, Player] | null {
  const [first, second] = match.slots;
  return first.player && second.player ? [first.player, second.player] : null;
}
