#!/usr/bin/env bash
# Inicio de sesión en Figma, una vez por perfil: abre un Chrome NORMAL (con ventana, sin puerto de depuración ni
# banderas de automatización) sobre el perfil de FIGMA_CHROME_PROFILE. Google no deja iniciar sesión en un Chrome
# automatizado (sin ventana o con puerto de depuración), así que el primer inicio lo hace una persona aquí.
# Uso: spikes/m0/login.sh   (o make login; el .env es opcional y solo sobrescribe los valores por defecto)
# Ojo: --password-store=basic guarda las cookies del perfil SIN cifrar (no usa el llavero del sistema): quien lea la
# carpeta del perfil tiene tu sesión de Figma. Por eso el perfil va fuera del repo (profile.sh lo rechaza dentro).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/spikes/m0/env.sh"

# Valores por defecto (reflejan server/src/adapters/config/schema.ts): el .env, si existe, solo sobrescribe
FIGMA_CDP_PORT="$(env_get FIGMA_CDP_PORT 9222)"
FIGMA_CHROME_PROFILE="$(env_get FIGMA_CHROME_PROFILE "")"
source "$ROOT/spikes/m0/profile.sh"
PROFILE="$(resolve_chrome_profile)"
LOGIN_URL="https://www.figma.com/login"
CMD=(google-chrome --password-store=basic --user-data-dir="$PROFILE" --no-first-run "$LOGIN_URL")

# Modo de prueba: imprime los argumentos (uno por línea) sin parar ni lanzar Chrome
if [[ -n "${FCC_CHROME_DRY_RUN:-}" ]]; then printf '%s\n' "${CMD[@]}"; exit 0; fi
STOP_WAIT_SECONDS=10

# Dos Chrome sobre el mismo perfil pueden corromperlo: primero se para el de depuración (lo mismo que make chrome-stop)
if pkill -f "[r]emote-debugging-port=$FIGMA_CDP_PORT"; then
  echo "Chrome de depuración parado"
  for _ in $(seq 1 "$STOP_WAIT_SECONDS"); do
    pgrep -f "[r]emote-debugging-port=$FIGMA_CDP_PORT" >/dev/null || break
    sleep 1
  done
fi
mkdir -p "$PROFILE"
rm -f "$PROFILE"/Singleton*

cat <<EOF
Se abre una ventana de Chrome con el perfil $PROFILE:
  1. Inicia sesión en Figma.
  2. Abre un archivo de tu proyecto para comprobar que puedes editarlo.
  3. Cierra la ventana.
Después ejecuta: make chrome
EOF

# En primer plano: el script termina cuando se cierra la ventana
"${CMD[@]}" >/dev/null 2>&1 || true
echo "Ventana cerrada. Ahora: make chrome"
