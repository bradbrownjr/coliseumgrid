#!/bin/sh
# Starts ColiseumGrid with the Node runtime in this folder (docs/PLAN.md, section 8).
# readlink -f finds the real folder when this script is started through a link.
here=$(dirname "$(readlink -f "$0")")
exec "$here/node/node" "$here/app/packages/server/src/launcher.ts" "$@"
