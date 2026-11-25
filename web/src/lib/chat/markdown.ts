import { lexer, type Token, type Tokens } from "marked";
import { type RefPart, splitRefs } from "./refs.ts";

// Markdown de las respuestas de Claude → árbol propio. Seguro por construcción: la interfaz pinta este árbol con
// elementos de Svelte (nunca {@html}), así que el HTML en bruto que venga en un resultado de herramienta es texto,
// una imagen no se carga y un enlace solo sale si su protocolo es http, https o mailto

export type Inline =
	| { readonly t: "text"; readonly text: string }
	| { readonly t: "strong"; readonly children: Inline[] }
	| { readonly t: "em"; readonly children: Inline[] }
	| { readonly t: "del"; readonly children: Inline[] }
	| { readonly t: "code"; readonly text: string }
	| { readonly t: "link"; readonly href: string; readonly children: Inline[] }
	| { readonly t: "br" }
	| { readonly t: "node"; readonly id: string; readonly code: boolean }
	| { readonly t: "call"; readonly id: string; readonly code: boolean };

export type Align = "left" | "center" | "right" | null;

export type Block =
	| { readonly t: "p"; readonly children: Inline[] }
	| {
			readonly t: "heading";
			readonly level: number;
			readonly children: Inline[];
	  }
	| { readonly t: "fence"; readonly lang: string; readonly text: string }
	| {
			readonly t: "list";
			readonly ordered: boolean;
			readonly start: number;
			readonly items: Block[][];
	  }
	| { readonly t: "quote"; readonly children: Block[] }
	| {
			readonly t: "table";
			readonly align: Align[];
			readonly head: Inline[][];
			readonly rows: Inline[][][];
	  }
	| { readonly t: "hr" };

const SAFE_PROTOCOLS: ReadonlySet<string> = new Set([
	"http:",
	"https:",
	"mailto:",
]);

// Solo URL absolutas con protocolo permitido: sin javascript:, data:, file:, ni relativas ni «//host»
export function safeHref(href: string): string | null {
	try {
		const url = new URL(href);
		return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

const refInline = (part: RefPart, code: boolean): Inline =>
	part.t === "text"
		? { t: "text", text: part.text }
		: { t: part.t, id: part.id, code };

// Texto suelto: une los trozos contiguos (el lexer parte en cada «\*» o «<») y separa los ids enlazables
function textRun(text: string): Inline[] {
	return splitRefs(text, false).map((p) => refInline(p, false));
}

function codeSpan(text: string): Inline {
	const parts = splitRefs(text, true);
	const [only] = parts;
	return parts.length === 1 && only !== undefined && only.t !== "text"
		? refInline(only, true)
		: { t: "code", text };
}

// `linked`: dentro del texto de un enlace los ids no se enlazan (un <a> dentro de otro no es HTML válido)
function inlines(
	tokens: readonly Token[] | undefined,
	linked = false,
): Inline[] {
	const out: Inline[] = [];
	let pending = "";
	const flush = () => {
		if (pending === "") return;
		out.push(
			...(linked ? [{ t: "text" as const, text: pending }] : textRun(pending)),
		);
		pending = "";
	};
	for (const token of tokens ?? []) {
		switch (token.type) {
			case "text":
			case "escape":
			case "html":
				pending += token.text;
				continue;
			case "image":
				pending += (token as Tokens.Image).text;
				continue;
			case "br":
				flush();
				out.push({ t: "br" });
				continue;
			case "codespan":
				flush();
				out.push(
					linked
						? { t: "code", text: (token as Tokens.Codespan).text }
						: codeSpan((token as Tokens.Codespan).text),
				);
				continue;
			case "strong":
			case "em":
			case "del": {
				flush();
				const inner = token as Tokens.Strong | Tokens.Em | Tokens.Del;
				out.push({ t: token.type, children: inlines(inner.tokens, linked) });
				continue;
			}
			case "link": {
				flush();
				const link = token as Tokens.Link;
				const href = safeHref(link.href);
				const children = inlines(link.tokens, true);
				if (href === null) out.push(...children);
				else out.push({ t: "link", href, children });
				continue;
			}
			default:
				pending += token.raw;
		}
	}
	flush();
	return out;
}

function blocks(tokens: readonly Token[]): Block[] {
	const out: Block[] = [];
	for (const token of tokens) {
		switch (token.type) {
			case "paragraph":
			case "text": {
				const t = token as Tokens.Paragraph | Tokens.Text;
				out.push({
					t: "p",
					children: t.tokens ? inlines(t.tokens) : textRun(t.text),
				});
				break;
			}
			case "heading": {
				const h = token as Tokens.Heading;
				out.push({ t: "heading", level: h.depth, children: inlines(h.tokens) });
				break;
			}
			case "code": {
				const c = token as Tokens.Code;
				out.push({ t: "fence", lang: c.lang ?? "", text: c.text });
				break;
			}
			case "blockquote":
				out.push({
					t: "quote",
					children: blocks((token as Tokens.Blockquote).tokens),
				});
				break;
			case "list": {
				const l = token as Tokens.List;
				out.push({
					t: "list",
					ordered: l.ordered,
					start: l.ordered && typeof l.start === "number" ? l.start : 1,
					items: l.items.map((item) => blocks(item.tokens)),
				});
				break;
			}
			case "table": {
				const tb = token as Tokens.Table;
				out.push({
					t: "table",
					align: tb.align,
					head: tb.header.map((c) => inlines(c.tokens)),
					rows: tb.rows.map((row) => row.map((c) => inlines(c.tokens))),
				});
				break;
			}
			case "hr":
				out.push({ t: "hr" });
				break;
			case "html":
				out.push({
					t: "p",
					children: [{ t: "text", text: (token as Tokens.HTML).text.trim() }],
				});
				break;
			default:
				break;
		}
	}
	return out;
}

export const parseMarkdown = (source: string): Block[] => blocks(lexer(source));
