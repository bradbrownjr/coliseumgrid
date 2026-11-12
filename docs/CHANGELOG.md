# Changelog

Finished work, newest first. When a roadmap item is done, it leaves the
[roadmap](ROADMAP.md) and is recorded here.

Until the first event, entries list finished work under **Milestones**. After it, entries
use **New Features**, **Improvements**, and **Bug Fixes**, in that order.

---

# November 12, 2026

## Milestones

* **M1 Workspace and checks.** The pnpm workspace with `core`, `server`, and `client`.
  `pnpm check` runs Oxlint, the type checks, Vitest, the docs check, and the palette check,
  and CI runs it with `pnpm build` and `pnpm audit` at high. The server answers
  `/api/health` and serves the client. The client has the red and black MUI theme in light
  and dark, the arena bracket logo, and placeholder Host, Sign-up, and Display pages. The
  Docker image is smoke-tested in CI and published to `ghcr.io/bradbrownjr/coliseumgrid:edge`.
  lean-qr replaces `qrcode` for QR codes. The audit step was not shown failing on a real
  advisory; Brad chose not to add a vulnerable package to prove it.
* **Colors and logo.** A red and black palette for light and dark, checked for contrast
  under normal vision and simulated protanopia and deuteranopia, and a logo redrawn as SVG
  from an AI-generated concept.
* **Plan and working rules.** The design (`PLAN.md`), UI rules (`DESIGN.md`), build order
  (`ROADMAP.md`), writing rules (`DOC-STYLE.md`), hardware tests (`PLAYTEST.md`), and the
  agent instructions (`CLAUDE.md`), drawn from ECTLogger, MEPN, and Pattern Break. CI runs
  the docs check.
