#!/bin/sh
# =============================================================================
# Génère /mosquitto/config/passwd à partir des variables d'env, puis lance
# mosquitto. Idempotent : reconstruit le fichier passwd à chaque démarrage.
# =============================================================================
set -eu

PASSWD_FILE=/mosquitto/config/passwd

: "${MQTT_API_USER:?}"        ; : "${MQTT_API_PASSWORD:?}"
: "${MQTT_INGESTOR_USER:?}"   ; : "${MQTT_INGESTOR_PASSWORD:?}"
: "${MQTT_RULES_USER:?}"      ; : "${MQTT_RULES_PASSWORD:?}"
: "${MQTT_SIMULATOR_USER:?}"  ; : "${MQTT_SIMULATOR_PASSWORD:?}"

# Reset
: > "$PASSWD_FILE"

mosquitto_passwd -b "$PASSWD_FILE" "$MQTT_API_USER"        "$MQTT_API_PASSWORD"
mosquitto_passwd -b "$PASSWD_FILE" "$MQTT_INGESTOR_USER"   "$MQTT_INGESTOR_PASSWORD"
mosquitto_passwd -b "$PASSWD_FILE" "$MQTT_RULES_USER"      "$MQTT_RULES_PASSWORD"
mosquitto_passwd -b "$PASSWD_FILE" "$MQTT_SIMULATOR_USER"  "$MQTT_SIMULATOR_PASSWORD"

# Le démon mosquitto drop ses privilèges vers l'utilisateur "mosquitto" après
# le bind sur les ports : il faut qu'il puisse lire passwd + acl.
chown mosquitto:mosquitto "$PASSWD_FILE"
chmod 0640 "$PASSWD_FILE"
[ -f /mosquitto/config/acl ] && {
  chown mosquitto:mosquitto /mosquitto/config/acl
  chmod 0640 /mosquitto/config/acl
}

echo "[mosquitto-bootstrap] passwd file ready with 4 users"

exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
