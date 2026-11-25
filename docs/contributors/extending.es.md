---
seo:
  title: "Añade herramientas MCP y contratos"
  description: "Cómo añadir a Figma Control Center una herramienta MCP, un paso del kit, un contrato, una variable de configuración o una migración, empezando por un test."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Ampliar

Todo lo de abajo empieza igual: un test en rojo. Dónde va, en [tests](testing.es.md). Antes de añadir
nada, lee de principio a fin el ejemplo más parecido que ya exista — el repositorio tiene uno de cada,
y un patrón paralelo se queda atrás la primera vez que alguien cambia el original.

## Añadir una herramienta MCP

1. **Ponle nombre** en `TOOL_NAME` de
   [`server/src/domain/tool-names.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/domain/tool-names.ts).
   Los nombres son `figma_*`. El histórico clasifica las llamadas por estos nombres, así que son
   vocabulario del dominio, no un detalle del adaptador. Si la herramienta modifica el archivo de
   Figma, añádela a `WRITE_TOOLS` en el mismo fichero.
2. **Escribe el caso de uso** en `server/src/application/`, contra puertos, con su test al lado.
   Un puerto nuevo tiene su doble en memoria en `application/testing/` antes que un adaptador real.
3. **Regístrala** en la función `register*` de `server/src/adapters/mcp/` que corresponda a su
   familia (`tools.ts`, `read-tools.ts`, `build-tools.ts`, `capture-tools.ts`, `history-tools.ts`);
   `createMcpServer` de `server.ts` las llama. Cada registro declara:
   - un esquema de entrada en zod — la única validación de la herramienta, en el borde;
   - un esquema de salida, con el sobre común `{ ok, …, error, retryable }`. Toda escritura devuelve
     los ids de los nodos que toca;
   - anotaciones — `readOnlyHint: true` para todo lo que no escribe.
4. **Envuelve el manejador en `track(recorder, TOOL_NAME.x, args, …)`** para que la llamada llegue al
   registro de actividad y al histórico. Arma la respuesta con los ayudantes de `presenters.ts`
   (`reply`, `usageError`).
5. **Decide qué hace con ella el arnés del agente.** `server/src/domain/agent-harness.ts` lista qué
   herramientas puede usar sin preguntar el agente del chat del panel (`MCP_READS`); una que cambia
   Figma o captura la web va en `CHAT_AGENT_DENIED_TOOLS` (`server/src/domain/tool-names.ts`), que
   rechazan sus ajustes, su guardián y el servidor. La configuración exacta que se genera la fija un
   fixture en `server/test/fixtures/agent-harness/`; actualízalo en el mismo cambio.
6. **Pruébala por MCP** con un cliente y un servidor en memoria: mira
   `server/src/adapters/mcp/tools.int.test.ts`.
7. **Documéntala** en la [referencia de herramientas](../users/tools.es.md), en los dos idiomas.

## Añadir un paso del kit

Un paso del kit es una entrada `{ use: "kit/<nombre>@1", … }` de un manifiesto de lote: código fijo
que el servidor manda a la pestaña y que llama a una pieza del kit de Figma con los parámetros que el
servidor arma desde los ficheros del proyecto consumidor.

1. **La pieza** va en `kits/figma/steps/<nombre>.ts` y se exporta en `steps` de
   `kits/figma/steps/index.ts`. Devuelve un resultado `step@1`: los ids que creó, cambió o borró, más
   avisos e informe.
2. **El nombre** entra en las listas de pasos y en el mapa de nombre a pieza de
   [`server/src/domain/step.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/domain/step.ts),
   que también arma el código fijo (`kitStepCode`).
3. **El contrato del manifiesto** en `server/src/adapters/contracts/build-manifest.ts` acepta el
   `use` nuevo y sus campos. Después, `npm run schemas`.
4. **Resolver los parámetros** — desde el proyecto ya cargado, sin leer disco — vive en
   `server/src/application/kit-step.ts` (y sus hermanos `*-plan.ts` de pantallas, hojas y compose).
5. **El simulador.** Los tests herméticos nunca ejecutan el kit en Figma:
   `server/test/harness/kit-step-reply.ts` reconoce el código fijo de un paso y contesta un resultado
   `step@1` hecho desde sus parámetros. Enséñale el paso nuevo para que los escenarios E2E puedan
   usarlo.
6. **Los tests puros** de la pieza corren contra un Figma falso en `server/test/kits/figma/pure/`.
7. **Reempaqueta** con `npm run build:kit`; si no, falla el test del paquete.
8. Si el comportamiento depende de lo que hace el Figma real, añade un caso a `make kit-contract`
   (`server/test/contract/figma-kit.e2e.test.ts`).

## Añadir o cambiar un contrato

1. Cambia el esquema zod en `server/src/adapters/contracts/`. Un contrato va versionado (`@1`): un
   cambio incompatible es una versión nueva, no una edición.
2. `npm run schemas` regenera `schemas/<nombre>.v<n>.json`. El test del esquema compara el fichero
   versionado con `z.toJSONSchema` y te dice que lo regeneres si no coinciden.
3. El ejemplo de `server/test/contracts/` se **construye** desde el esquema y se valida al
   construirlo — nunca se pega de una salida real. Actualízalo junto con sus casos en
   `contracts.test.ts`.
4. Cada contrato cita su fuente pública en una lista `*_CONTRACT_SOURCES`; mantenla apuntando a la
   [referencia de contratos](../users/contracts.es.md) y actualiza esa página en los dos idiomas.

## Añadir una variable de configuración

La configuración tiene un solo lector: `server/src/adapters/config/env.ts`. Todo lo demás recibe la
configuración ya leída. Una variable nueva entra, en el mismo cambio, en:

1. **El esquema** de `server/src/adapters/config/schema.ts`, con su `.default(...)` salvo que sea de
   verdad obligatoria. Ojo con Zod 4: `.default()` usa el valor de *salida* y se salta el `transform`,
   así que una ruta por defecto se pasa ya resuelta con `toAbsolute(...)` y una lista, como su array.
2. **Exactamente una clase**: `EDITABLE_KEYS` (se cambia desde la página de ajustes del panel) con su
   ficha en `SETTING_INFO` — grupo, nombre, ayuda, unidad y quién la usa, que la página pinta sin
   tocar la web — o `BOOT_KEYS` (fija al arrancar). Un test falla si una clave queda sin clasificar.
3. **`.env.example`**, como documentación de cómo sobrescribirla.
4. **Los scripts de shell** de `spikes/` leen el entorno, no el esquema: si alguno necesita la
   variable, repite su valor por defecto con `${VAR:-…}`.

> [!NOTE]
> Los valores fijos del programa — nombres de métodos del protocolo, umbrales — no son configuración.
> Son constantes `as const` en el módulo de su adaptador.

## Cambiar la base de datos

1. Cambia `server/src/adapters/sqlite/schema.ts` y ejecuta `npm run db:generate`; la migración de
   Drizzle cae en `server/src/adapters/sqlite/migrations/`.
2. Una tabla con datos de proyecto lleva `project_id` (clave ajena, `ON DELETE CASCADE`, primera en
   sus índices), se lee por un repositorio acotado y entra en la lista de tablas de proyecto de
   `server/test/architecture.test.ts` — que falla si el esquema y esa lista no coinciden.
3. Drizzle no sabe nada de FTS5. Las tablas de texto completo y sus triggers van en una migración SQL
   escrita a mano, como `0002_fts.sql`, con `--> statement-breakpoint` entre sentencias.
