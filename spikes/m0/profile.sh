# Perfil de Chrome (FIGMA_CHROME_PROFILE) para chrome.sh y login.sh: se carga con `source`, no se ejecuta.
# El valor por defecto refleja server/src/adapters/config/schema.ts.
CHROME_PROFILE_DEFAULT="$HOME/.cache/figma-control-center-chrome"

# Raíz del repo: contra ella se resuelve un FIGMA_CHROME_PROFILE relativo, como hace el esquema (schema.ts)
PROFILE_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Escribe la ruta del perfil a usar: FIGMA_CHROME_PROFILE si está fijada y, si no, el perfil por defecto.
resolve_chrome_profile() {
  if [[ -n "${FIGMA_CHROME_PROFILE:-}" ]]; then
    local profile="${FIGMA_CHROME_PROFILE/#\~/$HOME}"
    [[ "$profile" == /* ]] || profile="$PROFILE_REPO_ROOT/$profile"
    profile="$(realpath -m -- "$profile")"
    # El perfil guarda la sesión de Figma (cookies sin cifrar, ver --password-store=basic) y git no lo ignora
    if [[ "$profile" == "$PROFILE_REPO_ROOT" || "$profile" == "$PROFILE_REPO_ROOT"/* ]]; then
      echo "FIGMA_CHROME_PROFILE ($profile) cae dentro del repo: guarda la sesión de Figma y git no lo ignora. Ponlo fuera, p. ej. ~/.cache/figma-control-center-chrome." >&2
      return 1
    fi
    echo "$profile"
  else
    echo "$CHROME_PROFILE_DEFAULT"
  fi
}
