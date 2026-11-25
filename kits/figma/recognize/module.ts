// La forma de recognize@1: objeto con `contract`, `rules` con funciones `match` y `props`, y `after` opcional con
// funciones. Se comprueba al empezar el paso, antes de escribir nada.
import { fail } from "../core.ts";
import { RECOGNIZE_CONTRACT, type RecognizeModule } from "./types.ts";

const NEXT =
	'Corrige recognize.js del proyecto: un objeto { contract: "recognize@1", rules: { <set>: { match(), props() } }, after?: { <set>: función } }.';

const invalid = (why: string): never =>
	fail(
		"RECOGNIZE_INVALID",
		`El módulo recognize@1 no es válido: ${why}.`,
		NEXT,
	);

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

export function checkRecognize(value: unknown): RecognizeModule {
	if (!isObject(value)) return invalid("no es un objeto");
	if (value["contract"] !== RECOGNIZE_CONTRACT)
		return invalid(`\`contract\` tiene que ser «${RECOGNIZE_CONTRACT}»`);
	const rules = value["rules"];
	if (!isObject(rules)) return invalid("`rules` tiene que ser un objeto");
	for (const [name, rule] of Object.entries(rules)) {
		if (
			!isObject(rule) ||
			typeof rule["match"] !== "function" ||
			typeof rule["props"] !== "function"
		)
			return invalid(
				`la regla «${name}» tiene que tener las funciones \`match\` y \`props\``,
			);
	}
	const after = value["after"];
	if (after !== undefined) {
		if (!isObject(after)) return invalid("`after` tiene que ser un objeto");
		for (const [name, hook] of Object.entries(after)) {
			if (typeof hook !== "function")
				return invalid(`\`after.${name}\` tiene que ser una función`);
		}
	}
	return value as unknown as RecognizeModule;
}
