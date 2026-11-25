// Único punto por el que la web toca el servidor: tipos del contrato, nunca código.
// Lo impone ESLint (eslint.config.ts): import type, y solo de estos archivos.
export type {
	ActivityError,
	ActivityEvent,
	ArgsSummary,
	JobFinished,
	ScreenshotSaved,
	SessionStarted,
	StatusChecked,
	ToolCalled,
	ToolFinished,
} from "../../../server/src/domain/activity.ts";
export type {
	AgentLaunchError,
	AgentLaunched,
	AgentWatching,
	CloseAgentError,
} from "../../../server/src/domain/agent.ts";
export type {
	AssetRecord,
	AttemptItem,
	AttemptKind,
	AttemptOrder,
	AttemptScriptItem,
	AttemptStatus,
	AttemptTarget,
	ScriptStored,
} from "../../../server/src/domain/attempt.ts";
export type {
	AssetDiff,
	AssetInfo,
	AssetState,
	AttemptDiff,
	AttemptEnd,
	ContentDiff,
	RoleDiff,
	RoleState,
} from "../../../server/src/domain/attempt-diff.ts";
export type {
	CancelRequestInfo,
	CancelState,
} from "../../../server/src/domain/cancel-request.ts";
export type {
	ChatDirection,
	ChatError,
	ChatMessage,
	ChatPage,
	ChatSearchHit,
	ChatSearchResult,
	ChatSessionInfo,
	ChatStatus,
} from "../../../server/src/domain/chat.ts";
export type {
	BuildStepFullResult,
	BuildStepItem,
	BuildStepStatus,
	CallItem,
	CallsPage,
	CaptureItem,
	ConnectionStatus,
	HistoryError,
	HistorySummary,
	JobInfo,
	Page,
	ScreenshotInfo,
	SessionItem,
	ToolStat,
} from "../../../server/src/domain/history.ts";
export type {
	PermissionBehavior,
	PermissionError,
	PermissionRequest,
	PermissionStatus,
} from "../../../server/src/domain/permission.ts";
export type {
	DashboardMode,
	SettingOrigin,
	SettingUser,
	SettingValue,
	SettingView,
} from "../../../server/src/domain/settings.ts";
export type {
	DiffHunk,
	DiffLine,
	DiffOp,
} from "../../../server/src/domain/text-diff.ts";
