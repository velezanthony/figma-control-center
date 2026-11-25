// Contrato del lanzamiento del agente (contrato propio, documentado en spikes/channel/README.md,
// server/src/application/launch-agent.ts y docs/users/claude-code.md): el panel genera la carpeta del
// lanzamiento (`<tmp>/figma-agent-<launchId>`) y ejecuta, sin shell,
// `[...FCC_AGENT_TERMINAL, "make", "agent", "PROJECT=<id>", "AGENT_DIR=<carpeta>"]` con la configuración en el entorno; la sesión lanzada publica su token en `<FCC_OUTPUT_DIR>/chat-tokens/<sessionId>.token`
// (modo 0600, 64 caracteres hexadecimales) y se registra en la base con la huella del token.
import { z } from "zod";

export const LAUNCH_CONTRACT_SOURCE = "spikes/channel/README.md";

export const LAUNCH_ARGV_TAIL = ["make", "agent"] as const;
export const PROJECT_ARG = /^PROJECT=[1-9][0-9]{0,4}$/;
export const AGENT_DIR_ARG = /^AGENT_DIR=\/.+\/figma-agent-[0-9a-f-]+$/;

export const SessionIdSchema = z.uuid();
export const TOKEN = /^[0-9a-f]{64}$/;
export const TokenSchema = z.string().regex(TOKEN);
export const TOKEN_FILE_MODE = 0o600;
export const TOKEN_FILE_SUFFIX = ".token";

export const LaunchedSchema = z.strictObject({
	launchId: z.string().min(1),
	startedAt: z.iso.datetime(),
	timeoutMs: z.number().int().positive(),
});
