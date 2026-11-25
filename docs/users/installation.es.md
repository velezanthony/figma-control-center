---
seo:
  title: "Instala un servidor MCP para Figma"
  description: "Instala Figma Control Center: requisitos, el Chrome de depuración con tu sesión de Figma, el alta de un archivo como proyecto y la comprobación final."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Instalación

Figma Control Center corre en tu máquina: un servidor MCP que Claude Code arranca por stdio y un
Chrome con puerto de depuración que guarda tu sesión de Figma. No hay nada alojado fuera.

## Requisitos

| Qué | Versión | Notas |
|---|---|---|
| Node | **24** o posterior (`engines` de `package.json`) | Ejecuta los `.ts` directamente, sin compilar |
| npm | el que trae Node 24 | |
| Google Chrome | estable, `google-chrome` en el `PATH` | Los scripts de ayuda de `spikes/m0/` usan `setsid`, `pkill` y `ss`: están pensados para **Linux**. En otro sistema, adáptalos |
| Claude Code | una versión reciente | El chat del panel usa los *channels* de Claude Code, una research preview |
| Cuenta de Figma | con permiso de **edición** sobre el archivo | Figma solo expone el API de plugins a quien puede editar |
| Una terminal gráfica | la de `FCC_AGENT_TERMINAL` | Solo para el botón **Lanzar agente** del panel |

## Instalar

```bash
make install       # npm ci
```

> [!NOTE]
> `better-sqlite3` trae binarios precompilados, así que no hace falta compilador. npm le atribuye un
> script de instalación implícito (`node-gyp rebuild`); **no se aprueba** (`allowScripts` está en
> `false`) y no hace falta: el paquete carga `prebuilds/<plataforma>.node`.

## Fichero de configuración (opcional)

Todo tiene un valor por defecto: el proyecto arranca **sin `.env`**. Un `.env` solo sobrescribe lo
que quieras cambiar, y los scripts de shell lo leen sin ejecutarlo.

```bash
make env           # copia la plantilla a .env si no existe
```

Cada variable, y cuáles puedes cambiar desde el panel en vez de ahí, está en
[Configuración](configuration.es.md). El `.env` nunca se versiona.

## Chrome con tu sesión de Figma

Dos órdenes, una vez cada una:

```bash
make login         # una vez: Chrome con ventana sobre el perfil de depuración, para iniciar sesión en Figma
make chrome        # Chrome sin ventana con el puerto de depuración y esa sesión
```

- **`make login`** (`spikes/m0/login.sh`) para el Chrome de depuración si está en marcha —dos Chrome
  sobre un mismo perfil pueden corromperlo— y abre un Chrome **normal** sobre `FIGMA_CHROME_PROFILE`
  en la página de inicio de sesión de Figma. Entra, abre tu archivo para comprobar que puedes
  **editarlo** y cierra la ventana. El primer inicio de sesión tiene que ser así porque Google no deja
  iniciar sesión en un navegador automatizado.
- **`make chrome`** (`spikes/m0/chrome.sh`) arranca Chrome **sin ventana** con el puerto de depuración
  y ese perfil, en `about:blank`. Las pestañas de Figma las abre el servidor cuando un proyecto las
  necesita. Si el perfil no existe, lo siembra desde `FIGMA_CHROME_SEED_PROFILE` (opcional) o lo crea
  vacío y te recuerda que ejecutes `make login`.
- **`make chrome-stop`** lo para.

:::warning[El perfil guarda tu sesión de Figma sin cifrar]
Los dos scripts lanzan Chrome con `--password-store=basic`, que guarda las cookies del perfil en
el propio perfil y no en el llavero del sistema. Quien pueda leer esa carpeta tiene tu sesión de
Figma. Déjala legible solo para tu usuario y fuera de copias de seguridad compartidas.
:::

- **Dónde va el perfil.** Por defecto, `~/.cache/figma-control-center-chrome`. Un
  `FIGMA_CHROME_PROFILE` relativo se resuelve contra la raíz del repositorio, y uno que cae **dentro**
  del repositorio se rechaza al arrancar: git no lo ignora y acabaría en un commit.
- **La sesión caduca.** Cuando `figma_status` diga que no hay sesión, repite `make login` y
  `make chrome`.

:::question[Puerto ocupado]{collapsed}
`make chrome` comprueba de quién es `FIGMA_CDP_PORT`. Si ya es *nuestro* Chrome
(mismo puerto, mismo perfil), lo dice y sale bien. Si lo tiene otro proceso —otro Chrome, uno con
otro perfil, uno que dejó un test—, falla con su pid y su orden y no lanza nada encima: un servidor
hablando con un Chrome sin la sesión esperada es peor que uno que no arranca. Míralo con
`ss -ltnp 'sport = :9222'` y `pgrep -af remote-debugging-port`, y páralo tú o fija otro
`FIGMA_CDP_PORT`.
:::

## Da de alta tu archivo de Figma

Los archivos no se configuran en el `.env`: cada uno es un **proyecto** y se da de alta en el panel.

```bash
make dashboard     # compila la web y la sirve en http://127.0.0.1:4173
```

Abre **Proyectos** (`#/projects`) y añade uno:

| Campo | Qué es |
|---|---|
| Nombre | Texto libre, p. ej. `ejemplo` |
| Directorio del proyecto | La carpeta del proyecto que diseñas (donde vive `figma-control-center.json`, si capturas su web) |
| Archivo de Figma | La URL del archivo, `https://www.figma.com/design/<clave>/<nombre>`, sin `?…` ni `#…` |
| Raíz de scripts | Opcional, una por línea: carpetas de las que las herramientas pueden leer scripts |
| Carpeta de salida | Opcional: dónde van las capturas de pantalla, las lecturas y las capturas de la web (`output/<id>` por defecto) |

La base le da al proyecto un número (`1`, `2`, …): ese número es al que se refieren `FCC_PROJECTS`
y `make agent PROJECT=<n>`. Un proyecto dado de alta con Claude Code abierto se usa sin reiniciar.

## Comprueba que funciona

En Claude Code (ver [Usarlo desde Claude Code](claude-code.es.md)), llama a `figma_status`. Tiene que
decir que Chrome responde, que la pestaña está, que `figma` está listo, y el nombre del archivo y de la
página. Si la pestaña del proyecto no está abierta, el servidor la abre la primera vez que una
herramienta la necesita y lo dice en `tabOpened`; nunca cierra pestañas que no abrió.

`figma_status` explica cada fallo con un `nextStep`. Los habituales:

| Motivo | Qué significa |
|---|---|
| `notLoggedIn` | No hay sesión de Figma en el perfil de depuración: `make login` y después `make chrome` |
| `viewOnly` | Tu cuenta solo puede ver el archivo: pide permiso de edición, o duplica el archivo y da de alta la copia |
| `loading` | El editor no terminó de cargar dentro de `FIGMA_READY_TIMEOUT_MS` |

> [!NOTE]
> `make probe` es una comprobación del transporte a más bajo nivel (lectura, escritura reversible y un
> script de varios megas), de `spikes/m0/cdp-probe.ts`. Trabaja sobre un único archivo, el que le pases
> en `FIGMA_FILE_URL` en el entorno de esa orden, con su pestaña ya abierta.
