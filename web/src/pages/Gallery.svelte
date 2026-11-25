<script lang="ts">
import type { ActivityError, CallItem, ChatMessage, CaptureItem, ConnectionStatus, HistorySummary, PermissionRequest, SessionItem, SettingView } from "#web/lib/contract.ts";
import Badge, { BADGE_VARIANT } from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import CodeBlock from "#web/lib/ui/atoms/CodeBlock.svelte";
import CloseAgentButton from "#web/lib/ui/molecules/CloseAgentButton.svelte";
import EmptyState, { EMPTY_STATE_VARIANT } from "#web/lib/ui/molecules/EmptyState.svelte";
import Input from "#web/lib/ui/atoms/Input.svelte";
import Textarea from "#web/lib/ui/atoms/Textarea.svelte";
import Logo from "#web/lib/ui/atoms/Logo.svelte";
import Spinner from "#web/lib/ui/atoms/Spinner.svelte";
import Tab, { TAB_VARIANT } from "#web/lib/ui/atoms/Tab.svelte";
import { DEFAULT_FILTERS, type Filters } from "#web/lib/activity/filters.ts";
import { paginate } from "#web/lib/activity/paginate.ts";
import { DEFAULT_SORT, type SortState, toggleSort } from "#web/lib/activity/sort.ts";
import { replaceSearch, routeState } from "#web/lib/route.svelte.ts";
import { DASHBOARD_MODE } from "#web/lib/dashboard-mode.ts";
import { ROUTE_NAME } from "#web/lib/route.ts";
import ActivityTable from "#web/lib/ui/organisms/ActivityTable.svelte";
import CaptureGrid from "#web/lib/ui/organisms/CaptureGrid.svelte";
import DataTable from "#web/lib/ui/organisms/DataTable.svelte";
import EntryDetail from "#web/lib/ui/organisms/EntryDetail.svelte";
import FilterBar from "#web/lib/ui/organisms/FilterBar.svelte";
import JobsTable from "#web/lib/ui/organisms/JobsTable.svelte";
import KpiRow from "#web/lib/ui/organisms/KpiRow.svelte";
import Sidebar from "#web/lib/ui/organisms/Sidebar.svelte";
import TableFooter from "#web/lib/ui/organisms/TableFooter.svelte";
import Td from "#web/lib/ui/organisms/Td.svelte";
import Th from "#web/lib/ui/organisms/Th.svelte";
import Tr from "#web/lib/ui/organisms/Tr.svelte";
import Disclosure from "#web/lib/ui/molecules/Disclosure.svelte";
import PermissionCard from "#web/lib/ui/molecules/PermissionCard.svelte";
import PermissionNotice from "#web/lib/ui/molecules/PermissionNotice.svelte";
import FilterDropdown from "#web/lib/ui/molecules/FilterDropdown.svelte";
import KpiCard from "#web/lib/ui/molecules/KpiCard.svelte";
import NavItem from "#web/lib/ui/molecules/NavItem.svelte";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import Paginator from "#web/lib/ui/molecules/Paginator.svelte";
import PerPage from "#web/lib/ui/molecules/PerPage.svelte";
import ResultsCount from "#web/lib/ui/molecules/ResultsCount.svelte";
import SearchBar from "#web/lib/ui/molecules/SearchBar.svelte";
import SectionCard from "#web/lib/ui/molecules/SectionCard.svelte";
import Modal from "#web/lib/ui/molecules/Modal.svelte";
import TabGroup from "#web/lib/ui/molecules/TabGroup.svelte";
import ThemeToggle from "#web/lib/ui/molecules/ThemeToggle.svelte";
import { themeState, toggleTheme } from "#web/lib/theme.svelte.ts";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import { ICONS, type IconName } from "#web/lib/ui/icons/icons.ts";
import Select from "#web/lib/ui/atoms/Select.svelte";
import ChatBubble from "#web/lib/ui/molecules/ChatBubble.svelte";
import ChatHelp from "#web/lib/ui/molecules/ChatHelp.svelte";
import ChatComposer from "#web/lib/ui/molecules/ChatComposer.svelte";
import Markdown from "#web/lib/ui/molecules/Markdown.svelte";
import Highlighted from "#web/lib/ui/atoms/Highlighted.svelte";
import ChatSearchBar from "#web/lib/ui/molecules/ChatSearchBar.svelte";
import VirtualList from "#web/lib/ui/atoms/VirtualList.svelte";
import RefChip from "#web/lib/ui/atoms/RefChip.svelte";
import SessionPicker from "#web/lib/ui/molecules/SessionPicker.svelte";
import ProjectSelector from "#web/lib/ui/molecules/ProjectSelector.svelte";
import ProjectIndicator from "#web/lib/ui/molecules/ProjectIndicator.svelte";
import ThinkingIndicator from "#web/lib/ui/molecules/ThinkingIndicator.svelte";
import { parseMarkdown } from "#web/lib/chat/markdown.ts";
import ChatThread from "#web/lib/ui/organisms/ChatThread.svelte";
import StatusDot from "#web/lib/ui/atoms/StatusDot.svelte";
import ProgressBar from "#web/lib/ui/atoms/ProgressBar.svelte";
import BuildSteps from "#web/lib/ui/organisms/BuildSteps.svelte";
import type { GroupId } from "#web/lib/glossary/terms.ts";
import Glossary from "#web/lib/ui/organisms/Glossary.svelte";
import ResetAllSettings from "#web/lib/ui/organisms/ResetAllSettings.svelte";
import SettingRow from "#web/lib/ui/organisms/SettingRow.svelte";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";
import FlowDiagram from "#web/lib/ui/molecules/FlowDiagram.svelte";
import LatestActivity from "#web/lib/ui/organisms/LatestActivity.svelte";
import SectionLinks from "#web/lib/ui/organisms/SectionLinks.svelte";
import StatusPanel from "#web/lib/ui/organisms/StatusPanel.svelte";
import { SECTIONS } from "#web/lib/home/sections.ts";
import { statusRows } from "#web/lib/home/status.ts";
import ArgList from "#web/lib/ui/molecules/ArgList.svelte";
import DetailSection from "#web/lib/ui/molecules/DetailSection.svelte";
import ErrorBlock from "#web/lib/ui/molecules/ErrorBlock.svelte";
import DiffView from "#web/lib/ui/molecules/DiffView.svelte";
import AttemptsTable from "#web/lib/ui/organisms/AttemptsTable.svelte";
import AttemptTimeline from "#web/lib/ui/organisms/AttemptTimeline.svelte";
import { DEMO_ATTEMPT_ROWS, DEMO_ATTEMPT_TARGETS, DEMO_HUNKS } from "#web/lib/attempts/demo.ts";
import NodeLinks from "#web/lib/ui/molecules/NodeLinks.svelte";
import ResultLabel from "#web/lib/ui/molecules/ResultLabel.svelte";
import Thumbnail from "#web/lib/ui/atoms/Thumbnail.svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";

// Imagen de ejemplo sin colores propios: un cuadrado que toma el negro por defecto del SVG
const SAMPLE_IMAGE = "/samples/capture.svg";

let demoQuery = $state("");
let demoTool = $state("");
let demoPage = $state(3);
let demoPerPage = $state(25);
let demoTab = $state("a");
let demoModal = $state(false);
let demoSegment = $state("hoy");
let demoGlossaryGroup = $state<GroupId | null>(null);
const DEMO_TOOLS = [
	{ value: "figma_status", label: "figma_status" },
	{ value: "figma_run_script", label: "figma_run_script" },
	{ value: "figma_screenshot", label: "figma_screenshot" },
];
const ICON_NAMES = Object.keys(ICONS) as IconName[];
const SAMPLE_FILE_URL = "https://www.figma.com/design/ABC123/Archivo-de-ejemplo";
const SAMPLE_ERROR: ActivityError = {
	type: "ScriptError",
	message: "SyntaxError: Unexpected token ';' (línea 3)",
	nextStep: "Corrige el script y vuelve a ejecutarlo.",
	line: 3,
};
const entry = (over: Partial<CallItem>): CallItem => ({
	callId: "11111111-aaaa",
	sessionId: "s1",
	fileUrl: SAMPLE_FILE_URL,
	tool: "figma_run_script",
	startedAt: "2026-01-01T00:00:00.000Z",
	args: { file: "scripts/a.js", format: "body" },
	status: "ok",
	ms: 1500,
	retryable: null,
	touchedNodeIds: ["1:23"],
	error: null,
	resultPath: "/ruta/output/result-ejemplo.json",
	jobId: null,
	job: null,
	screenshots: [],
	summary: "figma_run_script scripts/a.js → 1 nodo, 1500 ms",
	...over,
});
// SettingRow: un ajuste en cada estado (por defecto, guardado, entorno, guardado que no vale, error, pendiente de reinicio)
const SAMPLE_SETTING: SettingView = {
	key: "FCC_SOFT_DEADLINE_MS",
	group: "Scripts y lotes",
	name: "Plazo blando de un script",
	help: "Pasado este tiempo, figma_run_script responde que sigue en marcha y da un jobId.",
	unit: "ms",
	usedBy: ["agent"],
	stored: null,
	effective: 20_000,
	origin: "default",
	default: 20_000,
	running: 20_000,
};
const SAMPLE_SETTING_ROWS: readonly { label: string; setting: SettingView; problem?: string; error?: string }[] = [
	{ label: "Por defecto", setting: SAMPLE_SETTING },
	{ label: "Guardado en el panel", setting: { ...SAMPLE_SETTING, stored: "300000", effective: 300_000, origin: "panel", running: 300_000 } },
	{ label: "Fijado en el entorno, con un valor guardado debajo", setting: { ...SAMPLE_SETTING, stored: "300000", effective: 15_000, origin: "env", running: 15_000 } },
	{
		label: "Guardado que no vale",
		setting: { ...SAMPLE_SETTING, stored: "abc" },
		problem: "ajuste ignorado: «FCC_SOFT_DEADLINE_MS»: Tiene que ser un número entero.",
	},
	{ label: "Error al guardar", setting: SAMPLE_SETTING, error: "Tiene que ser un número entero mayor que 0." },
	{
		label: "Pendiente de reinicio (lo usa el panel)",
		setting: { ...SAMPLE_SETTING, key: "FCC_LIVE_POLL_MS", group: "Panel", name: "Sondeo en vivo del panel", help: "Cada cuánto mira el panel si hay actividad o mensajes de chat nuevos.", usedBy: ["panel"], stored: "900", effective: 900, origin: "panel", default: 500, running: 500 },
	},
];

const SAMPLE_CALLS: CallItem[] = [
	entry({}),
	entry({ callId: "22222222-bbbb", status: "error", error: SAMPLE_ERROR, retryable: true, ms: 65, touchedNodeIds: [], resultPath: null }),
	entry({ callId: "33333333-cccc", tool: "figma_status", args: {}, ms: 90, touchedNodeIds: [], resultPath: null }),
];
const SAMPLE_SESSIONS: SessionItem[] = [
	{ sessionId: "s1", pid: 4242, fileUrl: SAMPLE_FILE_URL, startedAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:30.000Z", calls: 3, writes: 1, errors: 1, totalMs: 1655 },
];
const SAMPLE_STATUS: ConnectionStatus = { at: "2026-01-01T00:00:10.000Z", chromeReachable: true, tabFound: true, figmaReady: true, fileName: "Archivo", pageName: "Página 1" };
const SAMPLE_SUMMARY: HistorySummary = {
	range: { fromMs: null, toMs: null, sessionId: null },
	calls: 42,
	writes: 12,
	errors: 3,
	running: 1,
	meanMs: 180,
	p95Ms: 950,
	jobs: 2,
	nodesTouched: 17,
	topTools: [{ tool: "figma_run_script", calls: 30, errors: 3 }],
};
const SAMPLE_REPLY = [
	"## Resumen de la última hora",
	"",
	"Hubo **12 llamadas**: 4 escrituras y *1 error*. Lo más relevante:",
	"",
	"- `figma_run_script` falló con `ScriptError` en la llamada `3f9a1c2e-aaaa-4bbb-8ccc-0123456789ab`",
	"- Se tocaron los nodos `1234:5678` y `9:10` (también en texto: 1234:5678)",
	"",
	"| Herramienta | Llamadas | Errores |",
	"|---|--:|--:|",
	"| figma_run_script | 8 | 1 |",
	"| figma_screenshot | 4 | 0 |",
	"",
	"```js",
	"figma.currentPage.selection = [];",
	"```",
	"",
	"> Ojo con \x3cscript>alert(1)\x3c/script> y [enlaces raros](javascript:alert(1)); aquí no ejecutan nada.",
].join("\n");
const SAMPLE_CHAT_SESSIONS = [
	{ sessionId: "3f9d5c00-aaaa-4bbb-8ccc-0123456789ab", pid: 4242, startedAt: "2026-01-01T10:59:30.000Z", lastSeenAt: "2026-01-01T11:59:00.000Z", alive: true },
	{ sessionId: "7a1b2c3d-aaaa-4bbb-8ccc-0123456789ab", pid: null, startedAt: "2026-01-01T09:15:00.000Z", lastSeenAt: "2026-01-01T09:20:00.000Z", alive: true },
];
const SAMPLE_ROWS = Array.from({ length: 1000 }, (_, i) => i);
let sampleDraft = $state("");
let sampleSession = $state(SAMPLE_CHAT_SESSIONS[0]?.sessionId ?? "");

const SAMPLE_PROJECTS = [
	{ id: "ejemplo", name: "Ejemplo" },
	{ id: "cliente", name: "Cliente ACME" },
] as const;
let sampleProject = $state("ejemplo");
const SAMPLE_CHAT: ChatMessage[] = [
	{ id: 1, sessionId: "s1", direction: "in", chatId: "c1", body: "¿Qué se hizo en la última hora?", at: "2026-01-01T10:00:00.000Z", status: "delivered" },
	{ id: 2, sessionId: "s1", direction: "out", chatId: "c1", body: SAMPLE_REPLY, at: "2026-01-01T10:00:09.000Z", status: "delivered" },
	{ id: 3, sessionId: "s1", direction: "in", chatId: "c3", body: "¿Y qué nodos tocó?", at: "2026-01-01T10:00:30.000Z", status: "delivered" },
];
const SAMPLE_PERMISSION: Omit<PermissionRequest, "id" | "status" | "decidedAt"> = {
	sessionId: "s1",
	requestId: "abcde",
	toolName: "Bash",
	description: "Lista los archivos del directorio",
	inputPreview: '{ "command": "ls -la <b>no es html</b>" }',
	at: "2026-01-01T10:01:00.000Z",
};
// Una herramienta MCP con su descripción entera (escrita para Claude) y parámetros con rutas largas
const SAMPLE_LONG_DESCRIPTION =
	"Reconstruye un área en una sola llamada: ejecuta en orden los pasos de un manifiesto (ruta) o de una lista corta (`steps`). Responde en cuanto acepta el lote, con status=running, el jobId y el plan entero en `steps`; un error de validación llega en esta misma respuesta, sin job y sin tocar Figma. El lote corre en segundo plano: espera su final con figma_get_job y cancélalo con figma_cancel_job cuando quieras.";
const SAMPLE_LONG_INPUT =
	'{"steps":[{"file":"/home/usuario/proyectos/ejemplo/scripts/componentes/formularios/01-crear-variables.js","format":"body"},{"file":"/home/usuario/proyectos/ejemplo/scripts/componentes/formularios/02-construir-variantes.js","format":"body"}],"stopOnError":true}';
// Un lote que no cabe en seis líneas: sale recortado con «Ver todo»
const SAMPLE_HUGE_INPUT = JSON.stringify({
	steps: Array.from({ length: 10 }, (_, i) => ({ file: `/home/usuario/proyectos/ejemplo/scripts/componentes/formularios/${String(i + 1).padStart(2, "0")}-paso.js`, format: "body" })),
	stopOnError: true,
});
const SAMPLE_PERMISSIONS: PermissionRequest[] = [
	{ ...SAMPLE_PERMISSION, id: 1, status: "allowed", decidedAt: "2026-01-01T10:01:05.000Z" },
	{ ...SAMPLE_PERMISSION, id: 2, toolName: "Write", requestId: "fghij", description: "Escribe un archivo", inputPreview: '{ "file_path": "/tmp/x", "content": "hola" }', status: "pending", decidedAt: null },
];
const SECTION = Object.freeze({ foundations: "foundations", atoms: "atoms", molecules: "molecules", organisms: "organisms" } as const);
const SECTION_TABS = [
	{ id: SECTION.foundations, label: "Fundamentos" },
	{ id: SECTION.atoms, label: "Átomos" },
	{ id: SECTION.molecules, label: "Moléculas" },
	{ id: SECTION.organisms, label: "Organismos" },
];
const section = $derived(new URLSearchParams(routeState.search).get("s") ?? SECTION.foundations);
const selectSection = (id: string) => replaceSearch(`s=${id}`);

const SAMPLE_JOB_ENTRY = entry({
	callId: "44444444-dddd",
	args: { file: "scripts/larga.js", format: "body" },
	jobId: "job-5555-eeee",
	job: { status: "running", ms: null, error: null, touchedNodeIds: [] },
	startedAt: "2026-01-01T00:00:40.000Z",
});
const SAMPLE_SHOT_ENTRY = entry({
	callId: "66666666-ffff",
	tool: "figma_screenshot",
	args: { nodeId: "1:23" },
	startedAt: "2026-01-01T00:00:50.000Z",
	screenshots: [{ nodeId: "1:23", path: "/samples/capture.svg", width: 320, height: 200 }],
});
const DEMO_ENTRIES = [...SAMPLE_CALLS, SAMPLE_JOB_ENTRY, SAMPLE_SHOT_ENTRY];
const DEMO_JOBS = DEMO_ENTRIES.filter((e) => e.job !== null);

const SAMPLE_STEPS = [
	{ index: 0, file: "build_home.js", status: "done", ms: 1200, touchedCount: 8, error: null, warning: null, result: { kind: "inline", excerpt: '{"movedCount":8,"wrappedCount":2,"log":["Movido home","Envuelto hero"', bytes: 1840, truncated: true } },
	{ index: 1, file: "swap.js", status: "running", ms: null, touchedCount: 0, error: null, warning: null, result: null },
	{ index: 2, file: "publish.js", status: "pending", ms: null, touchedCount: 0, error: null, warning: null, result: null },
] as const;
const SAMPLE_STEPS_CANCELLED = [
	{ index: 0, file: "build_home.js", status: "done", ms: 1200, touchedCount: 8, error: null, warning: null, result: { kind: "file", path: "/home/usuario/proyecto/output/result-2026-01-01.json", bytes: 90000 } },
	{ index: 1, file: "swap.js", status: "failed", ms: 420, touchedCount: 0, error: SAMPLE_ERROR, warning: null, result: null },
	{ index: 2, file: "publish.js", status: "cancelled", ms: null, touchedCount: 0, error: null, warning: null, result: null },
] as const;
const DEMO_CAPTURES: CaptureItem[] = DEMO_ENTRIES.flatMap((call) => call.screenshots.map((shot) => ({ call, shot })));
const sampleImage = () => SAMPLE_IMAGE;

let demoFilters = $state<Filters>(DEFAULT_FILTERS);
let demoSort = $state<SortState>(DEFAULT_SORT);
let demoOpen = $state<string | null>("11111111-aaaa");
const NO_TIMERS: ReadonlySet<string> = new Set(["22222222-bbbb"]);
const DEMO_WINDOW = paginate(180, 3, 25);
const MISSING_IMAGE = "/screenshots/no-existe.png";

const HOME_OK = statusRows({ connection: "open", status: SAMPLE_STATUS, agentActive: true, agentWaiting: false });
const HOME_PROBLEMS = statusRows({ connection: "closed", status: { ...SAMPLE_STATUS, chromeReachable: false, tabFound: false, figmaReady: false }, agentActive: false, agentWaiting: false });

const SAMPLE_JSON = `{
  "ok": true,
  "touchedNodeIds": ["1:23", "1:24"],
  "result": { "created": 2 }
}`;

// Clases literales: Tailwind no ve las que se construyen por partes
const BRAND = [
	["brand-50", "bg-brand-50"],
	["brand-100", "bg-brand-100"],
	["brand-200", "bg-brand-200"],
	["brand-300", "bg-brand-300"],
	["brand-400", "bg-brand-400"],
	["brand-500", "bg-brand-500"],
	["brand-600", "bg-brand-600"],
	["brand-700", "bg-brand-700"],
	["brand-800", "bg-brand-800"],
	["brand-900", "bg-brand-900"],
] as const;
const FEEDBACK = [
	["success-50", "bg-success-50"],
	["success-500", "bg-success-500"],
	["success-700", "bg-success-700"],
	["danger-50", "bg-danger-50"],
	["danger-500", "bg-danger-500"],
	["danger-700", "bg-danger-700"],
	["warning-50", "bg-warning-50"],
	["warning-500", "bg-warning-500"],
	["warning-700", "bg-warning-700"],
	["info-50", "bg-info-50"],
	["info-500", "bg-info-500"],
	["info-700", "bg-info-700"],
] as const;
const STRUCTURE = [
	["canvas", "bg-canvas"],
	["surface", "bg-surface"],
	["surface-raised", "bg-surface-raised"],
	["border", "bg-border"],
	["border-strong", "bg-border-strong"],
	["focus", "bg-focus"],
	["ink", "bg-ink"],
	["ink-hover", "bg-ink-hover"],
] as const;
const TEXT = [
	["text-primary", "text-text-primary"],
	["text-secondary", "text-text-secondary"],
	["text-muted", "text-text-muted"],
] as const;
</script>

<PageHeader>
	{#snippet title()}Componentes{/snippet}
	{#snippet description()}Mini design system del panel, con un lenguaje visual propio. Cada componente con sus variantes y estados; hover y foco se prueban con ratón y teclado.{/snippet}
</PageHeader>

<div class="mb-8">
	<TabGroup label="Secciones de la galería" tabs={SECTION_TABS} selected={section} onselect={selectSection} />
</div>

<div class="flex flex-col gap-10">
	{#if section === SECTION.atoms}
		<h2 class="text-lg font-bold text-text-primary">Átomos</h2>
		<p class="-mt-8 text-sm text-text-secondary">Piezas básicas: solo usan iconos y otros átomos.</p>
	<section class="flex flex-col gap-4" aria-labelledby="g-button">
		<h3 id="g-button" class="text-base font-semibold text-text-primary">Button</h3>
		<div class="flex flex-wrap items-center gap-3">
			<Button variant={BUTTON_VARIANT.primary}>Guardar cambios</Button>
			<Button variant={BUTTON_VARIANT.secondary}>Cancelar</Button>
			<Button variant={BUTTON_VARIANT.tertiary}>Ver detalle</Button>
			<Button variant={BUTTON_VARIANT.danger}>Borrar historial</Button>
			<Button variant={BUTTON_VARIANT.ghost}>Ghost</Button>
			<Button variant={BUTTON_VARIANT.link}>Enlace</Button>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<Button variant={BUTTON_VARIANT.primary} disabled>Deshabilitado</Button>
			<Button variant={BUTTON_VARIANT.secondary} disabled>Deshabilitado</Button>
			<Button variant={BUTTON_VARIANT.danger}>Cancelar</Button>
			<Button variant={BUTTON_VARIANT.danger} disabled>Cancelar</Button>
			<Button variant={BUTTON_VARIANT.primary} loading>Cargando</Button>
			<Button variant={BUTTON_VARIANT.secondary} href="#/components">Como enlace</Button>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<Button size="sm" variant={BUTTON_VARIANT.primary}>Pequeño</Button>
			<Button size="md" variant={BUTTON_VARIANT.primary}>Mediano</Button>
			<Button size="lg" variant={BUTTON_VARIANT.primary}>Grande</Button>
			<Button variant={BUTTON_VARIANT.primary} shape="pill">Pill</Button>
			<Button shape="icon" size="sm" aria-label="Cerrar"><Icon name="x-mark" /></Button>
			<Button shape="icon" aria-label="Copiar"><Icon name="document-duplicate" /></Button>
			<Button shape="icon" size="lg" aria-label="Menú"><Icon name="bars-3" size="md" /></Button>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-badge">
		<h3 id="g-badge" class="text-base font-semibold text-text-primary">Badge</h3>
		<div class="flex flex-wrap items-center gap-3">
			<Badge>Secundario</Badge>
			<Badge variant={BADGE_VARIANT.primary}>Principal</Badge>
			<Badge variant={BADGE_VARIANT.success}>Correcto</Badge>
			<Badge variant={BADGE_VARIANT.danger}>Error</Badge>
			<Badge variant={BADGE_VARIANT.warning}>Aviso</Badge>
			<Badge variant={BADGE_VARIANT.info}>Info</Badge>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<Badge dot>Secundario</Badge>
			<Badge variant={BADGE_VARIANT.primary} dot>Principal</Badge>
			<Badge variant={BADGE_VARIANT.success} dot>Correcto</Badge>
			<Badge variant={BADGE_VARIANT.danger} dot>Error</Badge>
			<Badge variant={BADGE_VARIANT.warning} dot>En curso</Badge>
			<Badge variant={BADGE_VARIANT.info} dot>Info</Badge>
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<Badge size="sm" variant={BADGE_VARIANT.primary}>sm</Badge>
			<Badge size="md" variant={BADGE_VARIANT.primary}>md</Badge>
			<Badge size="lg" variant={BADGE_VARIANT.primary}>lg</Badge>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-dot">
		<h3 id="g-dot" class="text-base font-semibold text-text-primary">StatusDot</h3>
		<div class="flex flex-wrap items-center gap-6">
			<StatusDot state="ok">Conectado</StatusDot>
			<StatusDot state="error">Sin conexión</StatusDot>
			<StatusDot state="warning">Sin pestaña de Figma</StatusDot>
			<StatusDot state="info">Información</StatusDot>
			<StatusDot state="idle">Inactiva</StatusDot>
			<StatusDot state="running">En curso</StatusDot>
			<StatusDot state="ok" size="sm">Tamaño pequeño</StatusDot>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-progress">
		<h3 id="g-progress" class="text-base font-semibold text-text-primary">ProgressBar</h3>
		<div class="flex max-w-md flex-col gap-3">
			<ProgressBar done={0} total={5} label="Progreso del lote" />
			<ProgressBar done={3} total={5} label="Progreso del lote" />
			<ProgressBar done={5} total={5} tone="success" label="Lote terminado" />
			<ProgressBar done={2} total={5} tone="danger" label="Lote cancelado" />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-input">
		<h3 id="g-input" class="text-base font-semibold text-text-primary">Input</h3>
		<div class="grid max-w-3xl gap-3 sm:grid-cols-2">
			<Input aria-label="Normal" placeholder="Normal" />
			<Input aria-label="Con icono" placeholder="Con icono">
				{#snippet icon()}<Icon name="magnifying-glass" />{/snippet}
			</Input>
			<Input aria-label="Pequeño" size="sm" placeholder="Pequeño" />
			<Input aria-label="Grande" size="lg" placeholder="Grande" />
			<Input aria-label="Con error" invalid value="valor no válido" />
			<Input aria-label="Deshabilitado" disabled value="Deshabilitado" />
			<Input aria-label="Solo lectura" readonly value="Solo lectura" />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-textarea">
		<h3 id="g-textarea" class="text-base font-semibold text-text-primary">Textarea</h3>
		<div class="grid max-w-3xl gap-3 sm:grid-cols-2">
			<Textarea aria-label="Normal" placeholder="Normal" />
			<Textarea aria-label="Monoespaciado" mono size="sm" rows={2} value={"~/proyectos/uno/scripts\n~/proyectos/dos/scripts"} />
			<Textarea aria-label="Con error" invalid value="valor no válido" rows={2} />
			<Textarea aria-label="Deshabilitado" disabled value="Deshabilitado" rows={2} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-select">
		<h3 id="g-select" class="text-base font-semibold text-text-primary">Select</h3>
		<div class="grid max-w-3xl gap-3 sm:grid-cols-3">
			<Select>
				{#snippet label()}Herramienta{/snippet}
				<option value="">Todas</option>
				<option value="figma_status">figma_status</option>
			</Select>
			<Select size="sm" aria-label="Pequeño">
				<option value="">Tamaño pequeño</option>
			</Select>
			<Select invalid aria-label="Con error">
				<option value="">Con error</option>
			</Select>
			<Select disabled aria-label="Deshabilitado">
				<option value="">Deshabilitado</option>
			</Select>
			<Select compact aria-label="Solo icono">
				{#snippet icon()}<Icon name="server-stack" size="md" />{/snippet}
				<option value="">Solo icono</option>
			</Select>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-tab">
		<h3 id="g-tab" class="text-base font-semibold text-text-primary">Tab</h3>
		<div role="tablist" aria-label="Ejemplo subrayado" class="flex items-start gap-0.5 px-1 inset-shadow-[0_-1px_0_0] inset-shadow-border">
			<Tab selected count={12}>Actividad</Tab>
			<Tab count={3}>Errores</Tab>
			<Tab>Sesiones</Tab>
		</div>
		<div role="tablist" aria-label="Ejemplo segmentado" class="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-surface-raised p-0.75">
			<Tab variant={TAB_VARIANT.segmented} selected>Hoy</Tab>
			<Tab variant={TAB_VARIANT.segmented}>Semana</Tab>
			<Tab variant={TAB_VARIANT.segmented} size="sm">Mes</Tab>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-logo">
		<h3 id="g-logo" class="text-base font-semibold text-text-primary">Logo</h3>
		<div class="flex flex-wrap items-center gap-4"><Logo /><Logo size="lg" /></div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-refchip">
		<h3 id="g-refchip" class="text-base font-semibold text-text-primary">RefChip</h3>
		<div class="flex flex-wrap items-center gap-3 text-sm">
			<RefChip href={`#/activity?open=${SAMPLE_CHAT_SESSIONS[0]?.sessionId}`} label="3f9d5c00" title="3f9d5c00-aaaa-4bbb-8ccc-0123456789ab" />
			<RefChip href={`${SAMPLE_FILE_URL}?node-id=1234-5678`} label="1234:5678" title="1234:5678" chip external />
			<RefChip href={null} label="9:10" title="Sin archivo de Figma conocido" chip />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-highlighted">
		<h3 id="g-highlighted" class="text-base font-semibold text-text-primary">Highlighted</h3>
		<p class="max-w-xl text-sm text-text-primary"><Highlighted text="La ACCIÓN falló en el nodo 12:34; otra acción distinta" query="accion" /></p>
		<p class="max-w-xl text-sm text-text-primary"><Highlighted text="Resultado activo: acción" query="accion" active /></p>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-virtuallist">
		<h3 id="g-virtuallist" class="text-base font-semibold text-text-primary">VirtualList</h3>
		<p class="text-sm text-text-secondary">Mil filas de altura variable; solo se montan las visibles y un colchón (mira el DOM).</p>
		<div class="h-64 max-w-md rounded-xl border border-border bg-surface">
			<VirtualList items={SAMPLE_ROWS} keyOf={(n) => n} label="Mil filas de ejemplo" estimate={48} overscan={1}>
				{#snippet row(n)}<p class="px-4 text-sm text-text-primary" style:padding-block="{8 + (n % 5) * 8}px">Fila {n}</p>{/snippet}
			</VirtualList>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-spinner">
		<h3 id="g-spinner" class="text-base font-semibold text-text-primary">Spinner</h3>
		<div class="flex flex-wrap items-center gap-6 text-brand-600">
			<Spinner size="sm" /><Spinner size="md" /><Spinner size="lg" />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-thumb">
		<h3 id="g-thumb" class="text-base font-semibold text-text-primary">Thumbnail</h3>
		<div class="flex flex-wrap items-end gap-4">
			<Thumbnail src={SAMPLE_IMAGE} alt="Ejemplo pequeño" size="sm" />
			<Thumbnail src={SAMPLE_IMAGE} alt="Ejemplo mediano" size="md" />
			<Thumbnail src={SAMPLE_IMAGE} alt="Ejemplo grande" size="lg" />
			<Thumbnail src={MISSING_IMAGE} alt="Captura que no existe" size="md" />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-code">
		<h3 id="g-code" class="text-base font-semibold text-text-primary">CodeBlock</h3>
		<CodeBlock>{SAMPLE_JSON}</CodeBlock>
		<CodeBlock size="sm">/home/usuario/proyecto/output/result-2026-01-01.json</CodeBlock>
		<CodeBlock size="sm" wrap>{SAMPLE_LONG_INPUT}</CodeBlock>
		<CodeBlock size="sm" collapse>{SAMPLE_LONG_INPUT}</CodeBlock>
		<CodeBlock size="sm" collapse>{SAMPLE_HUGE_INPUT}</CodeBlock>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-tooltip">
		<h3 id="g-tooltip" class="text-base font-semibold text-text-primary">Tooltip</h3>
		<div class="flex flex-wrap items-center gap-6 pt-8">
			<Tooltip>
				{#snippet children(trigger)}
					<Button {...trigger}>Pasa el ratón o enfoca</Button>
				{/snippet}
				{#snippet content()}Aparece con ratón y con teclado; Esc lo cierra{/snippet}
			</Tooltip>
			<Tooltip placement="bottom">
				{#snippet children(trigger)}
					<Button variant={BUTTON_VARIANT.ghost} {...trigger}>Debajo</Button>
				{/snippet}
				{#snippet content()}Colocado bajo el disparador{/snippet}
			</Tooltip>
			<div class="w-64">
				<Tooltip placement="bottom" fill>
					{#snippet children(trigger)}
						<Input aria-label="Ocupa todo el ancho" value="Disparador a todo el ancho" {...trigger} />
					{/snippet}
					{#snippet content()}El disparador sigue llenando su contenedor{/snippet}
				</Tooltip>
			</div>
			<div class="h-14 overflow-hidden rounded-xl border border-border p-3" data-demo="tooltip-overflow">
				<Tooltip placement="bottom">
					{#snippet children(trigger)}
						<Button variant={BUTTON_VARIANT.ghost} size="sm" {...trigger}>Dentro de un contenedor con overflow</Button>
					{/snippet}
					{#snippet content()}No lo recorta el contenedor{/snippet}
				</Tooltip>
			</div>
		</div>
	</section>

	{:else if section === SECTION.molecules}
		<h2 class="text-lg font-bold text-text-primary">Moléculas</h2>
		<p class="-mt-8 text-sm text-text-secondary">Componen átomos (u otras moléculas) y se reutilizan en varias pantallas.</p>
	<section class="flex flex-col gap-4" aria-labelledby="g-search">
		<h3 id="g-search" class="text-base font-semibold text-text-primary">SearchBar</h3>
		<div class="max-w-md"><SearchBar bind:value={demoQuery} label="Buscar" placeholder="Buscar herramienta, ruta o nodo" /></div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-filterdd">
		<h3 id="g-filterdd" class="text-base font-semibold text-text-primary">FilterDropdown</h3>
		<div class="flex flex-wrap items-start gap-3">
			<FilterDropdown label="Herramienta" options={DEMO_TOOLS} value={demoTool} onchange={(v) => (demoTool = v)} />
			<FilterDropdown label="Estado" options={DEMO_TOOLS} value="figma_status" onchange={() => {}} />
			<div class="h-16 overflow-hidden rounded-xl border border-border p-3" data-demo="filter-overflow">
				<FilterDropdown label="Con overflow" options={DEMO_TOOLS} value="" onchange={() => {}} />
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-kpi">
		<h3 id="g-kpi" class="text-base font-semibold text-text-primary">KpiCard</h3>
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<KpiCard value="42">
				{#snippet title()}Llamadas{/snippet}
				{#snippet icon()}<Icon name="bolt" size="md" />{/snippet}
			</KpiCard>
			<KpiCard valueTone="danger" value="3">
				{#snippet title()}Errores{/snippet}
				{#snippet icon()}<Icon name="exclamation-triangle" size="md" />{/snippet}
				{#snippet description()}7 % de las llamadas{/snippet}
			</KpiCard>
			<KpiCard value="180" unit="ms">
				{#snippet title()}Duración media{/snippet}
				{#snippet icon()}<Icon name="clock" size="md" />{/snippet}
				{#snippet help()}Media de las llamadas terminadas{/snippet}
			</KpiCard>
			<KpiCard value="—" valueTone="muted">
				{#snippet title()}Sin datos{/snippet}
			</KpiCard>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-pageheader">
		<h3 id="g-pageheader" class="text-base font-semibold text-text-primary">PageHeader</h3>
		<PageHeader>
			{#snippet title()}Actividad{/snippet}
			{#snippet meta()}<Badge variant={BADGE_VARIANT.success} dot>En vivo</Badge>{/snippet}
			{#snippet description()}42 llamadas en Archivo de ejemplo{/snippet}
			{#snippet actions()}<Button variant={BUTTON_VARIANT.primary} href="#/components"><Icon name="arrow-top-right-on-square" />Abrir en Figma</Button>{/snippet}
		</PageHeader>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-nav">
		<h3 id="g-nav" class="text-base font-semibold text-text-primary">NavItem</h3>
		<!-- El NavItem vive en la barra lateral: se enseña sobre su fondo oscuro -->
		<div class="theme-sidebar flex flex-wrap items-start gap-8 rounded-xl py-4">
			<div class="flex w-56 flex-col gap-1">
				<NavItem href="#/components" active>{#snippet icon()}<Icon name="squares-2x2" size="md" />{/snippet}Actividad</NavItem>
				<NavItem href="#/components">{#snippet icon()}<Icon name="clock" size="md" />{/snippet}Jobs</NavItem>
			</div>
			<div class="flex w-20 flex-col gap-1 pb-10">
				<NavItem href="#/components" collapsed active>{#snippet icon()}<Icon name="squares-2x2" size="md" />{/snippet}Actividad</NavItem>
			</div>
			<div class="flex w-56 flex-col gap-1 pb-10">
				<NavItem href="#/components" disabledReason="Crea o elige un proyecto para ver esto">{#snippet icon()}<Icon name="photo" size="md" />{/snippet}Capturas</NavItem>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-count">
		<h3 id="g-count" class="text-base font-semibold text-text-primary">ResultsCount, PerPage y Paginator</h3>
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex flex-col gap-1.5">
				<ResultsCount from={51} to={75} total={180} />
				<PerPage value={demoPerPage} choices={[10, 25, 50, 100]} onchange={(v) => (demoPerPage = v)} />
			</div>
			<Paginator page={demoPage} pageCount={12} onpage={(p) => (demoPage = p)} />
		</div>
		<ResultsCount from={0} to={0} total={0} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-diffview">
		<h3 id="g-diffview" class="text-base font-semibold text-text-primary">DiffView</h3>
		<p class="text-sm text-text-secondary">Bloques de cambio con números de línea de los dos lados y signo; con el foco en la región, n y p saltan de bloque.</p>
		<DiffView label="Cambios de step (ejemplo)" hunks={DEMO_HUNKS} />
		<DiffView label="Recortado (ejemplo)" hunks={DEMO_HUNKS} truncated rawHref="#/components?s=molecules" />
		<DiffView label="Contenido (ejemplo)" mode="content" hunks={[DEMO_HUNKS[0] as (typeof DEMO_HUNKS)[number]]} />
		<div class="grid gap-4 md:grid-cols-2">
			<DiffView label="Demasiado grande (ejemplo)" hunks={[]} tooLarge rawHref="#/components?s=molecules" />
			<DiffView label="Solo hash (ejemplo)" hunks={[]} hashOnly={{ from: "a".repeat(64), to: "b".repeat(64) }} />
		</div>
		<DiffView label="Sin líneas (ejemplo)" hunks={[]} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-disclosure">
		<h3 id="g-disclosure" class="text-base font-semibold text-text-primary">Disclosure</h3>
		<Disclosure open>
			{#snippet icon()}<Icon name="cube" size="md" />{/snippet}
			{#snippet title()}Nodos tocados{/snippet}
			{#snippet subtitle()}Se abre y se cierra con clic, Enter o Espacio{/snippet}
			{#snippet actions()}<Badge variant={BADGE_VARIANT.primary}>2</Badge>{/snippet}
			Contenido de la sección desplegable.
		</Disclosure>
		<Disclosure>
			{#snippet title()}Cerrada por defecto{/snippet}
			Contenido.
		</Disclosure>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-sectioncard">
		<h3 id="g-sectioncard" class="text-base font-semibold text-text-primary">SectionCard</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<SectionCard>
				{#snippet title()}Con cabecera y pie{/snippet}
				{#snippet actions()}<Button size="sm" variant={BUTTON_VARIANT.ghost}>Acción</Button>{/snippet}
				Contenido principal
				{#snippet footer()}<Button size="sm" variant={BUTTON_VARIANT.primary}>Guardar</Button>{/snippet}
			</SectionCard>
			<SectionCard>Solo contenido</SectionCard>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-modal">
		<h3 id="g-modal" class="text-base font-semibold text-text-primary">Modal</h3>
		<div>
			<Button variant={BUTTON_VARIANT.secondary} onclick={() => (demoModal = true)}>Abrir modal</Button>
			<Modal open={demoModal} onclose={() => (demoModal = false)}>
				{#snippet title()}Título del modal{/snippet}
				{#snippet children()}<p class="text-sm text-text-secondary">Contenido del modal sobre &lt;dialog&gt;: foco atrapado, Escape y clic fuera para cerrar.</p>{/snippet}
				{#snippet footer()}
					<Button variant={BUTTON_VARIANT.tertiary} onclick={() => (demoModal = false)}>Cancelar</Button>
					<Button variant={BUTTON_VARIANT.primary} onclick={() => (demoModal = false)}>Aceptar</Button>
				{/snippet}
			</Modal>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-tabgroup">
		<h3 id="g-tabgroup" class="text-base font-semibold text-text-primary">TabGroup</h3>
		<TabGroup label="Ejemplo" selected={demoTab} onselect={(id) => (demoTab = id)} tabs={[{ id: "a", label: "Actividad", count: 12 }, { id: "b", label: "Jobs", count: 3 }, { id: "c", label: "Capturas" }]} />
		<div><TabGroup variant={TAB_VARIANT.segmented} label="Periodo" selected={demoSegment} onselect={(id) => (demoSegment = id)} tabs={[{ id: "hoy", label: "Hoy" }, { id: "semana", label: "Semana" }, { id: "mes", label: "Mes" }]} /></div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-theme">
		<h3 id="g-theme" class="text-base font-semibold text-text-primary">ThemeToggle</h3>
		<div class="flex items-center gap-4">
			<ThemeToggle theme={themeState.current} ontoggle={toggleTheme} />
			<ThemeToggle theme={themeState.current} ontoggle={toggleTheme} compact />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-empty">
		<h3 id="g-empty" class="text-base font-semibold text-text-primary">EmptyState</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<EmptyState>
					{#snippet icon()}<Icon name="clock" size="md" />{/snippet}
					Aún no hay actividad
					{#snippet description()}Cuando Claude llame a una herramienta, aparecerá aquí.{/snippet}
				</EmptyState>
			<EmptyState variant={EMPTY_STATE_VARIANT.error}>
					{#snippet icon()}<Icon name="exclamation-triangle" size="md" />{/snippet}
					No se pudo conectar con el panel
					{#snippet description()}Se reintenta solo. Si sigue así, comprueba que make dashboard está en marcha.{/snippet}
					{#snippet actions()}<Button size="sm">Reintentar</Button>{/snippet}
				</EmptyState>
			<div class="rounded-xl border border-border bg-surface">
				<EmptyState size="sm">Tamaño pequeño: va dentro de otra superficie (aquí, una tarjeta)</EmptyState>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-chatbubble">
		<h3 id="g-chatbubble" class="text-base font-semibold text-text-primary">ChatBubble</h3>
		<div class="flex max-w-xl flex-col gap-4">
			<ChatBubble direction="in" time="10:00:00" meta="Entregado a la sesión">Pregunta del usuario del panel</ChatBubble>
			<ChatBubble direction="in" time="10:00:05" meta="No entregado" metaTone="danger">Un mensaje que la sesión rechazó</ChatBubble>
			<ChatBubble direction="out" time="10:00:09">Respuesta de Claude, con el texto que haga falta.</ChatBubble>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-markdown">
		<h3 id="g-markdown" class="text-base font-semibold text-text-primary">Markdown</h3>
		<div class="max-w-2xl"><Markdown blocks={parseMarkdown(SAMPLE_REPLY)} fileUrl={SAMPLE_FILE_URL} /></div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-thinking">
		<h3 id="g-thinking" class="text-base font-semibold text-text-primary">ThinkingIndicator</h3>
		<div class="flex max-w-xl flex-col gap-4">
			<ThinkingIndicator state={{ kind: "queued" }} />
			<ThinkingIndicator state={{ kind: "thinking", elapsedSec: 14, slow: false, stalled: false }} />
			<ThinkingIndicator state={{ kind: "thinking", elapsedSec: 75, slow: true, stalled: false }} />
			<ThinkingIndicator state={{ kind: "thinking", elapsedSec: 200, slow: true, stalled: true }} onLaunchAgent={() => {}} />
			<ThinkingIndicator state={{ kind: "undelivered" }} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-chatcomposer">
		<h3 id="g-chatcomposer" class="text-base font-semibold text-text-primary">ChatComposer</h3>
		<div class="flex max-w-2xl flex-col gap-4">
			<ChatComposer bind:value={sampleDraft} maxLength={4000} onsubmit={() => (sampleDraft = "")} />
			<ChatComposer size="lg" value="" maxLength={4000} error="El mensaje supera los 4000 caracteres." onsubmit={() => {}} />
			<ChatComposer value="" maxLength={4000} disabledReason="Esa sesión de Claude Code ya terminó" onsubmit={() => {}} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-chathelp">
		<h3 id="g-chathelp" class="text-base font-semibold text-text-primary">ChatHelp</h3>
		<div class="flex min-h-72 max-w-2xl items-end">
			<ChatHelp onpick={() => {}} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-chatsearchbar">
		<h3 id="g-chatsearchbar" class="text-base font-semibold text-text-primary">ChatSearchBar</h3>
		<div class="flex flex-col items-start gap-4">
			<ChatSearchBar query="accion" label="3 de 12" hasResults onquery={() => {}} onnext={() => {}} onprevious={() => {}} onclose={() => {}} />
			<ChatSearchBar query="zzz" label="Sin resultados" hasResults={false} onquery={() => {}} onnext={() => {}} onprevious={() => {}} onclose={() => {}} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-sessionpicker">
		<h3 id="g-sessionpicker" class="text-base font-semibold text-text-primary">SessionPicker</h3>
		<div class="flex flex-col gap-4">
			<SessionPicker sessions={SAMPLE_CHAT_SESSIONS} value={sampleSession} now={Date.parse("2026-01-01T12:00:00.000Z")} onchange={(id) => (sampleSession = id)} />
			<SessionPicker sessions={SAMPLE_CHAT_SESSIONS.slice(0, 1)} value={SAMPLE_CHAT_SESSIONS[0]?.sessionId ?? ""} now={Date.parse("2026-01-01T12:00:00.000Z")} onchange={() => {}} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-closeagentbutton">
		<h3 id="g-closeagentbutton" class="text-base font-semibold text-text-primary">CloseAgentButton</h3>
		<div class="flex flex-wrap items-center gap-4 pb-10">
			<CloseAgentButton onclose={() => {}} />
			<CloseAgentButton confirm onclose={() => {}}>
				{#snippet question()}Hay un lote en curso: si cierras el agente, el lote queda interrumpido. ¿Cerrar igualmente?{/snippet}
			</CloseAgentButton>
			<CloseAgentButton loading onclose={() => {}} />
			<CloseAgentButton disabled onclose={() => {}}>
				{#snippet reason()}No hay ningún agente abierto desde el panel{/snippet}
			</CloseAgentButton>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-projectselector">
		<h3 id="g-projectselector" class="text-base font-semibold text-text-primary">ProjectSelector</h3>
		<div class="flex flex-col gap-4">
			<ProjectSelector projects={SAMPLE_PROJECTS} activeId={sampleProject} onselect={(id) => (sampleProject = id)} />
			<ProjectSelector projects={SAMPLE_PROJECTS} activeId={sampleProject} onselect={() => {}} compact />
			<ProjectSelector projects={[]} activeId={null} onselect={() => {}} />
			<ProjectSelector projects={[]} activeId={null} onselect={() => {}} compact />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-projectindicator">
		<h3 id="g-projectindicator" class="text-base font-semibold text-text-primary">ProjectIndicator</h3>
		<div class="flex items-center gap-4">
			<ProjectIndicator name="Mi proyecto" />
			<ProjectIndicator name={null} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-result">
		<h3 id="g-result" class="text-base font-semibold text-text-primary">ResultLabel</h3>
		<div class="flex flex-wrap items-center gap-3">
			<ResultLabel tone="ok">{#snippet children()}Correcto{/snippet}</ResultLabel>
			<ResultLabel tone="error">{#snippet children()}ScriptError{/snippet}</ResultLabel>
			<ResultLabel tone="running">{#snippet children()}En curso{/snippet}</ResultLabel>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-error">
		<h3 id="g-error" class="text-base font-semibold text-text-primary">ErrorBlock</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<ErrorBlock error={SAMPLE_ERROR} retryable={true}>{#snippet children()}Error{/snippet}</ErrorBlock>
			<ErrorBlock error={{ ...SAMPLE_ERROR, line: null, nextStep: null }}>{#snippet children()}Job{/snippet}</ErrorBlock>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-nodes">
		<h3 id="g-nodes" class="text-base font-semibold text-text-primary">NodeLinks</h3>
		<NodeLinks ids={["1:23", "1:24"]} fileUrl={SAMPLE_FILE_URL} />
		<NodeLinks ids={["9:9"]} fileUrl={null} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-args">
		<h3 id="g-args" class="text-base font-semibold text-text-primary">ArgList</h3>
		<div class="grid gap-4 md:grid-cols-2">
			<ArgList items={[["file", "scripts/a.js"], ["format", "body"], ["timeoutMs", 20000], ["dry", false]]} />
			<ArgList items={[]} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-detail">
		<h3 id="g-detail" class="text-base font-semibold text-text-primary">DetailSection</h3>
		<DetailSection>
			{#snippet title()}Nodos tocados{/snippet}
			<span class="text-sm text-text-secondary">Contenido de la sección</span>
		</DetailSection>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-flow">
		<h3 id="g-flow" class="text-base font-semibold text-text-primary">FlowDiagram</h3>
		<FlowDiagram />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-term">
		<h3 id="g-term" class="text-base font-semibold text-text-primary">Term</h3>
		<p class="text-sm text-text-secondary">Explica un código del glosario con un tooltip que también sale al enfocar con el teclado.</p>
		<div class="flex flex-wrap items-center gap-6">
			<Term term="ScriptError">ScriptError</Term>
			<Term term="id.node" variant={TERM_VARIANT.bare}><span class="rounded-md bg-surface-sunken px-2 py-1 font-mono text-xs text-text-secondary">1234:5678</span></Term>
			<Term term="ClaveQueNoExiste">Sin término: se pinta tal cual</Term>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-permissioncard">
		<h3 id="g-permissioncard" class="text-base font-semibold text-text-primary">PermissionCard</h3>
		<div class="flex max-w-xl flex-col gap-4">
			<PermissionCard tool="Bash" description={SAMPLE_PERMISSION.description} input={SAMPLE_PERMISSION.inputPreview} status="pending" time="10:01:00" onallow={() => {}} ondeny={() => {}} />
			<PermissionCard tool="Bash" description={SAMPLE_PERMISSION.description} input={SAMPLE_PERMISSION.inputPreview} status="pending" time="10:01:00" busy onallow={() => {}} ondeny={() => {}} />
			<PermissionCard tool="figma_build" description={SAMPLE_LONG_DESCRIPTION} input={SAMPLE_LONG_INPUT} status="pending" time="10:01:05" onallow={() => {}} ondeny={() => {}} />
			<PermissionCard tool="figma_build" description="Lote largo" input={SAMPLE_HUGE_INPUT} status="pending" time="10:01:06" onallow={() => {}} ondeny={() => {}} />
			<PermissionCard tool="Write" description="Escribe un archivo" input="" status="allowed" time="10:01:10" onallow={() => {}} ondeny={() => {}} />
			<PermissionCard tool="Edit" description="Modifica un archivo" input="" status="denied" time="10:01:20" onallow={() => {}} ondeny={() => {}} />
			<PermissionCard tool="Bash" description={SAMPLE_PERMISSION.description} input={SAMPLE_PERMISSION.inputPreview} status="expired" time="10:01:30" onallow={() => {}} ondeny={() => {}} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-permissionnotice">
		<h3 id="g-permissionnotice" class="text-base font-semibold text-text-primary">PermissionNotice</h3>
		<div class="flex flex-wrap gap-4">
			<PermissionNotice onview={() => {}}>1 permiso esperando</PermissionNotice>
			<PermissionNotice onview={() => {}}>3 permisos esperando</PermissionNotice>
		</div>
	</section>

	{:else if section === SECTION.organisms}
		<h2 class="text-lg font-bold text-text-primary">Organismos</h2>
		<p class="-mt-8 text-sm text-text-secondary">Secciones del panel: componen moléculas y átomos y conocen los datos de actividad.</p>
	<section class="flex flex-col gap-4" aria-labelledby="g-sidebar">
		<h3 id="g-sidebar" class="text-base font-semibold text-text-primary">Sidebar</h3>
		<div class="h-[34rem] w-fit overflow-hidden rounded-xl border border-border">
			<Sidebar embedded route={ROUTE_NAME.activity} status={SAMPLE_STATUS} now={Date.now()} connection="open" theme={themeState.current} ontheme={toggleTheme} mode={DASHBOARD_MODE.development} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-table">
		<h3 id="g-table" class="text-base font-semibold text-text-primary">DataTable, Th, Tr y Td</h3>
		<DataTable
			label="Tabla de ejemplo"
			columns={[{ id: "tool", label: "Herramienta", sortKey: "tool" }, { id: "ms", label: "Duración", sortKey: "duration", align: "right" }]}
			rows={SAMPLE_CALLS}
			rowId={(e) => e.callId}
			sort={demoSort}
			onsort={(key) => (demoSort = toggleSort(demoSort, key))}
			expandedId={demoOpen}
			ontoggle={(id) => (demoOpen = demoOpen === id ? null : id)}
			highlighted={NO_TIMERS}
		>
			{#snippet cells(e)}
				<Td label="Herramienta"><span class="font-mono font-semibold">{e.tool}</span></Td>
				<Td align="right" label="Duración">{e.ms} ms</Td>
			{/snippet}
			{#snippet detail(e)}<span class="text-sm text-text-secondary">Detalle desplegado de {e.callId.slice(0, 8)}</span>{/snippet}
			{#snippet empty()}<EmptyState size="sm">Sin filas</EmptyState>{/snippet}
		</DataTable>
		<div class="overflow-hidden rounded-xl border border-border">
			<table class="w-full text-sm">
				<thead class="bg-surface-raised text-[11px] tracking-wide text-text-secondary uppercase">
					<tr><Th sort="asc" onsort={() => {}}>Ordenada ↑</Th><Th sort="desc" onsort={() => {}}>Ordenada ↓</Th><Th sort="none" onsort={() => {}}>Sin orden</Th><Th align="right">Fija</Th></tr>
				</thead>
				<tbody class="divide-y divide-border">
					<Tr id="demo-plain"><Td>Normal</Td><Td mono muted>mono y atenuada</Td><Td>—</Td><Td align="right">12</Td></Tr>
					<Tr id="demo-hl" highlight><Td>Resaltada (fila nueva)</Td><Td>—</Td><Td>—</Td><Td align="right">1</Td></Tr>
				</tbody>
			</table>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-filterbar">
		<h3 id="g-filterbar" class="text-base font-semibold text-text-primary">FilterBar</h3>
		<div class="pb-4">
			<FilterBar filters={demoFilters} tools={["figma_status", "figma_run_script", "figma_screenshot"]} sessions={SAMPLE_SESSIONS} onchange={(f) => (demoFilters = f)} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-kpirow">
		<h3 id="g-kpirow" class="text-base font-semibold text-text-primary">KpiRow</h3>
		<KpiRow summary={SAMPLE_SUMMARY} />
		<KpiRow summary={null} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-chatthread">
		<h3 id="g-chatthread" class="text-base font-semibold text-text-primary">ChatThread</h3>
		<div class="grid gap-4 lg:grid-cols-2">
			<div class="h-[36rem] rounded-xl border border-border bg-canvas"><ChatThread messages={SAMPLE_CHAT} fileUrl={SAMPLE_FILE_URL} now={Date.parse("2026-01-01T10:00:50.000Z")} maxLength={4000} onsend={() => true} /></div>
			<div class="h-[36rem] rounded-xl border border-border bg-canvas"><ChatThread messages={[]} now={Date.now()} maxLength={4000} onsend={() => true} /></div>
			<div class="h-[24rem] rounded-xl border border-border bg-canvas"><ChatThread messages={[]} disabledReason="Esa sesión de Claude Code ya terminó" now={Date.now()} maxLength={4000} onsend={() => false} /></div>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-activity">
		<h3 id="g-activity" class="text-base font-semibold text-text-primary">ActivityTable</h3>
		<ActivityTable
			entries={DEMO_ENTRIES}
			sort={demoSort}
			onsort={(key) => (demoSort = toggleSort(demoSort, key))}
			expandedId={demoOpen}
			ontoggle={(id) => (demoOpen = demoOpen === id ? null : id)}
			highlighted={NO_TIMERS}
			hasActivity
			showSession={false}
		/>
		<ActivityTable entries={[]} sort={DEFAULT_SORT} onsort={() => {}} expandedId={null} ontoggle={() => {}} highlighted={new Set()} hasActivity showSession={false} />
		<ActivityTable entries={[]} sort={DEFAULT_SORT} onsort={() => {}} expandedId={null} ontoggle={() => {}} highlighted={new Set()} hasActivity={false} showSession={false} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-footer">
		<h3 id="g-footer" class="text-base font-semibold text-text-primary">TableFooter</h3>
		<TableFooter window={DEMO_WINDOW} perPage={25} choices={[10, 25, 50, 100]} onpage={() => {}} onperpage={() => {}} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-attempts-table">
		<h3 id="g-attempts-table" class="text-base font-semibold text-text-primary">AttemptsTable</h3>
		<AttemptsTable rows={DEMO_ATTEMPT_TARGETS} sort={{ key: "attempts", dir: "desc" }} onsort={() => {}} onopen={() => {}} onclear={() => {}} hasAttempts />
		<AttemptsTable rows={[]} sort={{ key: "attempts", dir: "desc" }} onsort={() => {}} onopen={() => {}} onclear={() => {}} hasAttempts />
		<AttemptsTable rows={[]} sort={{ key: "attempts", dir: "desc" }} onsort={() => {}} onopen={() => {}} onclear={() => {}} hasAttempts={false} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-attempt-timeline">
		<h3 id="g-attempt-timeline" class="text-base font-semibold text-text-primary">AttemptTimeline</h3>
		<AttemptTimeline items={DEMO_ATTEMPT_ROWS} a={DEMO_ATTEMPT_ROWS[1]?.id ?? null} b={DEMO_ATTEMPT_ROWS[2]?.id ?? null} onpick={() => {}} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-jobs">
		<h3 id="g-jobs" class="text-base font-semibold text-text-primary">JobsTable</h3>
		<JobsTable entries={DEMO_JOBS} expandedId={null} ontoggle={() => {}} />
		<JobsTable entries={[]} expandedId={null} ontoggle={() => {}} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-buildsteps">
		<h3 id="g-buildsteps" class="text-base font-semibold text-text-primary">BuildSteps</h3>
		<div class="grid gap-5 lg:grid-cols-2">
			<BuildSteps steps={SAMPLE_STEPS} loadFull={async () => ({ kind: "inline", value: { movedCount: 8, wrappedCount: 2 } })} />
			<BuildSteps steps={SAMPLE_STEPS_CANCELLED} cancelled />
			<BuildSteps steps={[]} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-captures">
		<h3 id="g-captures" class="text-base font-semibold text-text-primary">CaptureGrid</h3>
		<CaptureGrid items={DEMO_CAPTURES} imageUrl={sampleImage} />
		<CaptureGrid items={[]} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-entry">
		<h3 id="g-entry" class="text-base font-semibold text-text-primary">EntryDetail</h3>
		<div class="rounded-xl border border-border bg-surface-raised px-6 py-5">
			<EntryDetail entry={SAMPLE_SHOT_ENTRY} imageUrl={sampleImage} />
		</div>
		<div class="rounded-xl border border-border bg-surface-raised px-6 py-5">
			<EntryDetail entry={SAMPLE_CALLS[1] as CallItem} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-status">
		<h3 id="g-status" class="text-base font-semibold text-text-primary">StatusPanel</h3>
		<StatusPanel rows={HOME_OK} onlaunch={() => {}} />
		<StatusPanel rows={HOME_PROBLEMS} onlaunch={() => {}} launchError="No se encontró la terminal configurada." />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-links">
		<h3 id="g-links" class="text-base font-semibold text-text-primary">SectionLinks</h3>
		<SectionLinks sections={SECTIONS} />
		<SectionLinks variant="compact" sections={SECTIONS} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-latest">
		<h3 id="g-latest" class="text-base font-semibold text-text-primary">LatestActivity</h3>
		<LatestActivity calls={SAMPLE_CALLS} errors={[SAMPLE_CALLS[1] as CallItem]} />
		<LatestActivity calls={[]} errors={[]} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-settingrow">
		<h3 id="g-settingrow" class="text-base font-semibold text-text-primary">SettingRow</h3>
		<p class="text-sm text-text-secondary">Una fila de «Ajustes»: la ficha llega del servidor, así que una clave nueva sale sola.</p>
		<SectionCard padding="none">
			{#snippet children()}
				<div class="divide-y divide-border">
					{#each SAMPLE_SETTING_ROWS as sample (sample.label)}
						<div>
							<p class="px-5 pt-3 text-[11px] font-semibold tracking-wide text-text-muted uppercase">{sample.label}</p>
							<SettingRow setting={sample.setting} problem={sample.problem ?? null} error={sample.error ?? null} busy={false} onsave={() => {}} onreset={() => {}} />
						</div>
					{/each}
				</div>
			{/snippet}
		</SectionCard>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-resetall">
		<h3 id="g-resetall" class="text-base font-semibold text-text-primary">ResetAllSettings</h3>
		<p class="text-sm text-text-secondary">«Restablecer todo» de «Ajustes»: desactivado sin nada guardado; con algo guardado, pide confirmar y lista los ajustes.</p>
		<div class="flex flex-wrap items-center gap-4">
			<ResetAllSettings names={[]} busy={false} onreset={() => {}} />
			<ResetAllSettings names={["Plazo blando de un script", "Sondeo en vivo del panel"]} busy={false} onreset={() => {}} />
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-glossary">
		<h3 id="g-glossary" class="text-base font-semibold text-text-primary">Glossary</h3>
		<Glossary group={demoGlossaryGroup} onselectgroup={(group) => (demoGlossaryGroup = group)} />
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-chatthread-permissions">
		<h3 id="g-chatthread-permissions" class="text-base font-semibold text-text-primary">ChatThread con permisos</h3>
		<p class="text-sm text-text-secondary">Las peticiones van en la conversación, por su hora. Si una pendiente no se ve, sale el aviso de PermissionNotice sobre el campo.</p>
		<div class="h-[36rem] max-w-3xl rounded-xl border border-border bg-canvas">
			<ChatThread messages={SAMPLE_CHAT} permissions={SAMPLE_PERMISSIONS} fileUrl={SAMPLE_FILE_URL} now={Date.parse("2026-01-01T10:00:50.000Z")} maxLength={4000} ondecide={() => {}} onsend={() => true} />
		</div>
	</section>

	{:else}
		<h2 class="text-lg font-bold text-text-primary">Fundamentos</h2>
		<p class="-mt-8 text-sm text-text-secondary">Color, tipografía e iconos: lo que no es un componente pero lo usan todos.</p>
	<section class="flex flex-col gap-4" aria-labelledby="g-roles">
		<h2 id="g-roles" class="text-base font-semibold text-text-primary">Roles de color</h2>
		<p class="text-sm text-text-secondary">Los componentes solo usan estos roles; el tema cambia sus valores.</p>
		{#each [["Marca", BRAND], ["Retroalimentación", FEEDBACK], ["Estructura", STRUCTURE]] as const as [title, swatches] (title)}
			<div class="flex flex-col gap-2">
				<h3 class="text-eyebrow text-text-muted uppercase">{title}</h3>
				<ul class="flex flex-wrap gap-3">
					{#each swatches as [name, cls] (name)}
						<li class="flex w-24 flex-col gap-1">
							<span class="h-10 rounded-md border border-border {cls}"></span>
							<code class="font-mono text-[0.6875rem] text-text-secondary">{name}</code>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
		<ul class="flex flex-wrap gap-6">
			{#each TEXT as [name, cls] (name)}
				<li class="flex flex-col gap-1">
					<span class="text-sm font-medium {cls}">Aa texto de ejemplo</span>
					<code class="font-mono text-[0.6875rem] text-text-muted">{name}</code>
				</li>
			{/each}
		</ul>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-type">
		<h3 id="g-type" class="text-base font-semibold text-text-primary">Tipografía</h3>
		<div class="flex flex-col gap-3">
			<p class="text-display text-text-primary">Título de página · text-display</p>
			<p class="text-stat text-text-primary">128 · text-stat (cifra de KPI)</p>
			<p class="text-section text-text-primary">Título de sección · text-section</p>
			<p class="text-heading text-text-primary">Nombre de tarjeta · text-heading</p>
			<p class="text-sm text-text-primary">Cuerpo y controles · text-sm</p>
			<p class="text-eyebrow text-text-muted uppercase">Cabecera de tarjeta y de grupo · text-eyebrow mayúsculas</p>
			<p class="text-[11px] font-semibold tracking-wider text-text-secondary uppercase">Cabecera de tabla · 11px mayúsculas</p>
			<p class="text-xs text-text-muted">Meta y ayuda · text-xs muted</p>
			<p class="font-mono text-xs text-text-secondary">figma_run_script · scripts/a.js · 1:23 · datos técnicos en monoespaciada</p>
		</div>
	</section>

	<section class="flex flex-col gap-4" aria-labelledby="g-icon">
		<h3 id="g-icon" class="text-base font-semibold text-text-primary">Icon</h3>
		<div class="flex flex-wrap items-center gap-4 text-text-secondary">
			{#each ICON_NAMES as name (name)}<Icon {name} size="md" />{/each}
		</div>
	</section>

	{/if}
</div>
