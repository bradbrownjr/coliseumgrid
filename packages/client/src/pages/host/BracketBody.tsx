import type { Bracket, BracketMatch } from '@coliseumgrid/core';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { recordResult, startTieBreak, undoResult } from '../../api/bracket.ts';
import { useNow } from '../../components/useNow.ts';
import { Results, Standings, TieNotices, UpNext } from './BracketLists.tsx';
import { byePlayer, doneMatches, formatName, resultWords, stationWords } from './bracketWords.ts';
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
          <StationGrid stations={bracket.stations} bestOf={bracket.bestOf} now={now} busy={busy} onWinner={(...args) => void winner(...args)} />
          <UpNext matches={bracket.upNext} />
        </>
      )}
      <Results done={done} byes={byes} busy={busy} onUndo={undoMatch} />
    </Stack>
  );
}
