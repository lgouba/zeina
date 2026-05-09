#!/usr/bin/env bash
# =============================================================================
# Wrapper docker compose pour la prod — pré-charge --env-file et les overrides.
#
# Usage : ./scripts/dc-prod.sh <commande compose>
# Exemples :
#   ./scripts/dc-prod.sh up -d --build
#   ./scripts/dc-prod.sh logs -f rules-engine
#   ./scripts/dc-prod.sh ps
#   ./scripts/dc-prod.sh up -d --force-recreate rules-engine
#   ./scripts/dc-prod.sh --profile tools run --rm migrate up
# =============================================================================
set -eu

cd "$(dirname "$0")/.."

if [[ ! -f .env.prod ]]; then
  echo "Erreur : .env.prod introuvable. Lance d'abord ./scripts/gen-prod-secrets.sh" >&2
  exit 1
fi

exec docker compose \
  --env-file .env.prod \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  "$@"
