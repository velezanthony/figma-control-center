// Lo común de los tests del kit: un `figma` falso nuevo en globalThis y el kit que lo lee
import { createKit } from "../../../../kits/figma/kit.ts";
import { type FakeFigma, installFakeFigma } from "./fake-figma.ts";

export function setup(): {
	fake: FakeFigma;
	kit: ReturnType<typeof createKit>;
} {
	const fake = installFakeFigma();
	return { fake, kit: createKit() };
}

export const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);
