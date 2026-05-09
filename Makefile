# =============================================================================
# ZEINA — Makefile
# =============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

DC      := docker compose
DC_TOOL := docker compose --profile tools

# Charge .env si présent (pour DATABASE_URL en local hors docker)
-include .env
export

# -----------------------------------------------------------------------------
.PHONY: help
help: ## Affiche cette aide
	@awk 'BEGIN {FS = ":.*##"; printf "\nCibles disponibles:\n\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

##@ Stack Docker

.PHONY: up
up: ## Démarre l'infra (db, mqtt, redis)
	@$(DC) up -d
	@echo ""
	@echo "▶ Services démarrés. Vérifier l'état :  make ps"
	@echo "▶ Appliquer les migrations :            make migrate-up"

.PHONY: down
down: ## Arrête tous les services (préserve les volumes)
	@$(DC) down

.PHONY: nuke
nuke: ## Arrête + supprime volumes (⚠️ perte de données)
	@$(DC) down -v

.PHONY: ps
ps: ## Liste les services et leur santé
	@$(DC) ps

.PHONY: logs
logs: ## Logs d'un service. Usage: make logs s=mosquitto
	@$(DC) logs -f --tail=100 $(s)

.PHONY: restart
restart: ## Redémarre un service. Usage: make restart s=mosquitto
	@$(DC) restart $(s)

##@ Migrations DB

.PHONY: migrate-up
migrate-up: ## Applique toutes les migrations en attente
	@$(DC_TOOL) run --rm migrate up

.PHONY: migrate-down
migrate-down: ## Rollback de N migrations. Usage: make migrate-down n=1
	@$(DC_TOOL) run --rm migrate down $(or $(n),1)

.PHONY: migrate-version
migrate-version: ## Affiche la version courante de la DB
	@$(DC_TOOL) run --rm migrate version

.PHONY: migrate-force
migrate-force: ## Force la version (réparation après échec). Usage: make migrate-force v=1
	@test -n "$(v)" || (echo "Usage: make migrate-force v=<version>" && exit 1)
	@$(DC_TOOL) run --rm migrate force $(v)

.PHONY: migrate-new
migrate-new: ## Crée une nouvelle migration. Usage: make migrate-new name=add_foo
	@test -n "$(name)" || (echo "Usage: make migrate-new name=<nom>" && exit 1)
	@docker run --rm -v $(PWD)/migrations:/migrations migrate/migrate:v4.18.1 \
		create -ext sql -dir /migrations -seq $(name)
	@echo "✓ Migration créée dans ./migrations/"

##@ Code generation

.PHONY: sqlc
sqlc: ## Régénère le code Go à partir des .sql (queries/ + migrations/)
	@docker run --rm -v $(PWD):/src -w /src sqlc/sqlc:latest generate
	@echo "✓ Code sqlc généré dans packages/shared/db/sqlc/"

.PHONY: openapi
openapi: ## Régénère la spec OpenAPI (placeholder — implémenté à l'étape API)
	@echo "Sera implémenté à l'étape 5 (API)"

.PHONY: types-front
types-front: ## Génère les types TS depuis openapi.yaml (placeholder)
	@echo "Sera implémenté à l'étape 6 (frontend)"

##@ Développement

.PHONY: psql
psql: ## Ouvre psql sur la DB
	@$(DC) exec -it timescaledb psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

.PHONY: redis-cli
redis-cli: ## Ouvre redis-cli
	@$(DC) exec -it redis redis-cli

.PHONY: mqtt-sub
mqtt-sub: ## Subscribe sur un topic. Usage: make mqtt-sub t='qlab/#'
	@$(DC) exec mosquitto mosquitto_sub -h localhost -p 1883 \
		-u $(MQTT_API_USER) -P $(MQTT_API_PASSWORD) \
		-t '$(or $(t),qlab/#)' -v

.PHONY: mqtt-pub
mqtt-pub: ## Publish un message. Usage: make mqtt-pub t=topic m='{"value":1}'
	@$(DC) exec mosquitto mosquitto_pub -h localhost -p 1883 \
		-u $(MQTT_API_USER) -P $(MQTT_API_PASSWORD) \
		-t '$(t)' -m '$(m)'

##@ Build & test

# Container Go réutilisable + cache modules persistant entre invocations.
# Image debian (pas alpine) pour avoir cgo → permet -race dans les tests.
GO_RUN := docker run --rm -v $(PWD):/src -v zeina-gomod-cache:/go/pkg/mod -w /src golang:1.22

# Liste des modules du workspace (synchronisé avec go.work)
GO_MODS := packages/shared services/api services/ingestor services/rules-engine services/simulator services/connectors/iotsens services/connectors/iotsens-fake

.PHONY: tidy
tidy: ## go mod tidy sur tous les modules du workspace
	@for mod in $(GO_MODS); do \
		if [ -f $$mod/go.mod ]; then \
			echo "▶ tidy $$mod"; \
			$(GO_RUN) sh -c "cd $$mod && go mod tidy" || exit 1; \
		fi; \
	done

# has_go_files retourne true si le module contient au moins un .go en
# récursif (ignore le seul go.mod).
.PHONY: build
build: ## Build tous les modules contenant du code
	@for mod in $(GO_MODS); do \
		if [ -n "$$(find $$mod -type f -name '*.go' -not -name '*_test.go' 2>/dev/null | head -1)" ]; then \
			echo "▶ build $$mod"; \
			$(GO_RUN) sh -c "cd $$mod && go build ./..." || exit 1; \
		fi; \
	done

.PHONY: test
test: ## Tests unitaires Go (race detector activé)
	@for mod in $(GO_MODS); do \
		if [ -n "$$(find $$mod -type f -name '*_test.go' 2>/dev/null | head -1)" ]; then \
			echo "▶ test $$mod"; \
			$(GO_RUN) sh -c "cd $$mod && go test -race -count=1 ./..." || exit 1; \
		fi; \
	done

.PHONY: test-int
test-int: ## Tests d'intégration API (DB Postgres requise — utilise le compose dev)
	@echo "▶ test intégration api (TEST_DATABASE_URL via réseau zeina_zeina)"
	@cp openapi/openapi.yaml services/api/internal/handlers/openapi.yaml
	@docker run --rm -v $(PWD):/work -w /work/services/api -e GOWORK=off \
		-e TEST_DATABASE_URL="postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@zeina-timescaledb:5432/$(POSTGRES_DB)?sslmode=disable" \
		--network zeina_zeina golang:1.22 go test -race -count=1 -run 'Test' ./internal/handlers/... -v
	@rm -f services/api/internal/handlers/openapi.yaml

.PHONY: test-front
test-front: ## Tests Vitest du frontend
	@docker run --rm -v $(PWD)/frontend:/app -w /app node:20-alpine sh -c \
		"npm install --no-audit --no-fund --silent && npx vitest run"

.PHONY: seed
seed: ## Insère les données démo + catalogue de modèles (idempotent)
	@$(DC) exec -T timescaledb psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) -f - < db/seed/01-demo.sql
	@$(DC) exec -T timescaledb psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) -f - < db/seed/02-device-models.sql

.PHONY: e2e
e2e: ## Tests E2E Playwright (étape 9)
	@echo "Sera implémenté à l'étape 9"

.PHONY: load
load: ## Tests de charge k6 (étape 9)
	@echo "Sera implémenté à l'étape 9"

.PHONY: lint
lint: ## golangci-lint sur tous les modules Go
	@for mod in $(GO_MODS); do \
		echo "▶ lint $$mod"; \
		docker run --rm -v $(PWD):/work -w /work/$$mod -e GOWORK=off \
			golangci/golangci-lint:v1.62-alpine golangci-lint run \
			--config=/work/.golangci.yml --timeout=5m ./... || exit 1; \
	done

##@ Vérification setup

.PHONY: check
check: ## Vérifie la cohérence du compose et la présence des fichiers clés
	@$(DC) config --quiet && echo "✓ docker-compose.yml valide"
	@test -f .env || (echo "✗ Fichier .env manquant — exécuter: cp .env.example .env" && exit 1)
	@echo "✓ .env présent"
	@test -f mosquitto/config/mosquitto.conf && echo "✓ mosquitto.conf présent"
	@test -f mosquitto/config/acl && echo "✓ mosquitto ACL présent"
	@test -d migrations && echo "✓ Dossier migrations présent ($$(ls migrations/*.up.sql | wc -l | tr -d ' ') versions UP)"
	@test -d queries && echo "✓ Dossier queries présent ($$(ls queries/*.sql | wc -l | tr -d ' ') fichiers .sql)"
	@test -f sqlc.yaml && echo "✓ sqlc.yaml présent"
