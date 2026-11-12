# ColiseumGrid: the server and the built client in one image, for online use (docs/PLAN.md,
# section 8).
# Build: docker build -t coliseumgrid .
# Run:   docker run --rm -p 3000:3000 -v coliseumgrid-data:/data coliseumgrid

# Build stage: install the workspace, build the client, then keep only what the server needs
# to run: its production dependencies and the workspace packages it imports.
FROM node:26-alpine AS build
# Keep this version in step with "packageManager" in package.json. Node 26 has no corepack.
RUN npm install --global pnpm@12.18.0
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Node runs the workspace's TypeScript directly, but not from inside node_modules, so the
# workspace packages stay where they are, linked from node_modules, as in the repo.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
 && pnpm install --frozen-lockfile --prod --filter "@coliseumgrid/server..."

# Runtime stage: Node, the server and the packages it imports, and the built client.
FROM node:26-alpine
LABEL org.opencontainers.image.title="ColiseumGrid" \
      org.opencontainers.image.description="A self-hosted tournament app for in-person video game events." \
      org.opencontainers.image.source="https://github.com/bradbrownjr/coliseumgrid" \
      org.opencontainers.image.licenses="MIT"

# The image is the online deployment, so it starts in online mode.
ENV NODE_ENV=production \
    COLISEUMGRID_MODE=online \
    PORT=3000 \
    CLIENT_DIST=/app/packages/client/dist
WORKDIR /app
COPY --from=build /src/package.json /src/pnpm-workspace.yaml ./
COPY --from=build /src/node_modules node_modules
COPY --from=build /src/packages/core/package.json packages/core/package.json
COPY --from=build /src/packages/core/src packages/core/src
COPY --from=build /src/packages/server/package.json packages/server/package.json
COPY --from=build /src/packages/server/src packages/server/src
COPY --from=build /src/packages/server/node_modules packages/server/node_modules
COPY --from=build /src/packages/client/dist packages/client/dist

# The node image ships a non-root "node" user. /data holds the database and uploaded
# graphics; mount a volume there to keep them.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
# Node's own fetch, so the check doesn't depend on tools in the base image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "packages/server/src/main.ts"]
