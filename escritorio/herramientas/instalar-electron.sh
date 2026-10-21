#!/usr/bin/env bash
# Instala el binario de Electron para Linux (pruebas) verificando su firma
# SHA-256 contra la lista oficial. Hace falta porque la descarga automática
# de `npm install` falla detrás del proxy de este entorno.
# Uso: bash herramientas/instalar-electron.sh   (desde escritorio/)
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./node_modules/electron/package.json').version")
ZIP="electron-v${VER}-linux-x64.zip"
TMP=$(mktemp -d)
URL="https://github.com/electron/electron/releases/download/v${VER}"
curl -sSL --fail -o "$TMP/$ZIP" "$URL/$ZIP"
curl -sSL --fail -o "$TMP/SHASUMS256.txt" "$URL/SHASUMS256.txt"
ESPERADO=$(grep " \*${ZIP}\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)
OBTENIDO=$(sha256sum "$TMP/$ZIP" | cut -d' ' -f1)
if [ -z "$ESPERADO" ] || [ "$ESPERADO" != "$OBTENIDO" ]; then
  echo "La firma del archivo no coincide; no se instala." >&2; exit 1
fi
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
(cd node_modules/electron/dist && unzip -q "$TMP/$ZIP")
printf electron > node_modules/electron/path.txt
rm -rf "$TMP"
echo "Electron $VER instalado."
