import type { EventGraphic } from '@coliseumgrid/core';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { graphicUrl } from '../api/tags.ts';

interface EventPictureProps {
  graphic: EventGraphic;
  /** The picture is decoration beside the event name, so it has no description unless one is given. */
  alt?: string;
  sx?: SxProps<Theme>;
}

/**
 * The event's graphic, shown only through <img>: the server's headers stop the file from running
 * anything, and an image can't (docs/PLAN.md, "The event graphic"). `version` changes with each
 * upload, so the address changes and the browser loads the new file.
 */
export function EventPicture({ graphic, alt = '', sx }: EventPictureProps) {
  return <Box component="img" src={graphicUrl(graphic)} alt={alt} sx={[{ display: 'block', objectFit: 'contain', aspectRatio: `${graphic.width} / ${graphic.height}` }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]} />;
}
