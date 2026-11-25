---
seo:
  title: "Usa el MCP de Figma en Claude Code"
  description: "Registra el servidor MCP de Figma Control Center en Claude Code, instala las skills del plugin y usa el arnés restringido del agente con el chat del panel."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Usarlo desde Claude Code

## En este repositorio

El servidor ya está declarado en el `.mcp.json` de la raíz del repositorio (alcance de proyecto,
nombre `figma-control-center`, orden `node server/src/main.ts`). No hay nada que registrar:

1. Abre `claude` en la carpeta del repositorio y aprueba el servidor `figma-control-center` cuando lo
   pida.
2. `/mcp` debe mostrarlo conectado, con las herramientas `figma_*`, las `figma_history_*` y
   `figma_chat_reply`. Desde una terminal, `make mcp` enseña cómo lo ve Claude Code.

## Desde otro proyecto

Para manejar Figma mientras trabajas en el proyecto que diseñas, registra allí el mismo servidor. La
orden necesita una ruta **absoluta** a `server/src/main.ts`, porque el `${CLAUDE_PROJECT_DIR}` del
`.mcp.json` de este repositorio apuntaría al otro proyecto:

::::tabs
:::tab[claude mcp add]
```bash
claude mcp add figma-control-center -e FCC_PROJECTS=1 -- node /ruta/a/figma-control-center/server/src/main.ts
```
:::
:::tab[.mcp.json]
En el `.mcp.json` de ese proyecto:

```json
{
  "mcpServers": {
    "figma-control-center": {
      "type": "stdio",
      "command": "node",
      "args": ["/ruta/a/figma-control-center/server/src/main.ts"],
      "env": { "FCC_PROJECTS": "1" }
    }
  }
}
```
:::
::::

> [!NOTE]
> Las rutas relativas de la configuración se siguen resolviendo contra el repositorio de
> figma-control-center, no contra la carpeta en la que corre Claude Code, así que se usan el mismo
> `.env`, la misma base y las mismas carpetas de salida.

### El proyecto que atiende el servidor

`FCC_PROJECTS` es el alcance de acceso del servidor: `any`, o números de proyecto separados por
comas. Sin definir, todos los proyectos dados de alta están en alcance. Definida pero sin ningún
número válido, ninguno lo está.

| Proyectos en alcance | Qué hacen las herramientas |
|---|---|
| ninguno dado de alta | Cada herramienta responde un error de uso que dice que des de alta uno en el panel, con su URL |
| exactamente uno | Se usa ese |
| varios | Cada herramienta responde un error de uso que los lista (`<número> («<nombre>»)`) y pide que elijas uno con `FCC_PROJECTS` |

El proyecto se resuelve en cada llamada, no al arrancar: uno dado de alta después se usa sin
reiniciar Claude Code.

## Skills del agente: el plugin

El servidor da al agente las herramientas; el **plugin `figma-control-center`** le da el manual para
usarlas. Instálalo en Claude Code, desde cualquier carpeta:

```text
/plugin marketplace add velezanthony/figma-control-center
/plugin install figma-control-center@figma-control-center
```

Añade dos skills, que Claude Code carga cuando la tarea las pide:

| Skill | Qué le da al agente |
|---|---|
| `figma-control-center` | El flujo de la web a Figma (capturar, construir pantallas y hojas de componentes, pasarlas a sus áreas, reponer enlaces y mapas), de Figma a código con `figma_design_context`, el diseño con `compose@1`, cómo se traduce el código a Figma y las trampas del API de plugins que resuelve el kit |
| `design-craft` | Criterio de diseño para tus componentes: props frente a slots, tokens, estados y accesibilidad, fichas de componente y revisión de diseño |

> [!IMPORTANT]
> El plugin solo trae instrucciones: el servidor se sigue registrando como se explica arriba. Las
> skills apuntan a esta documentación y a los JSON Schema de `schemas/`, así que funcionan desde tu
> propio proyecto. Un agente arrancado con `make agent` no los necesita: solo consulta.

## El arnés del agente: `make agent PROJECT=<n>`

```bash
make agent PROJECT=1
```

arranca Claude Code atado a **un** proyecto y conectado al chat del panel. Sin `PROJECT` se niega: un
agente nunca ve todos los proyectos.

Hay dos papeles. Tu propio `claude`, abierto en tu proyecto con el servidor conectado, hace el
trabajo: capturar, pintar, construir. El agente del chat del panel solo responde preguntas sobre el
estado y la actividad del proyecto.

El lanzamiento escribe su propio `settings.json` y su `mcp.json` en una carpeta temporal
(`<tmp>/figma-agent-<id>/`, que se borra al salir), ejecuta `claude --restricted` con ellos e instala
un guardián `PreToolUse` (`server/src/agent-guard.ts`). Nunca toca `~/.claude/`, una carpeta
`.claude/` ni el `.mcp.json` de nadie.

**Qué puede hacer el agente**

- Responder preguntas sobre el estado, la actividad y el histórico del proyecto con todas las
  herramientas de lectura de `figma-control-center` y las `figma_history_*`, sin preguntar.
- `Read`, `Glob` y `Grep` dentro de las raíces del proyecto (directorio del proyecto, raíces de
  scripts, carpeta de salida), para mirar scripts, resultados y lecturas guardadas.

**Qué no puede hacer**

- Cambiar nada: no tiene `Write` ni `Edit`, y `figma_run_script`, `figma_build`, `figma_cancel_job` y
  `figma_capture` los rechazan sus ajustes, su guardián y el propio servidor. Si le piden un cambio,
  responde que los cambios se hacen desde Claude Code en tu proyecto.
- Bash (tampoco git), WebFetch, WebSearch, otros servidores MCP, plugins ni conectores de claude.ai.
- Leer fuera de las raíces del proyecto: el repositorio de la propia herramienta, otros proyectos, la
  base, los tokens del chat, tu home.
- Leer secretos (`.env`, claves, `~/.ssh`, el fichero de secretos de la captura…).
- Pasar al modo sin permisos.
- Cargar tu `~/.claude/settings.json`, tu `CLAUDE.md` global ni la memoria automática.

El arnés es fijo: no hay ajuste para abrir la escritura, Bash o la red. Una tarea que los necesite es
para tu `claude` normal.

:::info[Requisitos del proyecto para lanzarlo]
Sus raíces (directorio del proyecto, raíces de scripts,
carpeta de salida) tienen que existir, no ser `/` ni tu home ni contenerlo, no estar dentro del
repositorio de Figma Control Center ni contenerlo, y no solaparse con las de otro proyecto. En
concreto, un proyecto sin raíz de scripts propia, o con la carpeta de salida por defecto (dentro del
repositorio), no se lanza: dale las suyas en **Proyectos**. El error dice qué raíz y por qué.
:::

## El chat del panel

Lo que escribes en la página **Chat** del panel llega a la sesión del agente como un mensaje
`<channel>`, y Claude contesta con `figma_chat_reply`, en directo en el panel. Sin clave de API ni
modelo propio: es tu sesión de Claude Code.

- **Lanzar agente** (en Chat y en Inicio, cuando ninguna sesión escucha) escribe la configuración del
  arnés del proyecto que estás viendo y abre la terminal de `FCC_AGENT_TERMINAL` con
  `make agent PROJECT=<n> AGENT_DIR=<carpeta>`. Acepta los avisos del canal en esa terminal; hasta que
  lo hagas, el chat dice que ninguna sesión está escuchando. El navegador nunca envía la orden: la
  arma el panel, solo para un origen local, y nunca lanza dos a la vez.
- **Cerrar agente** le pide al lanzador que pare el agente del proyecto que estás viendo (si hay un
  lote en curso, pregunta antes: el lote quedaría cortado). El panel nunca manda señales a procesos.
- Al cerrar el panel, el agente lanzado desde él también se cierra: su lanzador mantiene una conexión
  con el panel y, si el panel no vuelve dentro de `FCC_AGENT_PANEL_GRACE_MS`, para a `claude` y
  borra su carpeta. Un reinicio rápido del panel no lo cierra. Un agente arrancado a mano con
  `make agent` no vigila ningún panel.
- **Permisos desde el panel.** Si la sesión pide permiso para una herramienta, la petición sale en
  el chat (herramienta, descripción y entrada, como texto) con **Aprobar** y **Denegar**. La respuesta
  vuelve a Claude Code firmada con el token de la sesión. La terminal sigue funcionando; gana la
  primera respuesta.

:::warning[El chat es una vía de inyección]
Un mensaje sin la firma de la sesión nunca produce notificación, y el token nunca llega al
navegador. Lo que trae una petición de permiso se enseña como texto no fiable.
:::

> [!NOTE]
> Los canales son una research preview de Claude Code: si tu organización los desactiva
> (`channelsEnabled`), no llega nada a la sesión. `spikes/channel/README.md` explica cómo comprobar la
> cadena a mano.

## Prompts

El servidor publica prompts MCP que piden un resumen del histórico siguiendo «primero el agregado,
después el detalle por id». En Claude Code salen como `/mcp__figma-control-center__<nombre>`:

| Prompt | Argumentos | Pide |
|---|---|---|
| `last-hour` | — | Qué se hizo en la última hora: llamadas, errores, nodos tocados |
| `errors-today` | — | Los errores de hoy agrupados por tipo, con su siguiente paso y una llamada de ejemplo |
| `nodes-today` | — | Los nodos tocados hoy, cuántas veces y por qué llamada |
| `session` | `id` | Qué hizo una sesión del servidor |
| `attempts` | `target` | Los intentos de un script, una pantalla o un paso del kit, y qué papeles cambiaron |
| `attempt-changes` | `target`, `a`, `b` | Qué cambió entre dos intentos del mismo objetivo |
| `costly-screens` | — | Los objetivos que más intentos costaron la última semana |

Las herramientas a las que llaman están en [Herramientas](tools.es.md#historial).
