---
seo:
  title: "Contratos JSON de proyectos Figma"
  description: "Referencia de los contratos JSON versionados que un proyecto intercambia con el servidor MCP de Figma: project, screens, map, sheets, compose y más."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Contratos

La herramienta no sabe nada de ningún proyecto concreto. Publica **contratos** —formas de datos con
versión, como las entradas y salidas de un API— y cada proyecto los firma aportando sus datos. Un
contrato es un esquema zod en `server/src/adapters/contracts/`, publicado como JSON Schema en
[`schemas/`](https://github.com/velezanthony/figma-control-center/tree/main/schemas); un test falla si
los dos se separan.

> [!IMPORTANT]
> Todos los contratos son **estrictos**: una clave que el contrato no define es un error, no se ignora.
> Una errata (`timoutMs`) se rechaza en vez de tirar tu valor sin avisar. Las comprobaciones que el
> esquema no puede expresar —ids únicos, expresiones regulares que compilan, referencias cruzadas entre
> ficheros— corren en el dominio (`server/src/domain/*-check.ts`) y dan cada problema con un puntero
> JSON.

| Contrato | Lo escribe | Lo lee | Vive en |
|---|---|---|---|
| [`project@1`](#project1) | Tú | `figma_capture`, los pasos del kit, `figma_design_context` | `figma-control-center.json` en el directorio del proyecto |
| [`screens@1`](#screens1) | Tú | `figma_capture` | El directorio del proyecto |
| [`capture@1`](#capture1) | `figma_capture` | `kit/build-screen@1`, `kit/build-component@1` | `web-captures/` en la carpeta de salida |
| [`areas@1`](#areas1) | Tú | `figma_build` con `areas`, los pasos de área del kit | El directorio del proyecto |
| [`map@1`](#map1) | Tú | Los pintores de pantallas y hojas, `figma_design_context` | El directorio del proyecto |
| [`screen@1`](#screen1) | El servidor | `kit/build-screen@1` | `screen-plans/` en la carpeta de salida |
| [`sheets@1`](#sheets1) | Tú | `figma_build` con `sheets`, `figma_design_context` | El directorio del proyecto |
| [`component@1`](#component1) | El servidor | `kit/build-component@1` | `sheet-plans/` en la carpeta de salida |
| [`compose@1`](#compose1) | Tú (o el agente) | `kit/compose@1` | `compose/<clave>.json` en el directorio del proyecto |
| [`design-context@1`](#design-context1) | `figma_design_context` | El agente que escribe la plantilla | `reads/` en la carpeta de salida |
| [`step@1`](#step1) | Cualquier script con la cabecera | `figma_run_script`, `figma_build` | El resultado del paso |
| [`build-manifest@1`](#build-manifest1) | Tú | `figma_build` | Donde quieras dentro de las raíces de scripts |

> [!NOTE]
> Dos más son **código** y no datos, así que no tienen JSON Schema: los ganchos de captura (`hooks.js`,
> ganchos de `capture@1`) y las reglas de reconocimiento (`recognize.js`, `recognize@1`). Los dos los
> escribe el proyecto consumidor y el servidor nunca los ejecuta.

Los ejemplos mínimos de abajo salen del fixture `server/test/fixtures/projects/example-mini/`, que
tiene un juego completo.

## `project@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/project.v1.json).
Cómo llegar a la web del proyecto y dónde están sus demás ficheros. Obligatorios: `contract`, `web`,
`screens`.

`web` lleva `baseUrl` (la navegación nunca sale de ella), `viewport` (`w`, `h`, factor de escala
opcional), un formulario de `login` opcional (`path`, `fields.user`, `fields.password`, `submit`
opcional), `users` (cada uno con un `username` y un `secretRef` que se resuelve en
`FCC_WEB_SECRETS_FILE`, nunca la contraseña), `strip` (selectores que se quitan antes de capturar) y
`hideScrollbar`. El resto de claves son rutas relativas al fichero: `screens`, `hooks`, `areas`, `map`,
`recognize`, `sheets`, `compose`.

```json
{
  "contract": "project@1",
  "web": { "baseUrl": "http://127.0.0.1:8000", "viewport": { "w": 800, "h": 600 } },
  "screens": "screens.json"
}
```

## `screens@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/screens.v1.json).
Las pantallas que se capturan. Cada una tiene una `key` (da nombre a los ficheros de salida: sin barras
ni puntos), un `title` y una `url` bajo `baseUrl` y, opcionalmente, `session` (un usuario de
`project@1`), `pick` (un selector: se captura solo ese elemento), `viewport`, `until` (una condición
que esperar) y `variants`. Una variante tiene `props` (lo que la distingue, que luego serán
propiedades de variante) y, opcionalmente, `query`, `run` (acciones `click` o `evaluateInPage`),
`force` (`{ selector, state }` para forzar un estado CSS), `viewport` y `until`.

```json
{
  "contract": "screens@1",
  "screens": [{ "key": "inicio", "title": "Inicio", "url": "/" }]
}
```

## `capture@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/capture.v1.json).
El resultado de capturar una pantalla: `screen`, `title`, `source`, una entrada por variante con su
árbol de nodos, `props` y anotaciones, las `images` (por `ref`, nunca incrustadas como URL `data:`) y
`warnings`. Cada nodo lleva un `id` y una `path`, así que un error señala el nodo exacto. No lo escribes
nunca; léelo cuando una captura se rechaza.

## `areas@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/areas.v1.json).
Las áreas del archivo de Figma. Obligatorios: `contract`, `linkRules` (qué cuenta como pulsable, cómo
se reconocen las filas de una tabla, la transición del prototipo) y `areas`. Cada área tiene un
`name`, una `page`, un `frame` (`width`, `minHeight`, variable de `fill` y `clip` opcionales), una regla
`place` (`mode`, el `source` de las páginas temporales, qué `keep`/`drop`/`unwrap`), sus `screens`
(nombre del frame, clave de pantalla y variante de la carcasa opcionales) y, opcionalmente, una
`shell`, `links`, `flowStart` y `fills` de imagen. `shared` agrupa el contenido común a varias áreas en
un componente.

```json
{
  "contract": "areas@1",
  "linkRules": {
    "clickable": { "names": ["boton"], "namePrefixes": [], "components": ["Boton"] },
    "rows": { "row": ["fila"], "body": ["cuerpo"] },
    "transition": { "type": "DISSOLVE", "easing": "EASE_OUT", "duration": 0.2 }
  },
  "areas": [
    {
      "name": "Portada",
      "page": "Portada",
      "frame": { "width": 1280, "minHeight": 800 },
      "place": { "mode": "transplant", "source": { "pagePrefix": "tmp ", "take": "first-component" } },
      "screens": [{ "frame": "Portada" }]
    }
  ]
}
```

## `map@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/map.v1.json).
Cómo pasa el código del proyecto a Figma. Obligatorios: `contract`, `tokens` (colecciones de
variables, prefijos de clase para relleno, texto y borde, reglas de clase a nombre de variable, números
para radios y espaciado), `fonts` (familias por patrón, familia por defecto, peso a estilo, cursivas),
`icons` (páginas, prefijo y el catálogo `icons.json`) y `layers` (nombres de capa por papel HTML).
Opcionales: `effects`, `screen` (fondo), `components` (el fichero `fingerprints.json`, componentes
hoja, clases genéricas que se ignoran) y `rules` de reconocimiento por pantalla.

```json
{
  "contract": "map@1",
  "tokens": {
    "collections": ["Base"],
    "classPrefixes": { "fill": ["bg-"], "text": ["text-"], "stroke": ["border-"] },
    "classToVariable": [{ "from": "^(.+)$", "to": "$1" }]
  },
  "fonts": {
    "families": [],
    "default": "Sans",
    "styles": { "400": "Regular", "700": "Bold" },
    "italic": { "suffix": "Italic" }
  },
  "icons": { "pages": "Iconos", "prefix": "icons/", "catalog": "icons.json" },
  "layers": { "roles": { "header": "cabecera", "main": "principal" }, "textPrefix": true }
}
```

## `screen@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/screen.v1.json).
El plan de una pantalla, que arma el servidor desde una captura y `map@1`: el destino, la variante y
las props elegidas, el árbol de nodos de la captura sin cambios, y las imágenes, iconos y
correspondencias que necesita. No lo escribes nunca; es lo que pinta `kit/build-screen@1`, y un
intento lo guarda para poder comparar dos construcciones.

## `sheets@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/sheets.v1.json).
Una hoja por componente. Obligatorios: `contract`, `style` (las variables de cabecera, tarjeta, textos
y matriz de las páginas de hojas) y `sheets`. Cada hoja tiene una `key`, la `screen` capturada que la
muestra, un `title`, una `page`, una `description`, el `tag` y el fichero de plantilla del que sale
(`source`), la `matrix` de variantes, los `texts` que pasan a propiedades de texto y `rules` de
reconocimiento opcionales. `sections`, opcional, agrupa hojas.

```json
{
  "contract": "sheets@1",
  "style": {
    "header": { "fill": "gris/900", "text": "gris/50" },
    "card": { "fill": "gris/50" },
    "texts": { "description": "gris/900", "bug": "gris/900", "tag": "gris/900", "rowLabel": "gris/900", "colLabel": "gris/900" },
    "bug": { "prefix": "Fallo: ", "setPrefix": "FALLO: " },
    "matrix": { "stroke": "gris/900" }
  },
  "sheets": [
    {
      "key": "marca", "screen": "cmp-marca", "title": "Marca",
      "page": { "name": "Marca" }, "description": "La marca de la cabecera",
      "tag": "<span class=\"marca\">", "source": "plantillas/marca.html",
      "matrix": { "rows": ["tamano"] }
    }
  ]
}
```

## `component@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/component.v1.json).
El plan de una hoja, que arma el servidor desde la captura de la galería, `sheets@1` y `map@1`: un
árbol de nodos por variante, la matriz, el estilo y las correspondencias. Como `screen@1`, se genera;
nunca se escribe a mano.

## `compose@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/compose.v1.json).
Una pantalla diseñada en Figma sin web detrás. Obligatorios: `contract`, `key`, `title`, `target`
(`page`, `width`, `frame` y `height` opcionales) y `root`, un bloque. Un bloque es exactamente uno de:
pila, instancia de una hoja, texto, imagen o icono; un bloque que mezcla dos tipos no cumple. Todo
valor que no es contenido de texto nombra una variable o un estilo. Ver
[Flujos de trabajo](workflows.es.md#diseñar-sin-web-compose1).

```json
{
  "contract": "compose@1",
  "key": "card",
  "title": "Ficha de ejemplo",
  "target": { "page": "Pruebas", "width": 480 },
  "root": { "stack": "VERTICAL", "gap": "espacio/m", "children": [{ "text": "Hola", "style": "Título/L" }] }
}
```

## `design-context@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/design-context.v1.json).
Lo que escribe `figma_design_context`: el `file` y `readAt`, el `origin` del frame, el nodo `root` y los
`nodes` en anchura, las `variables` y `styles` resueltos, los `components` con su hoja y su plantilla
(`code.source`, `code.tag`, `code.by`), los `warnings` (como `NO_CODE_MAPPING`) y, si se alcanzó el
tope de nodos, `truncated` con los ids que quedaron fuera. Ver
[Flujos de trabajo](workflows.es.md#de-figma-a-código).

## `step@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/step.v1.json).
El resultado de un script cuya primera línea es `// @contract step@1 · <qué hace>`, y de todo paso del
kit.

```json
{ "createdNodeIds": ["1:2"], "mutatedNodeIds": ["1:3"] }
```

`removedNodeIds`, `warnings` (`{ code, message, nodeId? }`) y `report` son opcionales.
`kit.track().done()` devuelve un resultado que cumple; ver
[El kit de Figma](kit.es.md#step1-scripts-cuyo-resultado-se-juzga).

## `build-manifest@1`

[Esquema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/build-manifest.v1.json).
Un lote para `figma_build`: `name` opcional, `expect` (`{ fileName }`, una guarda sobre el archivo
abierto) y `params` comunes, y al menos un paso. Un paso es un script (`file`, `format`, `params`,
`assets`, `timeoutMs`) o un paso del kit (`use` más su objetivo). Ver
[El kit de Figma](kit.es.md#pasos-del-kit).

```json
{
  "expect": { "fileName": "Ejemplo" },
  "steps": [{ "use": "kit/build-screen@1", "screen": "inicio" }, { "file": "scripts/ejemplo/tidy.js" }]
}
```
