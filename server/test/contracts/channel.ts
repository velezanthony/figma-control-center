// Contrato del channel de Claude Code (research preview) y de la herramienta de respuesta.
// Fuente: https://code.claude.com/docs/en/channels-reference.md
//  - «Server options»: `capabilities.experimental['claude/channel']` obligatoria y siempre `{}`;
//    `instructions` recomendada; `capabilities.tools` (siempre `{}`) en los canales de dos vías.
//  - «Notification format»: `notifications/claude/channel` con `content: string` y `meta?: Record<string,string>`;
//    las claves de `meta` son identificadores (letras, dígitos y guion bajo); las demás Claude Code las descarta en silencio.
//  - «Expose a reply tool»: herramienta MCP estándar con `chat_id` y `text` (cadenas, obligatorias).
//  - «Relay permission prompts» (Claude Code >= 2.1.234): la capacidad `experimental['claude/channel/permission']` (`{}`)
//    opta por recibir `notifications/claude/channel/permission_request` (`request_id` de cinco letras a-z sin `l`,
//    `tool_name`, `description`, `input_preview`: los cuatro son cadenas y se tratan como no fiables) y el servidor
//    responde con `notifications/claude/channel/permission` (`request_id` + `behavior` `allow`|`deny`). El diálogo de
//    la terminal sigue abierto: gana la primera respuesta y la otra se descarta. Claude Code no avisa de quién contestó,
//    no documenta plazo, y solo acepta un veredicto con un id que él emitió (un id repetido en la sesión se ignora).
//    Solo debe declararse si el canal autentica al remitente.
// Nuestra herramienta de respuesta es `figma_chat_reply` (contrato propio: mismo esquema de entrada que el de la referencia).
import { z } from "zod";

export const CHANNEL_CONTRACT_SOURCE =
	"https://code.claude.com/docs/en/channels-reference.md";

export const META_KEY = /^[A-Za-z0-9_]+$/;

export const ChannelCapabilitiesSchema = z.looseObject({
	experimental: z.looseObject({ "claude/channel": z.strictObject({}) }),
	// `tools` es la capacidad estándar de MCP: el SDK añade `listChanged`
	// https://modelcontextprotocol.io/specification/latest/server/tools#capabilities
	tools: z.looseObject({ listChanged: z.boolean().optional() }).optional(),
});

export const ChannelNotificationSchema = z.strictObject({
	method: z.literal("notifications/claude/channel"),
	params: z.strictObject({
		content: z.string(),
		meta: z.record(z.string().regex(META_KEY), z.string()).optional(),
	}),
});
export type ChannelNotification = z.infer<typeof ChannelNotificationSchema>;

// Nuestro uso: el panel siempre manda un chat_id, y es lo que Claude devuelve al responder
export const PanelChannelNotificationSchema = ChannelNotificationSchema.extend({
	params: ChannelNotificationSchema.shape.params.extend({
		meta: z
			.record(z.string().regex(META_KEY), z.string())
			.refine(
				(m) => Object.entries(m).some(([k, v]) => k === "chat_id" && v !== ""),
				{
					message: "falta meta.chat_id",
				},
			),
	}),
});

export const ReplyArgumentsSchema = z.strictObject({
	chat_id: z.string().min(1),
	text: z.string(),
});

// Relevo de permisos. El id es el alfabeto que genera Claude Code: cinco minúsculas sin `l`
export const PERMISSION_REQUEST_ID = /^[a-km-z]{5}$/;

export const PermissionChannelCapabilitiesSchema =
	ChannelCapabilitiesSchema.extend({
		experimental: z.looseObject({
			"claude/channel": z.strictObject({}),
			"claude/channel/permission": z.strictObject({}),
		}),
	});

export const PermissionRequestNotificationSchema = z.strictObject({
	method: z.literal("notifications/claude/channel/permission_request"),
	params: z.strictObject({
		request_id: z.string().regex(PERMISSION_REQUEST_ID),
		tool_name: z.string(),
		description: z.string(),
		input_preview: z.string(),
	}),
});
export type PermissionRequestNotification = z.infer<
	typeof PermissionRequestNotificationSchema
>;

export const PermissionVerdictNotificationSchema = z.strictObject({
	method: z.literal("notifications/claude/channel/permission"),
	params: z.strictObject({
		request_id: z.string().regex(PERMISSION_REQUEST_ID),
		behavior: z.enum(["allow", "deny"]),
	}),
});
export type PermissionVerdictNotification = z.infer<
	typeof PermissionVerdictNotificationSchema
>;
