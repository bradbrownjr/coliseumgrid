import { LABEL_SAFE_EDGE_MM, type EventGraphic } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { graphicUrl } from '../../api/tags.ts';
import {
  GAP_MM,
  OUTLINE_MM,
  PRINT_INK,
  PRINT_PAPER,
  fitPoints,
  graphicBoxMm,
  handleMaxPt,
  mm,
  printCss,
  smallTextPt,
  tagGeometry,
  type PageMm,
} from './printLayout.ts';

/** One tag to print. `pin` is null for a reprint, and the PIN corner stays empty. */
export interface PrintTag {
  handle: string;
  pin: string | null;
}

export interface TagFaceProps {
  tag: PrintTag;
  page: PageMm;
  eventName: string;
  game: string | null;
  graphic: EventGraphic | null;
  /** The test tag draws a thin line at the safe edge, so the host can see what a printer cuts off. */
  outline?: boolean;
}

/**
 * One printed page: the tag drawn wide and, on a page taller than wide, turned a quarter turn so
 * it reads across when worn (docs/PLAN.md, "Label sizes"). The handle is the largest thing, on
 * one line; its size here is the biggest allowed, and `PrintSheet` fits it once the browser can
 * measure it. Black on white, in the units of `printLayout.ts`.
 */
export function TagFace({ tag, page, eventName, game, graphic, outline = false }: TagFaceProps) {
  const geometry = tagGeometry(page);
  const smallPt = smallTextPt(geometry);
  const maxPt = handleMaxPt(geometry);
  const box = graphic ? graphicBoxMm(graphic, geometry) : null;
  const edge = mm(LABEL_SAFE_EDGE_MM);

  return (
    <Box
      className="tag-page"
      sx={{
        position: 'relative',
        width: mm(page.widthMm),
        height: mm(page.heightMm),
        overflow: 'hidden',
        // One tag a page. The last one has no page after it, so no blank page follows.
        breakAfter: 'page',
        '&:last-of-type': { breakAfter: 'auto' },
        bgcolor: PRINT_PAPER,
        color: PRINT_INK,
        fontFamily: 'inherit',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: geometry.turn ? mm(page.widthMm) : 0,
          width: mm(geometry.wideMm),
          height: mm(geometry.tallMm),
          transformOrigin: '0 0',
          transform: geometry.turn ? 'rotate(90deg)' : 'none',
        }}
      >
        <Box sx={{ position: 'absolute', inset: edge, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ height: mm(geometry.handleMm), display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <Box
              component="span"
              data-handle=""
              data-max-pt={maxPt}
              sx={{ display: 'inline-block', whiteSpace: 'nowrap', fontWeight: 700, lineHeight: 1.15, fontSize: `${maxPt}pt` }}
            >
              {tag.handle}
            </Box>
          </Box>
          <Box sx={{ height: mm(geometry.bandMm), display: 'flex', alignItems: 'flex-end', gap: mm(GAP_MM), fontSize: `${smallPt}pt`, lineHeight: 1.2 }}>
            {graphic && box && (
              <Box
                component="img"
                src={graphicUrl(graphic)}
                alt=""
                sx={{ flex: 'none', width: mm(box.widthMm), height: mm(box.heightMm), display: 'block' }}
              />
            )}
            <Box sx={{ flex: 1, minWidth: 0, fontWeight: 700 }}>
              <Box sx={{ overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflowWrap: 'anywhere' }}>{eventName}</Box>
              {game && <Box sx={{ fontWeight: 400, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{game}</Box>}
            </Box>
            {tag.pin !== null && (
              <Box component="span" sx={{ flex: 'none', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {`PIN ${tag.pin}`}
              </Box>
            )}
          </Box>
        </Box>
        {outline && (
          <Box
            sx={{
              position: 'absolute',
              inset: edge,
              boxSizing: 'border-box',
              border: `${OUTLINE_MM}mm solid ${PRINT_INK}`,
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>
    </Box>
  );
}

export interface PrintSheetProps {
  tags: PrintTag[];
  page: PageMm;
  eventName: string;
  game: string | null;
  graphic: EventGraphic | null;
  outline?: boolean;
  /** Every handle is fitted and the picture has loaded: the page can print now. */
  onReady: () => void;
}

/**
 * The print view. It sits in <body> beside the app: on screen it is invisible, and when the
 * browser prints, everything else is hidden and only the tags show (`printCss`). It lives only
 * while a job runs. Millimetres and points are absolute, so the handle can be measured here on
 * screen and print the same.
 */
export function PrintSheet({ tags, page, eventName, game, graphic, outline = false, onReady }: PrintSheetProps) {
  const root = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  });

  useEffect(() => {
    const sheet = root.current;
    if (!sheet) return;
    let cancelled = false;
    void (async () => {
      const handles = [...sheet.querySelectorAll<HTMLElement>('[data-handle]')];
      // A font loads the first time text needs it. Measuring before that would fit the fallback
      // font, so each handle asks for its own face first.
      await Promise.all(handles.map((span) => document.fonts.load(getComputedStyle(span).font, span.textContent ?? '').catch(() => [])));
      await Promise.all([...sheet.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)));
      if (cancelled) return;
      for (const span of handles) {
        const room = span.parentElement?.clientWidth ?? 0;
        const max = Number(span.dataset["maxPt"]);
        const pt = fitPoints((size) => {
          span.style.fontSize = `${size}pt`;
          return span.offsetWidth;
        }, room, max);
        span.style.fontSize = `${pt}pt`;
        span.dataset["pt"] = String(pt);
      }
      ready.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [tags, page, graphic]);

  return createPortal(
    <>
      <GlobalStyles styles={printCss(page)} />
      <Box
        id="print-sheet"
        ref={root}
        aria-hidden="true"
        sx={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }}
      >
        {tags.map((tag, index) => (
          <TagFace key={index} tag={tag} page={page} eventName={eventName} game={game} graphic={graphic} outline={outline} />
        ))}
      </Box>
    </>,
    document.body,
  );
}
