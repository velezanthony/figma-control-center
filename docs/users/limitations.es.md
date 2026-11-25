---
seo:
  title: "Limitaciones del MCP de Figma"
  description: "Limitaciones conocidas de Figma Control Center: el objeto figma no oficial, scripts que no se interrumpen, un lote por archivo, scripts para Linux y más."
  image:
    src: "/og-es.png"
    alt: "Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco"
---

# Limitaciones conocidas

Son parte del contrato, no una lista de excusas. Cada una dice por qué existe.

## El transporte

:::danger[El objeto `figma` de la pestaña no es un canal oficial de automatización]
El servidor maneja Figma a través del objeto del API de plugins que el editor web de Figma expone
en su propia página, alcanzado por el Chrome DevTools Protocol. Figma no documenta ni da soporte a
esto como forma de automatizar el editor. Puede cambiar o desaparecer sin aviso, y una
actualización del editor puede romper la herramienta de un día para otro. Úsala sobre archivos que
te puedas permitir arreglar, ten presente el historial de versiones de Figma y no montes un proceso
de negocio que no sobreviva a que deje de funcionar.
:::

- **Por qué no un plugin.** Figma web no carga plugins de desarrollo, y no hay Figma Desktop oficial
  para Linux, que es el único sitio donde se cargan; por eso el servidor llega a Figma por CDP.
- **Hace falta permiso de edición.** Figma solo expone el API de plugins a cuentas que pueden editar el
  archivo. Con acceso de solo lectura, `figma_status` dice `viewOnly` y no se puede hacer nada sobre ese
  archivo.
- **La sesión caduca.** Cuando acaba la sesión de Figma del perfil de depuración, `figma_status` lo dice:
  `make login` y después `make chrome`.
- **Los estados se deducen.** Cómo distingue `figma_status` «sin sesión», «solo lectura» y «cargando»
  se lee de la página, no de un API.

## Ejecución

- **Un script en marcha no se puede interrumpir.** Figma no ofrece cómo pararlo. Un script que pasa de
  su plazo sigue corriendo en la pestaña, y las escrituras se rechazan hasta que acabe o se recargue la
  pestaña (`previousScriptRunning` en `figma_status`). Trocea el trabajo largo en pasos de
  `figma_build`: un lote se puede cancelar entre pasos.
- **Los jobs viven en memoria.** Reiniciar el servidor pierde los jobs que seguía; el histórico conserva
  lo que se registró.
- **Un lote a la vez por archivo de Figma**, entre todas las sesiones de la máquina. Las lecturas siguen
  corriendo y pueden ver una pantalla a medio construir.
- **Un proyecto por sesión del servidor MCP.** Con varios en alcance y ninguno elegido, las herramientas
  se niegan hasta que elijas uno (`FCC_PROJECTS`).
- **Una captura de la web a la vez** en la máquina.
- **Los scripts solo se leen de las raíces de scripts del proyecto.** Una ruta fuera se rechaza, a
  propósito: las herramientas reciben rutas, y las rutas están acotadas.

## Plataforma

- **Los scripts de ayuda están escritos para Linux.** `spikes/m0/chrome.sh` y `login.sh` usan `setsid`,
  `pkill` y `ss`, y lanzan `google-chrome`. En otro sistema, adáptalos; el servidor en sí es Node sin
  más.
- **Lanzar agente** abre la terminal que nombra `FCC_AGENT_TERMINAL` (`gnome-terminal --` por
  defecto): pon la de tu escritorio.

## El chat

- **Los canales son una research preview de Claude Code.** El chat del panel depende de ellos; si tu
  organización los desactiva, los mensajes nunca llegan a la sesión. Claude Code ignora los canales en
  modo no interactivo (`-p`) y en el Agent SDK.
- **El panel no puede saber si un permiso se contestó en la terminal.** Gana la primera respuesta.
- **Un panel colgado no se detecta.** Un agente lanzado desde el panel se cierra cuando el panel se
  cierra o se cae y no vuelve; uno vivo pero que no responde lo mantiene abierto.
- **El arnés es fijo.** Un agente lanzado no tiene Bash, ni red, ni acceso fuera de las raíces de su
  proyecto, y no hay ajuste para cambiarlo.

## Datos

- **El perfil de Chrome guarda las cookies sin cifrar** (`--password-store=basic`): quien pueda leer la
  carpeta tiene tu sesión de Figma.
- **La base guarda el histórico de todos los proyectos.** Cada servidor y cada consulta se acotan a un
  proyecto, pero el fichero es compartido: protégelo como el resto de tu carpeta de salida.
