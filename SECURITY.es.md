# Seguridad

## A qué puede llegar esta herramienta

**A tu cuenta de Figma, con tu propia sesión.** El servidor maneja una pestaña
de figma.com en un Chrome con el que habla por Chrome DevTools Protocol, y
ejecuta ahí scripts con el API de plugins. Un script puede hacer todo lo que
puedes hacer tú en ese archivo. El perfil de Chrome que guarda la sesión deja
sus cookies **sin cifrar** (`--password-store=basic`): quien pueda leer esa
carpeta tiene tu sesión de Figma. Déjala fuera del repositorio (el servidor
rechaza un perfil dentro), con permisos de tu usuario y fuera de copias de
seguridad compartidas.

**Scripts solo de las carpetas que permites.** Las herramientas reciben una
ruta, y el servidor solo la lee si cae dentro de `FCC_SCRIPTS_ROOT`. Los
resultados, las capturas y la base del histórico se quedan en tu disco, en la
carpeta de salida y en `FCC_DB`.

**Solo en local.** El puerto de depuración de Chrome y el panel escuchan en
loopback; el panel rechaza cualquier otro host, y las peticiones que cambian
algo se rechazan si vienen de otro sitio. El agente que se lanza desde el panel
corre con un arnés fijo: solo las carpetas de su proyecto, sin shell, sin
herramientas de red y sin otros servidores MCP. Un mensaje del chat solo llega
a Claude Code firmado con el token de la sesión, y lo que trae una petición de
permiso se muestra como texto no fiable.

**Sin telemetría.** El servidor habla con el Chrome local, y la captura web
abre las páginas del proyecto que le indicas. Nada más sale de tu máquina.

## Informar de una vulnerabilidad

No abras una issue pública.

Usa el aviso privado de GitHub en
[github.com/velezanthony/figma-control-center/security/advisories/new](https://github.com/velezanthony/figma-control-center/security/advisories/new).

Incluye el commit, la entrada más pequeña que lo reproduce y lo que viste, sin
URLs ni claves de archivos de Figma, cookies, tokens ni valores del `.env`.
Recibirás confirmación en pocos días.

## Versiones con soporte

El último commit de la rama principal. Es un proyecto con una sola persona
manteniéndolo, así que los arreglos llegan ahí y no como parches a versiones
anteriores.
