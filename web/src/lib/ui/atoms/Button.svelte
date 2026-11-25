<script module lang="ts">
// Variantes de Button como fuente única: la unión se deriva del token, no se declara aparte.
export const BUTTON_VARIANT = {
	primary: "primary",
	secondary: "secondary",
	tertiary: "tertiary",
	danger: "danger",
	ghost: "ghost",
	link: "link",
} as const;
export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
import Spinner from "./Spinner.svelte";

type Size = "sm" | "md" | "lg";
// icon: cuadrado solo con icono (el texto va como aria-label); pill: redondeado completo
type Shape = "default" | "icon" | "pill";
type Props = Omit<HTMLButtonAttributes, "children" | "class"> & {
	variant?: ButtonVariant;
	size?: Size;
	shape?: Shape;
	loading?: boolean;
	// Con href se pinta un <a> con el mismo aspecto
	href?: string;
	target?: HTMLAnchorAttributes["target"];
	rel?: string;
	children: Snippet;
};

let {
	variant = BUTTON_VARIANT.secondary,
	size = "md",
	shape = "default",
	loading = false,
	disabled = false,
	type = "button",
	href,
	target,
	rel,
	children,
	...rest
}: Props = $props();

const BASE =
	"inline-flex items-center justify-center gap-1.5 font-semibold tracking-tight transition duration-base cursor-pointer";

// Las variantes con caja se elevan 1px al pasar el ratón; el enlace y el fantasma no. El primario va en tinta
// (oscuro en claro, claro en oscuro): la marca queda para los acentos
const VARIANT: Record<ButtonVariant, string> = {
	primary: "bg-ink text-on-ink shadow-md hover:bg-ink-hover hover:shadow-lg motion-safe:hover:-translate-y-px",
	secondary: "border border-border bg-surface text-text-secondary shadow-xs hover:border-border-strong/40 hover:bg-surface-raised hover:shadow-sm motion-safe:hover:-translate-y-px",
	tertiary: "border border-brand-200 text-brand-700 hover:bg-brand-50 hover:shadow-sm motion-safe:hover:-translate-y-px",
	danger: "border border-danger-200 text-danger-700 hover:bg-danger-50 hover:shadow-sm motion-safe:hover:-translate-y-px",
	ghost: "text-text-secondary hover:bg-surface-raised hover:text-text-primary",
	link: "text-text-secondary hover:text-brand-700",
};

// Inerte (deshabilitado o cargando): relleno hundido, borde y texto atenuados, sin hover. Solo roles, para que se
// distinga del activo a simple vista en claro y oscuro (el contraste del par lo calcula contrast.test.ts)
const DISABLED = "border border-border bg-surface-sunken text-text-muted cursor-not-allowed pointer-events-none";
// El enlace no tiene caja: solo se atenúa el texto
const DISABLED_LINK = "text-text-muted cursor-not-allowed pointer-events-none";

const SIZE: Record<Size, string> = {
	sm: "px-3 py-1 text-xs",
	md: "px-4 py-2 text-sm",
	lg: "px-4.5 py-2.5 text-sm",
};
const ICON_SIZE: Record<Size, string> = {
	sm: "size-7 text-xs",
	md: "size-9 text-sm",
	lg: "size-10 text-sm",
};
const LINK_SIZE: Record<Size, string> = { sm: "text-xs", md: "text-sm", lg: "text-sm" };

const inert = $derived(disabled || loading);
const classes = $derived(
	[
		BASE,
		shape === "pill" ? "rounded-full" : "rounded-md",
		inert ? (variant === BUTTON_VARIANT.link ? DISABLED_LINK : DISABLED) : VARIANT[variant],
		variant === BUTTON_VARIANT.link ? LINK_SIZE[size] : shape === "icon" ? ICON_SIZE[size] : SIZE[size],
	].join(" "),
);
</script>

{#snippet content()}
	{#if loading}<Spinner size="sm" />{/if}
	{@render children()}
{/snippet}

{#if href !== undefined}
	<a
		href={inert ? undefined : href}
		{target}
		rel={rel ?? (target === "_blank" ? "noopener" : undefined)}
		aria-disabled={inert || undefined}
		aria-busy={loading || undefined}
		class={classes}
		{...rest as HTMLAnchorAttributes}
	>
		{@render content()}
	</a>
{:else}
	<button {type} disabled={inert} aria-busy={loading || undefined} class={classes} {...rest}>
		{@render content()}
	</button>
{/if}
