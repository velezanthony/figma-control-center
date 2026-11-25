# Atajos para el día a día. Cada objetivo envuelve un script de npm o de spikes/;
# la configuración opcional (puertos, rutas, archivo de Figma) vive en .env, no aquí.
.DEFAULT_GOAL := help
SHELL := /bin/bash
ENV_FILE := .env
LOAD_ENV := source spikes/m0/env.sh

.PHONY: help install env login login-url chrome chrome-stop probe server inspector tools \
	check typecheck lint format test test-watch test-watch-web coverage e2e e2e-setup e2e-record e2e-contract kit-contract verify mcp dashboard build-web dev-web agent

## ── Puesta en marcha ──────────────────────────────────────────────

help: ## Lista los objetivos disponibles
	@awk 'BEGIN {FS = ":.*## "} /^## ──/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 4)} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Instala las dependencias (npm ci)
	npm ci

env: ## Opcional: crea .env a partir de .env.example si no existe (sin .env todo funciona con los valores por defecto)
	@if [[ -f $(ENV_FILE) ]]; then echo "$(ENV_FILE) ya existe: no lo toco"; else cp .env.example $(ENV_FILE) && echo "Creado $(ENV_FILE): revisa las rutas y puertos"; fi

## ── Chrome y Figma ────────────────────────────────────────────────

login: ## Una vez: para el Chrome de depuración y abre Chrome con ventana en el perfil para iniciar sesión en Figma
	spikes/m0/login.sh

login-url: ## URL de inicio de sesión de Figma que vuelve a tus archivos (para el navegador --isolated de devtools)
	@echo "https://www.figma.com/login?redirect_uri=%2Ffiles"

chrome: ## Arranca Chrome sin ventana con puerto de depuración y la sesión de Figma
	spikes/m0/chrome.sh

chrome-stop: ## Para el Chrome de depuración (el del puerto de .env o 9222)
	@$(LOAD_ENV); FIGMA_CDP_PORT="$$(env_get FIGMA_CDP_PORT 9222)"; pkill -f "[r]emote-debugging-port=$$FIGMA_CDP_PORT" && echo "Chrome parado" || echo "No había Chrome en $$FIGMA_CDP_PORT"

probe: ## Sonda rápida: lectura, escritura reversible y script grande contra Figma
	node spikes/m0/cdp-probe.ts

## ── Servidor MCP ──────────────────────────────────────────────────

server: ## Arranca el servidor MCP por stdio (normalmente lo arranca Claude Code)
	npm run server

inspector: ## Abre el MCP Inspector (interfaz web) contra el servidor
	npx -y @modelcontextprotocol/inspector node server/src/main.ts

tools: ## Lista las herramientas del servidor con el Inspector en modo CLI
	npx -y @modelcontextprotocol/inspector --cli node server/src/main.ts --method tools/list

mcp: ## Muestra cómo ve Claude Code el servidor figma-control-center
	claude mcp get figma-control-center

agent: ## Claude Code con el panel como canal y el arnés del agente (solo ese proyecto): make agent PROJECT=<número>
	@node server/src/agent-run.ts "$$PROJECT" "$$AGENT_DIR"

## ── Panel de actividad ────────────────────────────────────────────

dashboard: build-web ## Compila la web y arranca el panel (http://127.0.0.1:FCC_DASHBOARD_PORT)
	npm run dashboard

build-web: ## Compila la web del panel (Vite: Svelte + Tailwind) en web/dist
	npm run build:web

dev-web: ## Servidor de Vite con recarga en caliente; /api, /events y /screenshots van al panel (déjalo junto a `npm run dashboard`)
	@$(LOAD_ENV); FCC_DASHBOARD_HOST="$$(env_get FCC_DASHBOARD_HOST 127.0.0.1)" FCC_DASHBOARD_PORT="$$(env_get FCC_DASHBOARD_PORT 4173)" npm run dev:web

## ── Calidad ───────────────────────────────────────────────────────

check: typecheck lint build-web test ## typecheck + lint + test (lo que se pasa antes de cada commit)

typecheck: ## Comprueba tipos del servidor, el dominio y la web (svelte-check)
	npm run typecheck

lint: ## Biome (lint y formato), ESLint (fronteras y promesas) y dependency-cruiser (capas y lo transitivo), sin modificar
	npm run lint

format: ## Biome: aplica formato y arreglos seguros
	npx biome check --write

test: ## Tests unitarios y de integración: primero server/ (node:test), después web/ (Vitest), uno detrás de otro
	npm test

test-watch: ## Tests de server/ en modo vigilancia (rojo → verde → refactor)
	npm run test:watch

test-watch-web: ## Tests de web/ (Vitest) en modo vigilancia
	npm run test:web:watch

coverage: ## Tests con informe de cobertura (server/ y después web/)
	npm run test:coverage

e2e-setup: ## Una vez: descarga el Chromium de Playwright (el de Playwright, nunca el Chrome del usuario)
	npx playwright install chromium

e2e: build-web ## E2E herméticos: servidor (simulador de Figma y Claude simulado), kits (páginas de ejemplo en el Chromium de Playwright) y navegador (Playwright); sin Chrome ni Figma
	npm run test:e2e
	npm run test:kits
	npm run test:e2e:browser

verify: check e2e ## check + todos los E2E herméticos (lo que se pasa antes de cerrar una fase)

e2e-record: ## Investigación de contratos: guarda respuestas reales del archivo de pruebas en output/contract-samples (opt-in; necesita Chrome con la pestaña del archivo de pruebas abierta). Con STATE=<estado> guarda solo el estado de la pestaña (make e2e-record STATE=no-session)
	node server/test/contract/record.ts $(STATE)

kit-contract: ## Kit de Figma contra Figma REAL (opt-in; solo el archivo de pruebas: guarda por fileKey; necesita su pestaña abierta en el Chrome de depuración y FIGMA_TEST_FILE_URL). Crea y borra su propia página `fcc:kit-test`
	npm run test:kit-contract

e2e-contract: ## Contrato: valida las respuestas REALES del archivo de pruebas contra los contratos (opt-in; necesita la pestaña del archivo de pruebas abierta en el Chrome de depuración)
	npm run test:contract
