.DEFAULT_GOAL := help
.PHONY: grafana docs test-db user telegram mcp-token renormalize worker worker-env up web web-env web-build bot bot-env docker-up docker-down xiaomi-login xiaomi-data google-login google-data google-webhook google-subscriber help setup install env dev start test test-watch coverage lint lint-fix format format-check check new-lib clean

API_ENV := apps/api/.env
BOT_ENV := apps/bot/.env
WORKER_ENV := apps/worker/.env
WEB_ENV := apps/web/.env
# Docker en local como en el VPS: mismo compose, secretos de Infisical (.env.infisical) y red local
DOCKER_LOCAL := DIGITALTWIN_NETWORK=digitaltwin-local OTEL_SDK_DISABLED=true docker compose --env-file .env.infisical \
	-f docker-compose.prod.yml -f docker-compose.local.yml

help: ## Muestra esta ayuda
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: install env ## Instala dependencias y crea el .env si no existe

install: ## Instala dependencias de todos los workspaces
	npm install

env: ## Crea apps/api/.env a partir de .env.example (no sobrescribe)
	@test -f $(API_ENV) || (cp apps/api/.env.example $(API_ENV) && echo "Creado $(API_ENV)")

dev: env ## Arranca la API en modo watch
	npm run dev

start: env ## Arranca la API
	npm start

test: ## Ejecuta todos los tests
	npm test

test-db: ## Tests de la BD contra digitaltwin-db de make docker-up (localhost:5433)
	@set -a && . ./.env.infisical && set +a && \
		TEST_DATABASE_URL=postgres://digitaltwin:$$DIGITALTWIN_DB_PASSWORD@localhost:5433/digitaltwin \
		npm test -w @digitaltwin/db -w @digitaltwin/api -w @digitaltwin/timeline -w @digitaltwin/worker

user: ## Crea un usuario en la API de Docker: make user email=yo@x.com name=Yo role=admin
	@test -n "$(email)" || (echo "Uso: make user email=yo@x.com [name=Yo] [role=admin|user]" && exit 1)
	docker exec -it digitaltwin-api node scripts/create-user.js --email "$(email)" \
		$(if $(name),--name "$(name)") --role "$(or $(role),user)"

telegram: ## Vincula tu Telegram con tu usuario: make telegram email=yo@x.com id=123456789
	@test -n "$(email)" -a -n "$(id)" || (echo "Uso: make telegram email=yo@x.com id=<id de Telegram>" && exit 1)
	docker exec -it digitaltwin-api node scripts/link-telegram.js --email "$(email)" --telegram "$(id)"

mcp-token: ## Token personal para el MCP: make mcp-token email=yo@x.com name="Claude Code"
	@test -n "$(email)" || (echo "Uso: make mcp-token email=yo@x.com [name=\"Claude Code\"]" && exit 1)
	docker exec -it digitaltwin-api node scripts/create-token.js --email "$(email)" \
		$(if $(name),--name "$(name)")

renormalize: ## Re-normaliza lo descargado tras cambiar un normalizador: make renormalize provider=google-health [kind=steps]
	@test -n "$(provider)" || (echo "Uso: make renormalize provider=google-health [kind=steps] [from=2026-10-01]" && exit 1)
	docker exec digitaltwin-worker node scripts/renormalize.js --provider "$(provider)" \
		$(if $(kind),--kind "$(kind)") $(if $(from),--from "$(from)")

test-watch: ## Tests en modo watch
	npm run test:watch

coverage: ## Tests con cobertura
	npm run test:coverage

lint: ## ESLint
	npm run lint

lint-fix: ## ESLint con autofix
	npm run lint:fix

format: ## Formatea con Prettier
	npm run format

format-check: ## Comprueba el formato
	npm run format:check

bot-env: ## Crea apps/bot/.env a partir de .env.example (no sobrescribe)
	@test -f $(BOT_ENV) || (cp apps/bot/.env.example $(BOT_ENV) && echo "Creado $(BOT_ENV): rellena tokens y claves")

bot: bot-env ## Arranca el bot de Telegram en modo watch (long polling)
	npm run dev -w @digitaltwin/bot

worker-env: ## Crea apps/worker/.env a partir de .env.example (no sobrescribe)
	@test -f $(WORKER_ENV) || (cp apps/worker/.env.example $(WORKER_ENV) && echo "Creado $(WORKER_ENV): rellena la BD y las claves")

worker: worker-env ## Arranca el worker (cola, sincronizaciones, cron) en modo watch
	npm run dev -w @digitaltwin/worker

web-env: ## Crea apps/web/.env a partir de .env.example (no sobrescribe)
	@test -f $(WEB_ENV) || (cp apps/web/.env.example $(WEB_ENV) && echo "Creado $(WEB_ENV)")

web: web-env ## Arranca el frontal (Vue 3) en http://localhost:5173
	npm run dev -w @digitaltwin/web

web-build: ## Compila el frontal en apps/web/dist
	npm run build -w @digitaltwin/web

docs: ## Documentación (VitePress) en http://localhost:5174/docs/ (con `make web`, también en :5173/docs/)
	npm run dev -w @digitaltwin/docs

up: env bot-env web-env ## Arranca API + bot + frontal a la vez (Ctrl+C para todos)
	@$(MAKE) --no-print-directory -j3 dev bot web

docker-up: ## Prueba en Docker como en el VPS (API en :3080, front en :3081)
	@test -f .env.infisical || (cp .env.infisical.example .env.infisical && \
		echo "Creado .env.infisical: rellénalo y vuelve a lanzar make docker-up" && exit 1)
	@docker network inspect digitaltwin-local >/dev/null 2>&1 || docker network create digitaltwin-local >/dev/null
	$(DOCKER_LOCAL) up --build

docker-down: ## Para y borra los contenedores de make docker-up
	$(DOCKER_LOCAL) down

check: lint format-check test ## Lint + formato + tests (lo que pasaría en CI)

new-lib: ## Crea una librería: make new-lib name=<nombre>
	@test -n "$(name)" || (echo "Uso: make new-lib name=<nombre>" && exit 1)
	npm run new:lib $(name)
	npm install

clean: ## Borra node_modules y coverage
	rm -rf node_modules apps/*/node_modules packages/*/node_modules coverage

xiaomi-login: ## Login real en Xiaomi Cloud (guarda credenciales en packages/xiaomi/.local)
	cd packages/xiaomi && node examples/login.js

xiaomi-data: ## Mediciones de la báscula: make xiaomi-data args="--from 2026-09-01"
	cd packages/xiaomi && node examples/measurements.js $(args)

google-login: ## Conecta tu cuenta de Google Health (OAuth en el navegador)
	cd packages/google-health && node examples/login.js $(args)

google-data: ## Datos de Google Health: make google-data args="--types steps,sleep --from 2026-10-01"
	cd packages/google-health && node examples/data.js $(args)

google-webhook: ## Servidor local de webhooks (:8787): make google-webhook args="--fetch"
	cd packages/google-health && node examples/webhook-server.js $(args)

google-subscriber: ## Suscriptor de webhooks: make google-subscriber args="list|create|delete ..."
	cd packages/google-health && node examples/subscriber.js $(args)

grafana: ## Monta/actualiza Grafana Cloud (alertas, dashboard, comprobaciones, token de Alloy)
	node scripts/grafana/provision.js $(args)
