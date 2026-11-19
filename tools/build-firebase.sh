#!/usr/bin/env bash
# Regenera js/vendor/firebase.js (SDK de Firebase empaquetado en un solo archivo).
# Solo hace falta para actualizar Firebase o exportar más funciones.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
cp firebase-entry.js "$tmp/entry.js"
(cd "$tmp" && npm init -y >/dev/null && npm i firebase@11 esbuild >/dev/null)
"$tmp/node_modules/.bin/esbuild" "$tmp/entry.js" --bundle --format=esm --minify \
  --target=es2020 --legal-comments=none --outfile=../js/vendor/firebase.js
rm -rf "$tmp"
echo "Listo: js/vendor/firebase.js"
