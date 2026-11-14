<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/logo-dark.svg">
    <img src="assets/logo/logo.svg" alt="ColiseumGrid logo" width="160">
  </picture>
</p>

# ColiseumGrid

A self-hosted tournament app for in-person video game events. Players sign up with a gamer
handle on a tablet, the host runs brackets and race heats from a laptop, and a TV shows the
standings and who plays next. It runs offline from a laptop, or online from a Docker image.

## Status

In development, aiming at a first event on July 10, 2027. Finished so far:

- Players sign up with a handle and a 4-digit PIN on a tablet, and vulgar handles are refused.
- The host signs in with a password and pairs a TV or a sign-up tablet with a 6-character
  code or a QR code.
- 1 vs 1 brackets (one life, two lives, or everyone plays everyone) and groups of up to 4 for
  races and free-for-alls, on 1 to 8 stations, with undo and late sign-up.
- The TV shows the stations, who plays next, and the standings.

In progress: a page on players' phones that shows their next match and alerts them when
they're called. What is finished is in [`docs/CHANGELOG.md`](docs/CHANGELOG.md), and what
comes next is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Docs

| File | What it holds |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | The design and the tech choices |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The UI rules |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What comes next, in order |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | What is finished |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Setup, commands, conventions, and process |
| [`docs/PLAYTEST.md`](docs/PLAYTEST.md) | Tests run by hand on real hardware |
| [`docs/DOC-STYLE.md`](docs/DOC-STYLE.md) | The writing rules |
| [`CLAUDE.md`](CLAUDE.md) | Working rules for coding agents |

## License

[MIT](LICENSE).
