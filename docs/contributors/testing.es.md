---
seo:
  title: "Tests con fakes y E2E herméticos"
  description: "Cómo se prueba Figma Control Center: tests unitarios y de integración, fakes y no mocks, Figma y Claude simulados, E2E herméticos y pruebas con Figma real."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Tests

```bash
make check     # typecheck + lint + test — antes de cada commit
make verify    # make check + todos los E2E herméticos
```

`make test` ejecuta dos runners, uno detrás de otro, separados por directorio: `node:test` para
`server/` (el mismo runtime que ejecuta producción) y Vitest para `web/` (con la configuración de
Vite que compila el panel). Ninguno necesita Chrome, Figma ni red.

## Tipos de test

| Tipo | Sufijo y sitio | Qué usa |
|---|---|---|
| Unitario | `*.test.ts`, junto a su código | Funciones puras, o un caso de uso con dobles en memoria de sus puertos (`server/src/application/testing/`) |
| Integración | `*.int.test.ts`, junto a su código | Un Chrome falso que habla CDP, una carpeta temporal, un cliente y un servidor MCP en memoria, una base SQLite temporal |
| Arquitectura | `server/test/architecture.test.ts`, `server/test/lint-rules.test.ts` | El propio árbol de código — ver [arquitectura](architecture.es.md) |
| Contratos | `server/test/contracts/` | Esquemas zod de cada frontera y ejemplos construidos desde ellos |
| Web | `web/test/` | Componentes Svelte montados en `happy-dom` con `@testing-library/svelte`: atributos, roles, textos, clics. También las reglas de color, el contraste y que la galería cubra todos los componentes |
| E2E herméticos | `server/test/e2e/`, `server/test/kits/` | Procesos reales contra el simulador de Figma y un Claude falso |
| Contra Figma real | `server/test/contract/` | Opcional, solo el archivo de pruebas |

> [!NOTE]
> No hay tests de capturas. Lo que se ve mal se arregla al verlo; la galería de componentes
> (`/#/components` en el panel, con `FCC_DASHBOARD_MODE=development`) está para mirarla.

## Dobles: fakes, no mocks

Un doble implementa el puerto entero en memoria, con una respuesta programable por método y un
registro de las llamadas que recibió. Cada fichero de test tiene un `setup()` que monta el sujeto con
sus dobles y acepta cambios, así cada test solo dice lo que le importa. Los dobles viven en una
carpeta `testing/` de su capa y el código de producción nunca los importa — lo vigila ESLint.

Para controlar *cuándo* se resuelve algo (plazos blandos, jobs en curso), usa una promesa diferida en
vez de una espera real. Los temporizadores simulados, solo cuando el código lee el reloj y no hay otra
forma.

## El arnés: un Figma simulado y un Claude simulado

`server/test/harness/` es lo que permite ejecutar el sistema entero en CI sin Figma ni Claude Code:

- **`figma-simulator.ts`** contesta por CDP como lo haría una pestaña de Figma, validado contra los
  contratos de `server/test/contracts/`. Cada ejemplo que sirve está *construido* desde un contrato,
  nunca copiado de una respuesta real.
- **`kit-step-reply.ts`** reconoce el código fijo de un paso del kit y contesta un resultado
  `step@1` sacado de sus parámetros, para que los escenarios de lotes comprueben informes sin ejecutar
  el kit.
- **`fake-claude.ts`** y **`fake-claude-bin.ts`** hacen de Claude Code. El `claude` falso va primero
  en el `PATH` y en `FCC_CLAUDE_BIN`.
- **`example-mini.ts`** y `server/test/fixtures/projects/example-mini/` son un proyecto consumidor
  pequeño — pantallas, áreas, mapa, hojas, ficheros compose y una web mínima — que usan los
  escenarios.

> [!IMPORTANT]
> **Ningún test arranca un Claude Code real.** El arnés pone `FCC_TEST_HARNESS` y, con ella,
> `agent-run.ts` se niega a arrancar un `claude` que no sea el falso.

## E2E herméticos

```bash
make e2e-setup   # una vez: el Chromium propio de Playwright — nunca tu Chrome
make e2e         # compila la web y después las tres suites de abajo
```

- **Escenarios del servidor** (`server/test/e2e/scenarios/`): procesos reales de `main.ts` y
  `dashboard.ts`, SQLite real, el simulador en lugar de Figma y el Claude falso en lugar de Claude
  Code. La misma pasada prueba el Chrome de captura (`server/test/e2e/web/`) contra una web local
  mínima, con el Chromium de Playwright como `FCC_WEB_CHROME_BIN`; necesita navegador, así que no
  entra en `make check`.
- **Kits** (`server/test/kits/`): el kit de captura ejecutado sobre páginas de ejemplo en el Chromium
  de Playwright.
- **Navegador** (`server/test/e2e/browser/`, Playwright): solo el comportamiento del panel — flujos,
  foco, scroll, accesibilidad.

## Contra Figma real

Hay cosas que no se pueden simular con honradez: qué rompe un slot, qué pierde una variante clonada,
qué devuelve el editor en cada estado de la pestaña. Un doble que imitara el API de plugins pasaría en
el test y fallaría en Figma. Eso se comprueba contra un **archivo de pruebas** tuyo, y solo contra
ese:

| Comando | Qué hace |
|---|---|
| `make e2e-record` | Guarda respuestas reales del archivo de pruebas en `output/contract-samples/`, para investigar un contrato. Con `STATE=<estado>` guarda solo el estado de la pestaña |
| `make e2e-contract` | Valida respuestas reales del archivo de pruebas contra los mismos contratos que usa el simulador |
| `make kit-contract` | Ejecuta las piezas del kit de Figma contra Figma real. Crea y borra su propia página, `fcc:kit-test` |

> [!WARNING]
> Son opcionales: necesitan `FIGMA_TEST_FILE_URL` apuntando al archivo de pruebas y su pestaña abierta
> en el Chrome de depuración (`make chrome`), y se niegan a cualquier otro archivo. `make e2e-contract`
> y `make kit-contract` ponen `FCC_E2E=1` por ti. Nunca las apuntes a un archivo cuyo contenido
> importe.

## El ciclo de TDD

```bash
make test-watch        # server/, reejecuta al guardar
make test-watch-web    # web/
node --test server/src/application/run-script.test.ts               # un fichero
node --test --test-name-pattern="<texto>" "server/src/**/*.test.ts"  # un comportamiento
```

1. **Rojo.** Un test del siguiente comportamiento. Míralo fallar por la razón correcta — una aserción
   que no se cumple, no un import roto. Un test que nunca has visto fallar no prueba nada.
2. **Verde.** El mínimo código que lo pase. No anticipes el siguiente caso.
3. **Refactor.** Con todo en verde. Si un refactor te obliga a cambiar un test, el test comprobaba la
   implementación.

Reglas que salen de ahí:

- **Un comportamiento por test**, nombrado como una frase de lo que se observa.
- **Prueba por la puerta de entrada** — el caso de uso, la herramienta MCP, el método público del
  adaptador — y comprueba lo observable: el resultado y las llamadas a los puertos.
- **Un bug es primero un test en rojo.** Está arreglado cuando ese test pasa.
- **Determinista.** Sin esperas reales, sin reloj del sistema, sin red externa, sin orden entre tests.

Orden natural de una funcionalidad: dominio → caso de uso con dobles → adaptador (integración) →
herramienta MCP (integración) → E2E hermético si cruza procesos.

## Cobertura

`make coverage` ejecuta los dos runners con cobertura. Se informa, no se exige un mínimo.
