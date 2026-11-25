import { type Block, type Inline, parseMarkdown } from "./markdown.ts";
import { refLabel } from "./ref-links.ts";

// El texto que ve quien lee un mensaje, sin la sintaxis de Markdown: sobre él se busca y se resalta, así lo que se
// encuentra es lo que se ve (un enlace aporta su texto, un id de llamada su forma abreviada)
const inlineText = (nodes: readonly Inline[]): string =>
	nodes
		.map((n) => {
			switch (n.t) {
				case "text":
				case "code":
					return n.text;
				case "br":
					return "\n";
				case "node":
				case "call":
					return refLabel(n);
				default:
					return inlineText(n.children);
			}
		})
		.join("");

const blockText = (blocks: readonly Block[]): string =>
	blocks
		.map((b) => {
			switch (b.t) {
				case "p":
				case "heading":
					return inlineText(b.children);
				case "fence":
					return b.text;
				case "list":
					return b.items.map(blockText).join("\n");
				case "quote":
					return blockText(b.children);
				case "table":
					return [b.head, ...b.rows]
						.map((row) => row.map(inlineText).join(" "))
						.join("\n");
				default:
					return "";
			}
		})
		.join("\n");

export const plainTextOf = (body: string): string =>
	blockText(parseMarkdown(body));
