# Self-hosting

How to run ColiseumGrid yourself, offline on a laptop or online from a Docker image. The
design is in [`PLAN.md`](PLAN.md) section 8; the settings are listed in
[`DEVELOPMENT.md`](DEVELOPMENT.md), "Server settings".

## Offline on a laptop

Offline mode is for a venue with no internet: a laptop, a travel router, and the devices on
its Wi-Fi. It is the default (`COLISEUMGRID_MODE=offline`).

The portable bundle for Windows x64 and Linux x64 is planned for M9 and isn't built yet, so
there is no download, launcher, or release zip to describe. Its design is in `PLAN.md`
section 8, "Offline: portable bundle". Until it exists, run from source (Node 26 or later
and pnpm; see `DEVELOPMENT.md`, "Requirements"):

```sh
pnpm install
pnpm build
pnpm start
```

- **Address and port**: the server listens on every address, port 3000. Tablets, the TV, and
  phones open `http://<the laptop's address>:3000`. The host opens `http://localhost:3000/host`
  on the laptop itself.
- **Host password**: the first visit to `/host` from `localhost` asks you to set it. From any
  other device the host screens need that password (`PLAN.md`, section 3, "Host sign-in").
  Set `COLISEUMGRID_HOST_PASSWORD` to skip first-run setup.
- **Data**: a `data` folder under the folder you start the server from, or `DATA_DIR`. See
  "Updating and backups" for what is in it.
- **Firewall**: the laptop's firewall has to allow incoming connections on port 3000 from the
  venue network, or other devices can't reach it. `PLAN.md` section 8 expects Windows
  Firewall to ask about this on the first run.
- **Phones**: a phone joins the venue Wi-Fi to reach the laptop. Over plain `http` it gets the
  page alert only, not push or the wake lock (`PLAN.md`, section 3, "Player view").

## Online with Docker

The image `ghcr.io/bradbrownjr/coliseumgrid` holds the server and the built client. From
the Dockerfile: it listens on port 3000, keeps its data in `/data`, runs as the non-root
`node` user, and starts in online mode, which stops at startup without a host password.

The tags are `edge` and `sha-<short sha>`, both pushed from the default branch
(`.github/workflows/docker.yml`, checked 2026-11-19).

```sh
docker run -d --name coliseumgrid --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v coliseumgrid-data:/data \
  -e COLISEUMGRID_HOST_PASSWORD='change-this-password' \
  -e TRUSTED_PROXY=172.18.0.1 \
  -e COLISEUMGRID_PUSH_SUBJECT=mailto:you@example.com \
  ghcr.io/bradbrownjr/coliseumgrid:edge
```

The `127.0.0.1:` in `-p` keeps the app off the public interface, so only a proxy on the same
machine reaches it. Replace the `TRUSTED_PROXY` address with the one your proxy shows up as
(see "What the app needs from the proxy").

A Compose file with the proxy on a network whose addresses you choose, so `TRUSTED_PROXY` is
known:

```yaml
services:
  coliseumgrid:
    image: ghcr.io/bradbrownjr/coliseumgrid:edge
    restart: unless-stopped
    environment:
      COLISEUMGRID_HOST_PASSWORD: ${COLISEUMGRID_HOST_PASSWORD}
      TRUSTED_PROXY: 172.30.0.10
      COLISEUMGRID_PUSH_SUBJECT: mailto:you@example.com
    volumes:
      - coliseumgrid-data:/data
    networks:
      - web

  proxy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    networks:
      web:
        ipv4_address: 172.30.0.10

networks:
  web:
    ipam:
      config:
        - subnet: 172.30.0.0/24

volumes:
  coliseumgrid-data:
  caddy-data:
```

Put the password in a `.env` file beside the Compose file, not in the YAML. The image has a
health check on `/api/health`.

### The data folder and its owner

The container runs as `node`, which is uid 1000 in the official Node image (the Unraid
template in `deploy/unraid/` relies on this). A named volume works as is: the Dockerfile
creates `/data` owned by `node`. A bind mount (`-v /srv/coliseumgrid:/data`) keeps the host
folder's owner, so create it and give it to uid 1000 first, or the server can't write its
database:

```sh
mkdir -p /srv/coliseumgrid && chown 1000:1000 /srv/coliseumgrid
```

### Environment variables

From `packages/server/src/config.ts` and `main.ts`. A bad value stops the server at startup
with a message that never includes the value.

| Name | Default | What it does | Online |
|---|---|---|---|
| `COLISEUMGRID_MODE` | `offline` (the image sets `online`) | `offline` or `online`. | The image sets it |
| `COLISEUMGRID_HOST_PASSWORD` | none | The host password, 8 to 128 characters, spaces count. When set, first-run setup is off. Changing it ends every host session at the next start. | Required |
| `TRUSTED_PROXY` | none | The reverse proxy's IP address, as the app sees it. Only a request from it may name the client in `X-Forwarded-For` and say it came over HTTPS. | Set it; the server warns without it |
| `COLISEUMGRID_PUSH_SUBJECT` | none | A `mailto:` address or an `https:` URL, not `localhost`. Turns push on. | Optional; the server warns without it |
| `PORT` | `3000` (the image sets `3000`) | The port to listen on, 0 to 65535. | Optional |
| `HOST` | `0.0.0.0` | The address to listen on. | Optional |
| `DATA_DIR` | `data` (the image sets `/data`) | The folder for the database and graphics. Created if missing. | The image sets it |
| `CLIENT_DIST` | `packages/client/dist` (the image sets `/app/packages/client/dist`) | The built client to serve. | The image sets it |

## The reverse proxy and HTTPS

Online needs HTTPS because browsers give push, the screen wake lock, and Home Screen web apps
only to a secure context, and a plain `http` address that isn't `localhost` isn't one
([MDN, Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)).
On iPhone and iPad, push works only from a Home Screen web app, iOS 16.4 and later
([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). The
table is in `PLAN.md` section 3, "Player view". The app speaks plain HTTP, so the proxy ends
HTTPS and forwards to port 3000.

### What the app needs from the proxy

- **`TRUSTED_PROXY` and the last `X-Forwarded-For` entry.** The rate limits count wrong
  tries per client address. A caller can send its own `X-Forwarded-For`, and a proxy adds the
  address it saw to the end of the list, so the first entry is whatever the caller claimed.
  The app reads the header only when the connection comes straight from `TRUSTED_PROXY`, and
  uses only the last entry, the one your proxy wrote (`CLAUDE.md`, rule 6). A request from
  any other address is counted under its own address.
- **`TRUSTED_PROXY` is the address the app sees as the peer.** That is the proxy's address
  on the network between the two, not its public address. With the proxy in another
  container on a Docker network, it is that container's address on that network, which is why
  the Compose example fixes it. When the proxy runs on the host and reaches a published port,
  the app sees whatever address Docker's networking presents, and Docker's published-port
  documentation doesn't say which that is
  ([Docker](https://docs.docker.com/engine/network/port-publishing/)). The `172.18.0.1` in
  the `docker run` example is a typical bridge gateway address, not a promise: check it on
  your machine. If it is wrong, every player shares one rate limit, and the app counts every
  request as plain HTTP, so a phone is never offered push.
- **`Host` passes through unchanged.** A request that changes data is refused with 403 when
  its `Origin` host differs from `Host` (`PLAN.md`, section 3, "Origin").
- **`X-Forwarded-Proto: https`.** The app counts a request as HTTPS only from this header,
  sent by the trusted proxy. Cookies get `Secure`, and push turns on, only then.
- **WebSocket upgrade.** The live screens use `/api/live`, a WebSocket.
- **Request bodies of at least 2 MB.** The event picture can be 2 MB
  (`GRAPHIC_BYTES_MAX` in `packages/core/src/name-tags.ts`).

### Caddy

```
coliseum.example.com {
	reverse_proxy coliseumgrid:3000
}
```

Caddy gets the certificate for a public name itself. Checked against the
[`reverse_proxy` docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) on
2026-11-19:

- It proxies WebSocket connections with no extra setting.
- It sets or adds to `X-Forwarded-For` and sets `X-Forwarded-Proto`. It ignores those headers
  from incoming requests unless the sender is in `trusted_proxies`, so leave
  `trusted_proxies` unset unless another proxy sits in front of Caddy.
- It passes incoming headers, `Host` included, to the backend unchanged. It changes `Host`
  on its own only for an HTTPS upstream, so keep the upstream plain HTTP, as above, and don't
  add `header_up Host`.
- This page didn't check Caddy's default request body limit. Not verified.

### nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name coliseum.example.com;
    # ssl_certificate and ssl_certificate_key go here.

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

Checked against the nginx docs on 2026-11-19:

- `$proxy_add_x_forwarded_for` is the client's `X-Forwarded-For` header with `$remote_addr`
  appended after a comma, or `$remote_addr` alone when the client sent none
  ([ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)).
  That is the append the app's last-entry rule relies on.
- `proxy_set_header Host` defaults to `$proxy_host`, the upstream's name, so set it to `$host`
  to pass the browser's host through. `$scheme` is `http` or `https`
  ([ngx_http_core_module](https://nginx.org/en/docs/http/ngx_http_core_module.html)).
- `Upgrade` and `Connection` are hop-by-hop headers and aren't passed on, so a WebSocket
  needs them set explicitly. The `map` form is the docs' second example
  ([WebSocket proxying](https://nginx.org/en/docs/http/websocket.html)). Before nginx 1.29.7
  that page also shows `proxy_http_version 1.1;`, because 1.0 was the default then; add it on
  an older nginx.
- The proxied connection closes after 60 seconds with no data unless the server sends pings
  or `proxy_read_timeout` is raised (same page). Not verified: whether ColiseumGrid sends
  pings. If the live screens drop when idle, raise `proxy_read_timeout`.
- `client_max_body_size` defaults to `1m` and answers 413 above it
  ([ngx_http_core_module](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size)),
  so the picture upload fails without the `2m` line.
- With nginx on the host and the app on a published port, `TRUSTED_PROXY` is the address the
  app sees (see above). With nginx and the app both on the host and no container,
  it is `127.0.0.1`.

## Push

Push alerts on phones need online mode, HTTPS, and a contact for the push services.

- **`COLISEUMGRID_PUSH_SUBJECT`**: a `mailto:` address or an `https:` URL, never `localhost`
  ([RFC 8292, section 2.1](https://www.rfc-editor.org/rfc/rfc8292#section-2.1)).
- **The key file**: the server makes a VAPID key, `vapid-private-key.pem`, in the data
  folder the first time push needs it, with mode 0600, and never replaces it. A push service
  ties each phone's subscription to the key, so if you delete it, every phone has to
  subscribe again. Back it up.
- **Without the subject**: push is off and the server warns at startup. Phones still get the
  page alert while the page is open.
- **Offline**: push doesn't run, whatever the setting.

Details are in `DEVELOPMENT.md`, "Phones and push".

## Online mode differences

- **No `localhost` sign-in and no first-run setup.** Behind a proxy every request can look
  local, so the host password is always required, and the server stops at startup without
  `COLISEUMGRID_HOST_PASSWORD` (`PLAN.md`, section 3, "Host sign-in").
- **Rate limits per client address**, in 10-minute windows: 10 wrong host passwords, 10 wrong
  pairing codes (and 100 across all callers), and for PINs 5 wrong per handle and 60 wrong
  per address (`packages/server/src/rate-limit.ts`). An IPv6 client counts by its /64. The
  address comes from the rule above.
- **A host session lasts 12 hours** (`PLAN.md`, section 3).

## Updating and backups

**What is in the data folder:**

- `coliseumgrid.db`, the database: events, players, results, and the host password hash. It
  runs in WAL mode, so `coliseumgrid.db-wal` and `coliseumgrid.db-shm` may sit beside it
  while the server runs ([SQLite WAL](https://sqlite.org/wal.html)).
- `graphics/`, the uploaded event pictures.
- `vapid-private-key.pem`, once push has been used.

**Backup:** stop the container, copy the whole folder, and start it again. Copying the files
of a running WAL database can miss the `-wal` file.

**Update:**

```sh
docker pull ghcr.io/bradbrownjr/coliseumgrid:edge
docker stop coliseumgrid && docker rm coliseumgrid
# run the same docker run command again
```

With Compose: `docker compose pull && docker compose up -d`. The data is in the volume, so it
carries over. The server upgrades the database schema at startup and refuses to start on a
database newer than itself, so back up before updating, and restore that backup before going
back to an older image.
