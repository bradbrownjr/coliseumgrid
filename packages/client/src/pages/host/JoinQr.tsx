import Box from '@mui/material/Box';
import { useMemo } from 'react';
import { qrPath } from '../../pairing.ts';

/** The quiet zone around a QR code, in modules: 4 is the standard's minimum. */
const QUIET_MODULES = 4;

/**
 * A QR code drawn as one SVG path, with no image file and no request. It is always dark on
 * light, in both color modes: readers are built for that, and an inverted code depends on the
 * reader's settings (https://gs1uk.org/knowledge-hub/qr-codes-powered-by-gs1/what-colour-can-my-qr-code-be
 * advises against reversing the colors). The theme's common black and white stand in for the
 * two colors, so the code doesn't pick up the crimson or the dark mode background.
 */
export function JoinQr({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => qrPath(text), [text]);
  const edge = size + 2 * QUIET_MODULES;
  return (
    <Box
      component="svg"
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_MODULES} ${-QUIET_MODULES} ${edge} ${edge}`}
      shapeRendering="crispEdges"
      sx={{ display: 'block', width: '100%', maxWidth: (theme) => theme.spacing(32), bgcolor: 'common.white', color: 'common.black', borderRadius: 1 }}
    >
      <path d={path} fill="currentColor" />
    </Box>
  );
}
