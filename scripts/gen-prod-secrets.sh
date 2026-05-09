#!/usr/bin/env bash
# =============================================================================
# Génère un .env.prod à partir de .env.prod.example en remplaçant tous les
# __CHANGE_ME__ par des secrets aléatoires forts.
#
# Usage :
#   ./scripts/gen-prod-secrets.sh
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

TEMPLATE=".env.prod.example"
OUT=".env.prod"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Erreur : $TEMPLATE introuvable." >&2
  exit 1
fi

if [[ -f "$OUT" ]]; then
  read -r -p "$OUT existe déjà. Écraser ? (y/N) " ok
  [[ "${ok:-}" =~ ^[Yy]$ ]] || { echo "Abandon."; exit 1; }
fi

# Hex (24 octets = 48 chars) pour les mots de passe utilisés dans des URLs
# (postgres://, mqtt://) → aucun caractère spécial à échapper.
gen_url_safe() { openssl rand -hex 24; }

# Base64 (48 octets) pour JWT_SECRET — usage interne HMAC, plus dense.
gen_jwt() { openssl rand -base64 48 | tr -d '\n'; }

PG_PASS=$(gen_url_safe)
MQTT_API=$(gen_url_safe)
MQTT_INGEST=$(gen_url_safe)
MQTT_RULES=$(gen_url_safe)
MQTT_SIM=$(gen_url_safe)
JWT=$(gen_jwt)

# sed avec délimiteur '|' pour ne pas conflit avec les / éventuels du JWT base64
sed \
  -e "s|__CHANGE_ME__strong_random_pg_password|${PG_PASS}|g" \
  -e "s|__CHANGE_ME__mqtt_api|${MQTT_API}|g" \
  -e "s|__CHANGE_ME__mqtt_ingestor|${MQTT_INGEST}|g" \
  -e "s|__CHANGE_ME__mqtt_rules|${MQTT_RULES}|g" \
  -e "s|__CHANGE_ME__mqtt_sim|${MQTT_SIM}|g" \
  -e "s|__CHANGE_ME__at_least_32_chars_random|${JWT}|g" \
  "$TEMPLATE" > "$OUT"

chmod 600 "$OUT"

# Vérification : aucun __CHANGE_ME__ ne doit subsister
if grep -q "__CHANGE_ME__" "$OUT"; then
  echo "AVERTISSEMENT : il reste des __CHANGE_ME__ non remplacés dans $OUT :" >&2
  grep -n "__CHANGE_ME__" "$OUT" >&2
  exit 2
fi

echo "$OUT généré (chmod 600). Secrets résumés :"
echo "  POSTGRES_PASSWORD       = ${PG_PASS}"
echo "  MQTT_API_PASSWORD       = ${MQTT_API}"
echo "  MQTT_INGESTOR_PASSWORD  = ${MQTT_INGEST}"
echo "  MQTT_RULES_PASSWORD     = ${MQTT_RULES}"
echo "  MQTT_SIMULATOR_PASSWORD = ${MQTT_SIM}"
echo "  JWT_SECRET              = ${JWT:0:16}... (tronqué)"
echo
echo "Prochaine étape :"
echo "  docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
