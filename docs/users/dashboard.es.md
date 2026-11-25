---
seo:
  title: "Panel local de llamadas MCP a Figma"
  description: "Usa el panel local del servidor MCP de Figma para ver en directo llamadas, jobs y capturas, revisar intentos y diffs, editar ajustes y chatear con el agente."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# El panel

Una página web local que enseña, en directo, qué hace el servidor: cada herramienta llamada, cuánto
tardó, los errores con su siguiente paso, los jobs largos, los nodos tocados (con enlace a Figma) y las
capturas. También es donde se dan de alta los proyectos, se editan los ajustes y vive el chat del
agente.

```bash
make dashboard     # compila web/ y la sirve en http://127.0.0.1:4173 (FCC_DASHBOARD_PORT)
```

Es un proceso aparte del servidor MCP. Lee la misma base SQLite (modo WAL), así que sobrevive a los
reinicios de Claude Code, conserva el histórico y distingue varias sesiones a la vez. Al arrancar borra
el histórico anterior a `FCC_HISTORY_RETENTION_DAYS`.

:::warning[Solo local]
El panel no tiene autenticación. Solo escucha en la propia máquina (`127.0.0.1`, `localhost` o
`::1`); cualquier otro `FCC_DASHBOARD_HOST` se rechaza al arrancar. No lo pongas detrás de un
proxy.
:::

## Páginas

La vista —búsqueda, filtros, orden, página, fila abierta— vive en el hash de la URL, así que recargar la
conserva y un enlace la comparte. El proyecto elegido viaja como `?project=<número>`.

| Página | Ruta | Qué enseña |
|---|---|---|
| Inicio | `#/` | El estado del día: panel, Chrome, Figma y el agente en píldoras de estado, con el siguiente paso solo de lo que no está listo; las últimas llamadas y errores; accesos a cada sección |
| Actividad | `#/activity` | Cada llamada: indicadores, filtros, búsqueda de texto, una tabla ordenable con filas desplegables y paginación; todo lo calcula la base |
| Jobs | `#/jobs` | Scripts largos y lotes con su progreso y sus pasos |
| Capturas | `#/captures` | Las capturas de `figma_screenshot` y de `figma_design_context` (las capturas de la web y las exportaciones no salen) |
| Intentos | `#/attempts` | El historial de intentos, ver abajo |
| Chat | `#/chat` | Preguntas sobre el estado y la actividad del proyecto a un agente arrancado con `make agent` (solo consulta: el trabajo se hace desde Claude Code en tu proyecto), las peticiones de permiso, **Lanzar agente** / **Cerrar agente** |
| Proyectos | `#/projects` | Dar de alta, editar y quitar proyectos |
| Ajustes | `#/settings` | Los ajustes editables, con su origen y para restablecerlos |
| Componentes | `#/components` | La galería de los componentes de la propia interfaz del panel. Solo con `FCC_DASHBOARD_MODE=development` ([configuración](configuration.es.md#panel-y-agente)) |
| Ayuda | `#/help` | Abajo en la barra lateral. **Cómo funciona**: qué es la herramienta, el diagrama del flujo y para qué sirve cada sección. **Glosario**: cada código que enseña el panel, con un buscador y un filtro por grupo. La pestaña y el grupo viven en la URL (`#/help?tab=glossary&group=tools`), así que otras páginas enlazan directo a un grupo; los enlaces antiguos al glosario de Inicio llegan aquí |

> [!NOTE]
> Sin ningún proyecto, solo están activas Inicio, Proyectos, Ajustes, Ayuda y Componentes (en modo desarrollo).

Los eventos nuevos llegan por Server-Sent Events con el id del último visto, y se reanudan al
reconectar. Los códigos que no se explican solos (`ScriptError`, ids de sesión, `p95`, ids de nodo…)
llevan un tooltip, también accesible con el teclado, que sale del mismo módulo que el glosario.

El pie de la barra lateral tiene dos líneas. La primera es un punto y un resumen del panel, Chrome y
Figma («Todo listo · en vivo» si los tres están bien; si no, lo que falla); al pasar el ratón o
enfocarlo sale cada uno en detalle. Al lado, el botón del tema (claro por defecto) y un enlace al
repositorio en GitHub. La segunda línea es la versión. Con la barra contraída, el punto y los botones
se apilan y el resumen queda en el tooltip.

## Intentos

`#/attempts` es de solo lectura. Lista los objetivos —scripts, pasos del kit, pantallas capturadas— con
sus intentos (filtros por tipo, último estado, fecha y texto; orden y paginación en el servidor). La
página de un objetivo enseña todos sus intentos y, entre dos de ellos (por defecto el último y el
anterior), el estado de cada papel y el diff línea a línea de uno. Las fechas salen en hora local.
Ningún botón escribe en Figma ni repite un intento. Es el mismo cálculo que usa `figma_history_diff`.

## Ajustes

`#/settings` lista cada ajuste editable, agrupado, con su ayuda, su unidad y quién lo usa (panel, agente
o los dos), el valor que rige y de dónde sale: por defecto, guardado en el panel o fijado por el entorno
(aquí en solo lectura). Guardar o restablecer vale para la siguiente sesión que arranque y para el
panel en su siguiente arranque. Puertos, rutas, la base y la orden de la terminal son de arranque y
solo cambian en el `.env`. Ver [Configuración](configuration.es.md).

## Trabajar en la interfaz

```bash
make dev-web       # Vite con recarga en caliente; /api, /events y /screenshots van al panel
```

Deja el panel en marcha a su lado. Cómo está hecha la interfaz está en la documentación para quien
contribuye.
