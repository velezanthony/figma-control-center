# Cómo contribuir

Gracias por mirarlo. Figma Control Center hace una sola cosa —ejecuta scripts
del API de plugins, leídos del disco, en una pestaña de Figma para Claude Code—
y el listón no es tanto «¿funciona?» como «¿se seguirá entendiendo dentro de
seis meses?».

## Antes de abrir un pull request

```bash
make check     # typecheck + lint + tests
make e2e       # E2E herméticos, si tocas una herramienta, un paso del kit, el panel o el arnés del agente
```

`make e2e` necesita una vez el Chromium de Playwright (`make e2e-setup`).
Ninguno de los dos necesita Chrome, una cuenta de Figma ni un `.env`: Figma y
Claude Code están simulados. Mira [tests](docs/contributors/testing.es.md).

Sal de `master`, deja la rama en un solo tema, escribe primero el test que
falla y espera a que CI salga en verde.

## Lo que se devuelve

**Una herramienta que recibe código o datos en vez de una ruta.** Las
herramientas reciben rutas de fichero; el servidor lee el fichero. Los megas
nunca pasan por el contexto del modelo: ese requisito da forma a todo el
diseño.

**Cualquier cosa escrita en stdout desde el proceso MCP.** stdout es el canal
MCP. Los logs van a stderr.

**Un import que cruza una frontera de capa.** `domain` no importa nada,
`application` importa `domain`, `adapters` importa los dos, y las raíces de
composición los cablean. Lo imponen ESLint, dependency-cruiser y un test de
arquitectura: mira [arquitectura](docs/contributors/architecture.es.md).

**Conocimiento de un proyecto concreto dentro del servidor.** La herramienta es
genérica: los proyectos aportan sus datos con los contratos de `schemas/`.

**Leer `process.env` fuera del adaptador de configuración**, o un valor que
depende de la máquina sin un valor por defecto en el esquema.

**Una dependencia nueva sin un problema que ya exista.**

**Documentación en un solo idioma.** Cada página de `docs/` tiene su hermana
`.es.md`; actualiza las dos.

## Informar de un bug

El informe útil es la llamada que falla —herramienta, entrada, `error` y
`nextStep`— y lo que esperabas. Te la dan `figma_history_errors` o la página
Actividad del panel. No pegues URLs ni claves de archivos de Figma, cookies ni
tokens.

Abre una issue en
[github.com/velezanthony/figma-control-center/issues](https://github.com/velezanthony/figma-control-center/issues).

## Dónde está cada cosa

- **[Visión general](docs/contributors/index.es.md)** — por dónde empezar
- **[Desarrollo](docs/contributors/development.es.md)** — entorno, comandos, los dos procesos
- **[Arquitectura](docs/contributors/architecture.es.md)** — capas, carpetas, por qué CDP
- **[Ampliar](docs/contributors/extending.es.md)** — una herramienta, un paso del kit, un contrato o un ajuste nuevos
- **[Tests](docs/contributors/testing.es.md)** — la suite, el simulador, las pruebas opt-in contra Figma real
- **[Convenciones](docs/contributors/conventions.es.md)** — commits, TypeScript, comentarios
