// FIGMA_ACCESS_EXPRESSION frente a lo MEDIDO en el archivo de pruebas (fixtures/cdp/access-state-measured.ts): se evalúa en un
// contexto con esas señales y debe dar el estado que le corresponde. «Solo lectura» aún no está medido.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";
import {
	ACCESS_STATE_MEASURED,
	type AccessSignals,
} from "../../../test/fixtures/cdp/access-state-measured.ts";
import { FIGMA_ACCESS, FIGMA_ACCESS_EXPRESSION } from "./protocol.ts";

const pageWith = (signals: AccessSignals) =>
	createContext({
		location: {
			pathname: signals.firstPathSegment
				? `/${signals.firstPathSegment}/KEY/Nombre`
				: "/",
		},
		...(signals.hasInitialOptions && {
			INITIAL_OPTIONS: {
				...(signals.hasUserData && { user_data: {} }),
				editing_file: { can_edit: signals.canEdit },
			},
		}),
		...(signals.figmaType === "object" && { figma: {} }),
	});

describe("FIGMA_ACCESS_EXPRESSION frente a las señales medidas", () => {
	it("la pestaña lista (figma, user_data y can_edit) da ready", () => {
		assert.equal(
			runInContext(
				FIGMA_ACCESS_EXPRESSION,
				pageWith(ACCESS_STATE_MEASURED.ready),
			),
			FIGMA_ACCESS.ready,
		);
	});

	it("la pestaña sin sesión (sin figma ni user_data, ruta aún en /design/) da notLoggedIn", () => {
		assert.equal(
			runInContext(
				FIGMA_ACCESS_EXPRESSION,
				pageWith(ACCESS_STATE_MEASURED.noSession),
			),
			FIGMA_ACCESS.notLoggedIn,
		);
	});

	it("la pestaña recién creada, sin navegar (sin ruta ni INITIAL_OPTIONS), da loading", () => {
		assert.equal(
			runInContext(
				FIGMA_ACCESS_EXPRESSION,
				pageWith(ACCESS_STATE_MEASURED.loadingBeforeNavigation),
			),
			FIGMA_ACCESS.loading,
		);
	});

	it("la página de Figma cargada pero sin la API de plugins (con user_data y can_edit) da loading", () => {
		assert.equal(
			runInContext(
				FIGMA_ACCESS_EXPRESSION,
				pageWith(ACCESS_STATE_MEASURED.loadingWithoutApi),
			),
			FIGMA_ACCESS.loading,
		);
	});
});
