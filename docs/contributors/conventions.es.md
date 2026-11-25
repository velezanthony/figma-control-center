---
seo:
  title: "Convenciones: TypeScript y commits"
  description: "Convenciones para contribuir a Figma Control Center: commits, idiomas, TypeScript estricto, el proceso MCP, comentarios, formato y documentación."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Convenciones

## Commits

[Conventional Commits](https://www.conventionalcommits.org/es/), con la **descripción y el cuerpo en inglés**:

```text
feat(kit): add the kit/links@1 step
fix(cdp): retry the connection when the tab reloads
```

Di el cambio y su consecuencia; es lo que necesita quien llega a una línea que no entiende desde
`git blame`. Sin atribución a IA ni trailers de coautoría. Un tema por commit, y `make check` en verde
antes.

## Idioma

- **Nombres de ficheros y carpetas en inglés**, también los fixtures de los tests.
- **Código en inglés**: variables, funciones, tipos, clases, constantes, claves internas de objetos,
  scripts de npm y objetivos del Makefile.
- **Comentarios y docstrings en castellano.** Los títulos de los tests (`describe`, `it`) cuentan
  como documentación y van también en castellano.
- **Los contratos públicos conservan su nombre**: campos de los esquemas publicados y de los
  ficheros del proyecto, nombres de las herramientas y prompts MCP y de sus parámetros, códigos de
  aviso y de error, claves `fcc:` guardadas en Figma y variables de entorno. Renombrar uno rompe
  configuraciones que ya existen, así que es una decisión aparte, nunca un efecto de esta regla. Lo
  mismo vale para los textos que lee el usuario (errores, el panel, descripciones de herramientas).
- Los datos de test que representan contenido de un usuario —nombres de capas y propiedades de
  Figma, claves de pantalla, nombres de tokens, URLs de una web de prueba— son datos, no código, y
  pueden ir en cualquier idioma.

## Primero los tests

Cada funcionalidad, caso de uso, herramienta y arreglo empieza con un test en rojo. El ciclo y dónde
va cada test están en [tests](testing.es.md).

## TypeScript

- Estricto: `@tsconfig/strictest` más `erasableSyntaxOnly`. Node ejecuta las fuentes directamente,
  así que nada que necesite transformación: **ni `enum` ni `namespace`**. Objetos `as const` y
  uniones.
- **Los errores esperados son valores** (`Result`), no excepciones. Las excepciones son para bugs.
- **zod solo en los bordes** — entrada de herramientas, ficheros del disco, cuerpos HTTP, respuestas
  de CDP. Dentro, los tipos ya son de fiar.
- Imports entre capas con los alias `#domain/…`, `#application/…`, `#adapters/…`, nunca `../../`.

## Sin valores mágicos

Todo lo que depende de la máquina o del uso — puertos, hosts, rutas, plazos — tiene un **valor por
defecto** en el esquema de configuración, y el entorno solo lo sobrescribe. La configuración se lee
en un solo sitio, `server/src/adapters/config/env.ts`; nada más toca `process.env`. Los valores fijos
del programa son constantes `as const` en el módulo de su adaptador. Cómo añadir una variable:
[ampliar](extending.es.md).

## El proceso MCP

- **Nunca escribas en stdout.** Es el canal MCP. Los logs van a stderr.
- **Las herramientas reciben rutas.** Scripts, manifiestos y ficheros del proyecto los lee el
  servidor del disco; el modelo pasa una ruta. `code` existe solo para fragmentos cortos.
- **Las herramientas se llaman `figma_*`**, validan su entrada con zod, responden
  `{ ok, …, error, retryable }` y toda escritura devuelve los ids que toca. Un error lleva un
  `nextStep` que dice a quien llama qué cambiar.

## Dependencias

Ninguna dependencia nueva sin un problema que ya exista. El servidor no tiene framework web: el lado
MCP es un proceso stdio y el servidor HTTP del panel es pequeño a propósito. A los módulos nativos no
se les aprueban los scripts de instalación.

## Comentarios

Quédate con los que dicen algo que el código no puede decir: una decisión contraintuitiva que alguien
«arreglaría», un orden que *es* el bug, dónde vive a propósito una responsabilidad. Lo demás sobra —
cabeceras narrativas, docstrings que repiten un nombre y referencias a documentos de planificación.
La historia de cómo llegó a ser así una línea va en el mensaje del commit.

## Formato y lint

Biome formatea (tabuladores, comillas dobles) y hace lint; `make format` lo aplica. ESLint no hace
estilo — solo fronteras y promesas. El Markdown no se formatea solo.

## Documentación

- Un cambio de comportamiento para quien usa la herramienta actualiza `docs/users/`, y uno para quien
  contribuye, `docs/contributors/`, en el **mismo cambio**.
- **Los dos idiomas**: cada `.md` tiene su hermano `.es.md` y dicen lo mismo. El inglés es el
  principal.
- Escribe lo que no caduca: dónde vive algo, la regla, qué la rompe. Sin conteos, sin fechas, sin
  historia de cómo era antes.
- El sitio se genera desde `docs/` con `docs-site/` (un proyecto de Astro con la librería
  [Design](https://github.com/velezanthony/design)). Para verlo en local:
  `npm install --prefix docs-site` y `npm run dev --prefix docs-site`; su build falla con un enlace o
  un ancla rotos y avisa de un bloque de código sin lenguaje.
