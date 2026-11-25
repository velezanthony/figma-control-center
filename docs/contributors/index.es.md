---
seo:
  title: "Guía para contribuir al MCP de Figma"
  description: "Guía para contribuir a Figma Control Center: entorno de desarrollo, arquitectura hexagonal, cómo ampliar herramientas y contratos, tests y convenciones."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Para quien contribuye

Figma Control Center es un servidor MCP que deja a Claude Code leer y modificar un archivo de Figma
ejecutando scripts contra el API de plugins. El servidor lee cada script del disco y lo envía a una
pestaña de figma.com por el Chrome DevTools Protocol, así que los datos grandes nunca pasan por el
contexto del modelo. Alrededor hay un panel de actividad, un histórico en SQLite, un kit de Figma que
corre dentro de la pestaña y un kit de captura que lee la web del propio proyecto.

Empieza por aquí:

- **[Desarrollo](development.es.md)** — preparar el entorno, los procesos que arrancas, los comandos
  y por dónde empezar a leer
- **[Arquitectura](architecture.es.md)** — por qué CDP, las capas hexagonales, el mapa de carpetas
  y cómo se vigilan las fronteras
- **[Ampliar](extending.es.md)** — añadir una herramienta MCP, un paso del kit, un contrato, un
  ajuste o una migración
- **[Tests](testing.es.md)** — `make check`, el simulador de Figma, los E2E herméticos y las pruebas
  opcionales contra Figma real
- **[Convenciones](conventions.es.md)** — commits, TypeScript, comentarios y las reglas que sostienen
  algo en vez de ser estilo

## La versión corta

- **Las herramientas reciben rutas, no código.** El servidor lee el script del disco. Una
  herramienta que obliga al modelo a pegar megas en sus argumentos tira por tierra el motivo de que
  exista el proyecto.
- **Nunca escribas en stdout en el proceso MCP.** stdout *es* el canal MCP; un `console.log` suelto
  corrompe el protocolo. Los logs van a stderr.
- **Respeta las capas.** `domain` no importa nada, `application` importa `domain`, `adapters`
  importa los dos y solo las raíces de composición hacen `new`. ESLint, dependency-cruiser y
  `architecture.test.ts` rompen el build si no — son la regla, no una sugerencia.
