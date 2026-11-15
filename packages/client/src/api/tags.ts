// Calls for the name tags (docs/PLAN.md, "Name tags API"): the print queue and the event graphic.

import type { EventAnswer, EventGraphic, TagAnswer, TagBody, TagsAnswer, TagsPrintedBody } from '@coliseumgrid/core';
import { call } from './request.ts';

/** Tags waiting to print, sorted by handle. Host only. */
export const listTags = () => call<TagsAnswer>('GET', '/api/tags');

/** A reprint: the tag joins the queue with no PIN (a PIN still waiting stays). */
export const queueTag = (playerId: number) => call<TagAnswer>('POST', '/api/tags', { playerId } satisfies TagBody);

/** The host said these tags printed, so the server deletes them and their PINs. */
export const markTagsPrinted = (playerIds: number[]) => call<void>('POST', '/api/tags/printed', { playerIds } satisfies TagsPrintedBody);

/** Uploads the picked file as the event's graphic. The file's own type goes in `Content-Type`. */
export const uploadGraphic = (file: File) => call<EventAnswer>('PUT', '/api/event/graphic', file);

export const removeGraphic = () => call<EventAnswer>('DELETE', '/api/event/graphic');

/** Where the graphic is. `version` changes with each upload, so the browser asks again. */
export const graphicUrl = (graphic: Pick<EventGraphic, 'version'>) => `/api/event/graphic?v=${encodeURIComponent(graphic.version)}`;
