# Lector de .env para los scripts (se carga con `source`): lee UNA clave sin ejecutar nada y con el formato de
# process.loadEnvFile de Node (comentarios #, comillas opcionales, espacios, & y =). Sin .env o sin la clave, el default.
# Manda la variable de entorno si existe, como en el servidor. Los defaults de los scripts reflejan schema.ts.
ENV_SH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# env_get NOMBRE DEFAULT
env_get() {
  local name="$1" default="${2:-}" file="$ENV_SH_ROOT/.env" line key rest q found=""
  if [[ -n "${!name:-}" ]]; then printf '%s\n' "${!name}"; return 0; fi
  if [[ -f "$file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      line="${line#"${line%%[![:space:]]*}"}"
      [[ -z "$line" || "$line" == \#* ]] && continue
      line="${line#export[[:space:]]}"
      line="${line#"${line%%[![:space:]]*}"}"
      [[ "$line" == *=* ]] || continue
      key="${line%%=*}"
      key="${key%"${key##*[![:space:]]}"}"
      [[ "$key" == "$name" ]] || continue
      rest="${line#*=}"
      rest="${rest#"${rest%%[![:space:]]*}"}"
      q="${rest:0:1}"
      if [[ "$q" == '"' || "$q" == "'" || "$q" == '`' ]] && [[ "${rest:1}" == *"$q"* ]]; then
        rest="${rest:1}"
        rest="${rest%%"$q"*}"
      else
        [[ "$rest" == \#* ]] && rest=""
        rest="${rest%%[[:space:]]#*}"
        rest="${rest%"${rest##*[![:space:]]}"}"
      fi
      found="$rest"
    done < "$file"
  fi
  printf '%s\n' "${found:-$default}"
}
