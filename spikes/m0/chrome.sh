#!/usr/bin/env bash
# Sonda M0: Chrome sin ventana con puerto de depuración y la sesión de Figma ya iniciada.
# Uso: spikes/m0/chrome.sh   (sin .env funciona con los valores por defecto; el .env solo los sobrescribe)
#   - Si el perfil propio no existe, se siembra copiando FIGMA_CHROME_SEED_PROFILE (opcional) o se crea vacío;
#     la sesión de Figma se inicia una vez con `make login` (ventana normal: Google no deja entrar en un Chrome automatizado).
#   - User-agent de Chrome normal: con «HeadlessChrome» CloudFront de Figma responde 403.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/spikes/m0/env.sh"

# La URL de Figma la da cada proyecto desde la interfaz: Chrome arranca en about:blank
# Valores por defecto (reflejan server/src/adapters/config/schema.ts): el .env, si existe, solo sobrescribe
FIGMA_CDP_HOST="$(env_get FIGMA_CDP_HOST 127.0.0.1)"
FIGMA_CDP_PORT="$(env_get FIGMA_CDP_PORT 9222)"
FIGMA_CHROME_PROFILE="$(env_get FIGMA_CHROME_PROFILE "")"
source "$ROOT/spikes/m0/profile.sh"
PROFILE="$(resolve_chrome_profile)"
SEED="$(env_get FIGMA_CHROME_SEED_PROFILE "")"
SEED="${SEED/#\~/$HOME}"
ENDPOINT="http://${FIGMA_CDP_HOST}:${FIGMA_CDP_PORT}/json/version"

if [[ ! -d "$PROFILE" ]]; then
  if [[ -n "$SEED" && -d "$SEED" ]]; then
    cp -r "$SEED" "$PROFILE"
  else
    mkdir -p "$PROFILE"
    echo "Perfil nuevo en $PROFILE: aún no hay sesión de Figma. Ejecuta make login y luego make chrome." >&2
  fi
fi
rm -f "$PROFILE"/Singleton*

# --password-store=basic: sin él Chrome cifra/lee las cookies con gnome-keyring, pero el perfil semilla
# (chrome-devtools-mcp, Puppeteer) las escribe con «basic»; sin coincidir, la sesión no se lee (notLoggedIn).
# Contrapartida: las cookies del perfil quedan sin cifrar (ver docs/users/installation.md)
if [[ -n "${FCC_CHROME_DRY_RUN:-}" ]]; then VERSION=0
else VERSION="$(google-chrome --version | grep -oE '[0-9]+(\.[0-9]+)+' | head -1)"; fi
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${VERSION} Safari/537.36"
CMD=(google-chrome --headless=new --password-store=basic --user-agent="$UA" --remote-debugging-port="$FIGMA_CDP_PORT"
  --user-data-dir="$PROFILE" --no-first-run about:blank)

# Modo de prueba: imprime los argumentos (uno por línea) en vez de lanzar Chrome
if [[ -n "${FCC_CHROME_DRY_RUN:-}" ]]; then printf '%s\n' "${CMD[@]}"; exit 0; fi

# Quién escucha en el puerto: el pid y su orden (argumentos separados por espacios), o nada si no se puede ver
port_pid() { ss -H -ltnp "sport = :$FIGMA_CDP_PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2; }
cmdline_of() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true; }
# ¿Esa orden es la de NUESTRO Chrome: este puerto y este perfil? Chrome reescribe su título y /proc/<pid>/cmdline
# llega como una sola cadena con espacios (no con NUL entre argumentos): se busca cada argumento entre espacios.
is_ours() {
  local cmd=" $(cmdline_of "$1")"
  [[ "$cmd" == *" --remote-debugging-port=$FIGMA_CDP_PORT "* && "$cmd" == *" --user-data-dir=$PROFILE "* ]]
}
not_ours() {
  local pid
  pid="$(port_pid)"
  echo "El puerto ${FIGMA_CDP_PORT} lo tiene otro proceso que no es el Chrome de este proyecto (perfil $PROFILE)." >&2
  if [[ -n "$pid" ]]; then
    echo "  pid $pid: $(cmdline_of "$pid")" >&2
    echo "  Páralo (kill $pid) o fija otro FIGMA_CDP_PORT; no se lanza otro Chrome encima." >&2
  else
    echo "  No se pudo ver su pid (ss no lo da): míralo con «ss -ltnp 'sport = :${FIGMA_CDP_PORT}'»." >&2
  fi
  exit 1
}

# Si el puerto ya contesta, solo vale si es el nuestro (lo mismo que hablar con otro Chrome sin la sesión ni el perfil)
if curl -s "$ENDPOINT" >/dev/null; then
  pid="$(port_pid)"
  if [[ -n "$pid" ]] && is_ours "$pid"; then echo "Chrome ya estaba en marcha en ${FIGMA_CDP_PORT} (pid $pid)"; exit 0; fi
  not_ours
fi

setsid "${CMD[@]}" >/dev/null 2>&1 &

for _ in $(seq 1 20); do
  if curl -s "$ENDPOINT" >/dev/null; then
    pid="$(port_pid)"
    if [[ -n "$pid" ]] && is_ours "$pid"; then echo "Chrome listo en ${FIGMA_CDP_PORT}"; exit 0; fi
    not_ours
  fi
  sleep 1
done
echo "Chrome no respondió en ${ENDPOINT}" >&2; exit 1
