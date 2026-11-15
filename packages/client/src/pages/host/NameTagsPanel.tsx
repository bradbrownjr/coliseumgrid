import { GRAPHIC_BYTES_MAX, LABEL_CUSTOM_ID, LABEL_CUSTOM_MAX_MM, LABEL_CUSTOM_MIN_MM, LABEL_PRESETS, isCustomLabelSize, type EventInfo, type NameTag } from '@coliseumgrid/core';
import DeleteIcon from '@mui/icons-material/Delete';
import ImageIcon from '@mui/icons-material/Image';
import PrintIcon from '@mui/icons-material/Print';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { failureWords } from '../../api/errors.ts';
import { listTags, markTagsPrinted, removeGraphic, uploadGraphic } from '../../api/tags.ts';
import { EventPicture } from '../../components/EventPicture.tsx';
import { loadLabelSetting, pageOf, saveLabelSetting, type LabelSetting } from './labelSetting.ts';
import { CUSTOM_SIZE_WORDS, PICTURE_HELP, PICTURE_NONE, printButtonWords, printedHelp, printedQuestion } from './nameTagWords.ts';
import { PrintSheet, type PrintTag } from './PrintSheet.tsx';

/** The sample tag: it shows where the safe edge is and never touches the print list. */
const TEST_TAG: PrintTag = { handle: 'SampleName', pin: '0000' };

type Job = { kind: 'queue'; tags: NameTag[] } | { kind: 'test' };

interface NameTagsPanelProps {
  event: EventInfo | null;
  /** Bumped when the print list changed (a `tags` message) or the connection came back, so the count is read again. */
  tagsVersion: number;
  onEventChanged: (event: EventInfo | null) => void;
}

/**
 * The Name tags panel (docs/DESIGN.md, "Name tags"): the label size, the print buttons, and the
 * event picture. Printing is one print-only sheet in the page (`PrintSheet`), asked to print once
 * its handles are fitted. The browser can't say whether a page came out, so the host is asked
 * after the print window closes, and only a Yes deletes the tags and their PINs.
 */
export function NameTagsPanel({ event, tagsVersion, onEventChanged }: NameTagsPanelProps) {
  const [tags, setTags] = useState<NameTag[] | null>(null);
  const [setting, setSetting] = useState<LabelSetting>(loadLabelSetting);
  const [customWidth, setCustomWidth] = useState(String(setting.widthMm));
  const [customHeight, setCustomHeight] = useState(String(setting.heightMm));
  const [job, setJob] = useState<Job | null>(null);
  // The tags the host is asked about, as they were when printing began, each with its version.
  // They stay while the dialog fades out, so its words don't change as it closes.
  const [asked, setAsked] = useState<NameTag[]>([]);
  const [askOpen, setAskOpen] = useState(false);
  const [askWords, setAskWords] = useState<string | null>(null);
  const [pictureWords, setPictureWords] = useState<string | null>(null);
  const [pictureBusy, setPictureBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The job the print window was opened for, so a second `onReady` for it can't open another.
  const printing = useRef<Job | null>(null);

  const load = useCallback(async () => {
    const result = await listTags();
    if (result.ok) setTags(result.data.tags);
  }, []);

  useEffect(() => {
    void load();
  }, [load, tagsVersion]);

  const custom = setting.preset === LABEL_CUSTOM_ID;
  const typedWidth = Number(customWidth);
  const typedHeight = Number(customHeight);
  const sizeOk = !custom || (customWidth.trim() !== '' && customHeight.trim() !== '' && isCustomLabelSize(typedWidth, typedHeight));
  const page = pageOf(setting);

  const change = (next: LabelSetting) => {
    setSetting(next);
    saveLabelSetting(next);
  };

  const typeSize = (which: 'width' | 'height', text: string) => {
    if (which === 'width') setCustomWidth(text);
    else setCustomHeight(text);
    const width = Number(which === 'width' ? text : customWidth);
    const height = Number(which === 'height' ? text : customHeight);
    if (text.trim() !== '' && isCustomLabelSize(width, height)) change({ preset: LABEL_CUSTOM_ID, widthMm: width, heightMm: height });
  };

  // Chrome fires `afterprint` when the print window closes, printed or not.
  const startPrint = useCallback((running: Job) => {
    if (printing.current === running) return;
    printing.current = running;
    const closed = () => {
      window.removeEventListener('afterprint', closed);
      printing.current = null;
      setJob(null);
      if (running.kind !== 'queue') return;
      setAsked(running.tags);
      setAskWords(null);
      setAskOpen(true);
    };
    window.addEventListener('afterprint', closed);
    window.print();
  }, []);

  const sheetTags = useMemo<PrintTag[]>(() => (job?.kind === 'queue' ? job.tags.map(({ handle, pin }) => ({ handle, pin })) : job ? [TEST_TAG] : []), [job]);

  const answer = async (printed: boolean) => {
    if (!printed) return setAskOpen(false);
    // The versions printed, not the ids alone: a tag queued again while this dialog was open
    // (a new PIN) is a different tag, and the server keeps it.
    const result = await markTagsPrinted(asked.map(({ playerId, version }) => ({ playerId, version })));
    if (!result.ok) return setAskWords(failureWords(result));
    setAskOpen(false);
    void load();
  };

  const choose = async (picked: ChangeEvent<HTMLInputElement>) => {
    const file = picked.target.files?.[0];
    // Clearing the input lets the same file be picked again after a refusal.
    picked.target.value = '';
    if (!file) return;
    // The server would refuse it too; saying so first saves sending up to a huge file.
    if (file.size > GRAPHIC_BYTES_MAX) return setPictureWords(failureWords({ error: 'too-large' }));
    setPictureBusy(true);
    const result = await uploadGraphic(file);
    setPictureBusy(false);
    if (!result.ok) return setPictureWords(failureWords(result));
    setPictureWords(null);
    onEventChanged(result.data.event);
  };

  const remove = async () => {
    setPictureBusy(true);
    const result = await removeGraphic();
    setPictureBusy(false);
    if (!result.ok) return setPictureWords(failureWords(result));
    setPictureWords(null);
    onEventChanged(result.data.event);
  };

  const count = tags?.length ?? 0;
  const busy = job !== null;
  const graphic = event?.graphic ?? null;

  return (
    <Stack sx={{ gap: 3 }}>
      <Stack sx={{ gap: 2 }}>
        <TextField
          select
          label="Label size"
          value={setting.preset}
          onChange={(changed) => change({ ...setting, preset: changed.target.value as LabelSetting['preset'] })}
          sx={{ maxWidth: (theme) => theme.spacing(48) }}
        >
          {LABEL_PRESETS.map((preset) => (
            <MenuItem key={preset.id} value={preset.id}>
              {`${preset.name} (${preset.label})`}
            </MenuItem>
          ))}
          <MenuItem value={LABEL_CUSTOM_ID}>Custom size</MenuItem>
        </TextField>
        {custom && (
          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="Width (mm)"
              type="number"
              value={customWidth}
              error={!sizeOk}
              onChange={(changed) => typeSize('width', changed.target.value)}
              slotProps={{ htmlInput: { min: LABEL_CUSTOM_MIN_MM, max: LABEL_CUSTOM_MAX_MM, inputMode: 'decimal' } }}
              sx={{ width: (theme) => theme.spacing(20) }}
            />
            <TextField
              label="Height (mm)"
              type="number"
              value={customHeight}
              error={!sizeOk}
              onChange={(changed) => typeSize('height', changed.target.value)}
              slotProps={{ htmlInput: { min: LABEL_CUSTOM_MIN_MM, max: LABEL_CUSTOM_MAX_MM, inputMode: 'decimal' } }}
              sx={{ width: (theme) => theme.spacing(20) }}
            />
            {!sizeOk && (
              <Typography role="alert" color="error" sx={{ alignSelf: 'center' }}>
                {CUSTOM_SIZE_WORDS}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>

      <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" size="large" startIcon={<PrintIcon />} disabled={count === 0 || !sizeOk || busy} onClick={() => tags && setJob({ kind: 'queue', tags })}>
          {printButtonWords(count)}
        </Button>
        <Button variant="outlined" size="large" startIcon={<PrintIcon />} disabled={!sizeOk || busy} onClick={() => setJob({ kind: 'test' })}>
          Print a test tag
        </Button>
      </Stack>

      <Stack sx={{ gap: 1.5 }}>
        <Typography variant="h6" component="h3">
          Event picture
        </Typography>
        {graphic ? (
          <EventPicture
            graphic={graphic}
            alt="The event picture"
            sx={{ maxWidth: '100%', height: (theme) => theme.spacing(14), width: 'auto', alignSelf: 'flex-start', border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
          />
        ) : (
          <Typography>{PICTURE_NONE}</Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {PICTURE_HELP}
        </Typography>
        <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<ImageIcon />} disabled={pictureBusy} onClick={() => fileInput.current?.click()}>
            Choose a picture
          </Button>
          <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(picked) => void choose(picked)} />
          {graphic && (
            <Button variant="outlined" startIcon={<DeleteIcon />} disabled={pictureBusy} onClick={() => void remove()}>
              Remove
            </Button>
          )}
        </Stack>
        {pictureWords && <Alert severity="error">{pictureWords}</Alert>}
      </Stack>

      {job && (
        <PrintSheet
          tags={sheetTags}
          page={page}
          eventName={event?.name ?? ''}
          game={event?.game ?? null}
          graphic={graphic}
          outline={job.kind === 'test'}
          onReady={() => startPrint(job)}
        />
      )}

      <Dialog open={askOpen} onClose={() => void answer(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{printedQuestion(asked.length)}</DialogTitle>
        <DialogContent>
          <DialogContentText>{printedHelp(asked.length)}</DialogContentText>
          {askWords && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {askWords}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void answer(false)}>No, keep them</Button>
          <Button variant="contained" onClick={() => void answer(true)}>
            Yes
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
