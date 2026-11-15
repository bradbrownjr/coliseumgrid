// The name tags API (docs/PLAN.md, "Name tags API"): the event graphic and the print queue. Every
// JSON answer lists its fields and every body schema is closed (CLAUDE.md, rule 1). The queue and
// its PINs are for the host only; the graphic is for the host and paired screens, never a phone.

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GRAPHIC_BYTES_MAX,
  GRAPHIC_SIZE_MAX,
  GRAPHIC_SIZE_MIN,
  IMAGE_TYPES,
  imageInfo,
  type ApiError,
  type EventAnswer,
  type ImageType,
  type TagAnswer,
  type TagBody,
  type TagsAnswer,
  type TagsPrintedBody,
} from '@coliseumgrid/core';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { Access } from './access.ts';
import { errorSchema, fail, notSignedIn, nullableEventSchema, objectSchema } from './api-schemas.ts';
import type { Events } from './events.ts';
import type { LiveHub } from './live.ts';
import type { Players } from './players.ts';
import type { TagQueue } from './tag-queue.ts';
import { newToken } from './tokens.ts';
import type { WriteChain } from './write-chain.ts';

export interface NameTagRoutesOptions {
  access: Access;
  events: Events;
  players: Players;
  tags: TagQueue;
  hub: LiveHub;
  /** The one write chain, so a graphic change can't interleave with a new event copying the graphic. */
  chain: WriteChain;
  /** DATA_DIR/graphics: where uploaded graphics are kept. Made on the first upload. */
  graphicsDir: string;
  /** Called after the event changes, so the kept phone answer (it has the event) is dropped. */
  onEventChanged: () => void;
  /** Called after the queue changes, so host screens reload it. */
  onTagsChanged: () => void;
}

const tagSchema = objectSchema({ playerId: { type: 'integer' }, handle: { type: 'string' }, pin: { type: ['string', 'null'] } });
const eventAnswerSchema = objectSchema({ event: nullableEventSchema });

// The ids only have to be players; the size limit keeps a huge body small.
const PRINTED_IDS_MAX = 1000;
const tagBody = objectSchema({ playerId: { type: 'integer', minimum: 1 } });
const printedBody = objectSchema({
  playerIds: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: PRINTED_IDS_MAX },
});

const badRequest = errorSchema(['bad-request']);
const notFound = errorSchema(['not-found']);

/** The media type of a Content-Type header, lower case, without parameters. */
function mediaType(header: string | undefined): string {
  return (header ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

const isImageType = (type: string): type is ImageType => (IMAGE_TYPES as readonly string[]).includes(type);

const isMissingFile = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

export async function registerNameTagRoutes(app: FastifyInstance, options: NameTagRoutesOptions): Promise<void> {
  const { access, events, players, tags, hub, chain, graphicsDir, onEventChanged, onTagsChanged } = options;
  const pathOf = (file: string): string => join(graphicsDir, file);

  /**
   * Deletes a replaced graphic's file once no event, current or past, uses it. It runs after the
   * database has moved on, so a failure is logged and never undoes the change.
   */
  async function removeIfUnused(file: string | null): Promise<void> {
    if (file === null || events.graphicInUse(file)) return;
    await unlink(pathOf(file)).catch((error: unknown) => {
      if (!isMissingFile(error)) app.log.warn(`A replaced graphic could not be deleted: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  // The event graphic ---------------------------------------------------------------------

  // The upload is the one route that takes a raw body, so its parser and its error codes live in
  // their own plugin scope (https://fastify.dev/docs/latest/Reference/Encapsulation/), and every
  // other route still refuses an image body.
  await app.register(async (scope) => {
    scope.addContentTypeParser([...IMAGE_TYPES], { parseAs: 'buffer', bodyLimit: GRAPHIC_BYTES_MAX }, (_request, body, done) => done(null, body));
    // A body over the limit and a Content-Type with no parser get their own codes here. Anything
    // else goes on to app.ts's handler, which is what a throw from a scope's handler does.
    scope.setErrorHandler((error: FastifyError, _request, reply) => {
      if (error.statusCode === 413) return fail(reply, 413, 'too-large');
      if (error.statusCode === 415) return fail(reply, 415, 'bad-type');
      throw error;
    });

    scope.put<{ Reply: EventAnswer | ApiError }>(
      '/api/event/graphic',
      {
        // Runs before the body is read, so nobody else can make the server take 2 MB.
        onRequest: access.requireHost,
        bodyLimit: GRAPHIC_BYTES_MAX,
        schema: {
          response: {
            200: eventAnswerSchema,
            400: errorSchema(['bad-image', 'bad-request']),
            401: notSignedIn,
            413: errorSchema(['too-large']),
            415: errorSchema(['bad-type']),
          },
        },
      },
      async (request, reply) => {
        // The JSON parser is still in this scope, so a JSON body arrives here as an object.
        const declared = mediaType(request.headers['content-type']);
        if (!isImageType(declared)) return fail(reply, 415, 'bad-type');
        // Only the image parser reads these types; an empty body never reaches it.
        const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        // The type and size come from the file's own header; the declared type must agree.
        const info = imageInfo(bytes);
        const inRange = (n: number): boolean => n >= GRAPHIC_SIZE_MIN && n <= GRAPHIC_SIZE_MAX;
        if (!info.ok || info.type !== declared || !inRange(info.width) || !inRange(info.height)) return fail(reply, 400, 'bad-image');

        // A random name the server makes, never anything from the request.
        const file = newToken();
        await mkdir(graphicsDir, { recursive: true });
        await writeFile(pathOf(file), bytes, { flag: 'wx', mode: 0o600 });
        const { event, replaced } = await chain.run(async () => {
          let changed;
          try {
            changed = events.setGraphic({ file, type: info.type, width: info.width, height: info.height });
          } catch (error) {
            // The file was written first, so a failed update would leave it behind.
            await unlink(pathOf(file)).catch(() => undefined);
            throw error;
          }
          // On the chain, so two uploads tell the screens in the order they were stored.
          onEventChanged();
          hub.broadcast({ type: 'event', event: changed.event });
          return changed;
        });
        await removeIfUnused(replaced);
        return { event };
      },
    );
  });

  app.delete<{ Reply: EventAnswer }>(
    '/api/event/graphic',
    { onRequest: access.requireHost, schema: { response: { 200: eventAnswerSchema, 401: notSignedIn } } },
    async () =>
      chain.run(async () => {
        const { event, replaced } = events.setGraphic(null);
        if (replaced === null) return { event };
        await removeIfUnused(replaced);
        onEventChanged();
        hub.broadcast({ type: 'event', event });
        return { event };
      }),
  );

  app.get(
    '/api/event/graphic',
    // The host and paired screens; a phone gets 401 like every other screen route.
    { onRequest: access.requireHostOrDevice, schema: { response: { 304: { type: 'null' }, 401: notSignedIn, 404: notFound } } },
    async (request, reply) => {
      const graphic = events.graphic();
      if (graphic === null) return fail(reply, 404, 'not-found');
      // The file name is random and changes with each upload, so it is the version and the ETag.
      const etag = `"${graphic.file}"`;
      reply
        .header('etag', etag)
        .header('cache-control', 'private, no-cache')
        // The type is the one read from the file's header at upload. nosniff stops a browser from
        // guessing another, and the policy stops the file from running anything if it is opened
        // at its own address (docs/PLAN.md, "The event graphic").
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox");
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      let bytes: Buffer;
      try {
        bytes = await readFile(pathOf(graphic.file));
      } catch (error) {
        if (isMissingFile(error)) return fail(reply, 404, 'not-found');
        throw error;
      }
      return reply.type(graphic.type).send(bytes);
    },
  );

  // The print queue -----------------------------------------------------------------------

  app.get<{ Reply: TagsAnswer }>(
    '/api/tags',
    { onRequest: access.requireHost, schema: { response: { 200: objectSchema({ tags: { type: 'array', items: tagSchema } }), 401: notSignedIn } } },
    async () => ({ tags: tags.list() }),
  );

  app.post<{ Body: TagBody; Reply: TagAnswer | ApiError }>(
    '/api/tags',
    {
      onRequest: access.requireHost,
      schema: { body: tagBody, response: { 201: objectSchema({ tag: tagSchema }), 400: badRequest, 401: notSignedIn, 404: notFound } },
    },
    async (request, reply) => {
      const { playerId } = request.body;
      if (!players.get(playerId)) return fail(reply, 404, 'not-found');
      // A reprint: the server has no plain PIN to print, so it queues none (a PIN already queued stays).
      tags.queue(playerId, null);
      const tag = tags.get(playerId);
      if (!tag) return fail(reply, 404, 'not-found');
      onTagsChanged();
      return reply.code(201).send({ tag });
    },
  );

  app.post<{ Body: TagsPrintedBody }>(
    '/api/tags/printed',
    {
      onRequest: access.requireHost,
      schema: { body: printedBody, response: { 204: { type: 'null' }, 400: badRequest, 401: notSignedIn } },
    },
    async (request, reply) => {
      if (tags.printed(request.body.playerIds) > 0) onTagsChanged();
      return reply.code(204).send();
    },
  );
}
