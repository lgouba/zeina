# `services/simulator`

Capteurs et actionneurs virtuels publiant sur MQTT au format ZEINA. Tourne en
production tant que le hardware réel n'est pas déployé. Le contrat MQTT est
identique entre simulator et hardware ; substitution sans changer le reste de
la stack.

## Démarrage

```bash
cd /Users/macos/zeina
docker compose up -d simulator      # construit l'image et démarre
docker compose logs -f simulator
```

Subscribe pour observer :

```bash
make mqtt-sub t='qlab/#'
```

## Configuration

[`simulator.yml`](./simulator.yml) — montée en volume sur
`/etc/simulator/simulator.yml`. Modifier puis :

```bash
docker compose restart simulator
```

### Format

```yaml
broker: tcp://mosquitto:1883
username: simulator
password: changeme_sim
tenant: acme
seed: 42                  # détermine la séquence pseudo-aléatoire (reprod tests)
measurement_qos: 0        # mesures
state_qos: 1              # ACK actuator (au moins une fois)

sites:
  - id: hq-ouaga
    zones:
      - id: open-space-1
        devices:
          - id: env-01
            type: environment
            measurements: [temperature, humidity, co2, lux]
            interval: 30s
            couplings:
              presence: pir-01            # lit le bool présence
              light_relay: relay-light-01 # lit "on"/"off"
          - id: pir-01
            type: presence
            interval: 5s
            schedule: "occupied 08:00-18:00 mon-fri"
          - id: relay-light-01
            type: actuator
            initial_state: "off"
```

**Contraintes :**
- Slugs `[a-z0-9][a-z0-9_-]*` (mêmes règles que les topics MQTT).
- Slugs de device **uniques au niveau site** (le bus est site-wide).
- Au moins un site avec au moins une zone avec au moins un device.

## Profils disponibles

| Type | Mesures | Comportement |
|---|---|---|
| `environment` | `temperature`, `humidity`, `co2`, `lux` (au choix) | Modèles couplés : T° diurne 22→27°C avec drift +1.5°C si occupé, humidité anti-corrélée à T° au-delà de 25°C, CO2 exponentiel 400→1200 ppm selon occupation, lux selon heure + bonus si relais lumière "on" |
| `presence` | `presence` (0/1) | Suit `schedule` ; 90 % du temps présent en heures ouvrées, 5 % hors créneau ; publie aussi un bool sur le bus pour les voisins |
| `linky` | `papp`, `pact`, `iinst`, `urms`, `base` | Charge base 200 W + 400 W si lumière du site ON + 200 W si présence + 1500 W de clim entre 13h–17h ; index énergie monotone (intégrale de pact) |
| `actuator` | aucune | Pas de tick périodique ; publie son state initial, écoute `cmd/+`, met à jour le bus + republie `state` avec `cmd_id` corrélation |

## Couplages (bus site-wide)

```
        ┌─────────┐                ┌──────────┐
        │  pir-01 │ ──presence───▶ │  env-01  │ (CO2, T°)
        └─────────┘                └──────────┘
              │                          ▲
              ▼                          │
         (bus site)                ┌──────────┐
              ▲                    │ linky-01 │ (pact)
              │                    └──────────┘
        ┌─────────────┐                  ▲
        │ relay-light │ ─state "on/off"──┘
        └─────────────┘
```

- Un capteur d'environnement lit l'état du `relay-light` voisin pour ses lux.
- Le Linky du tableau électrique lit l'état des relais des autres zones du
  même site pour chiffrer la consommation totale.
- Le bus est en mémoire, scoped au site, thread-safe.

## Déterminisme

Avec un `seed` constant, chaque device génère exactement la même séquence
(seed final = `seed XOR fnv64(device_id)`). Utile pour les tests et les démos
reproductibles.

## Test command → ACK round-trip

```bash
# Subscribe à l'état du relais
docker compose exec mosquitto mosquitto_sub -u api -P changeme_api \
  -t 'qlab/+/+/+/relay-light-01/state' -v &

# Envoyer la commande
docker compose exec mosquitto mosquitto_pub -u api -P changeme_api \
  -t 'qlab/acme/hq-ouaga/open-space-1/relay-light-01/cmd/set' \
  -m '{"id":"cmd-001","ts":"2026-05-05T21:00:00Z","payload":{"state":"on"}}'

# Reçu :
#   qlab/acme/hq-ouaga/open-space-1/relay-light-01/state
#   {"ts":"...","cmd_id":"cmd-001","state":{"state":"on"}}
```

## Architecture

```
cmd/simulator/main.go     # entrypoint : load config, spawn N goroutines, signaux
internal/
├── config/               # YAML parsing + validation slugs/types
├── bus/                  # état partagé site-wide thread-safe
├── scheduler/            # parser "occupied HH:MM-HH:MM mon-fri"
├── publisher/            # wrapper shared/mqtt + builder topics ZEINA
├── profiles/             # interface Profile + 4 implémentations
└── runner/               # boucle ticker + dispatcher commandes
```

## Observabilité

Logs JSON structurés zerolog, niveau via `LOG_LEVEL` env (`info` par défaut).
Chaque ligne porte `service=simulator`, `device=<slug>`, `zone=<slug>`,
`type=<environment|presence|...>` quand applicable.

```bash
docker compose logs simulator | jq 'select(.device == "linky-01")'
```

## Build & test

```bash
cd /Users/macos/zeina
make build      # build du binaire (via container Go)
make test       # tests unitaires de tous les modules avec -race
```

Tests inclus :
- `bus_test.go` — concurrent set/get, type-checking
- `scheduler_test.go` — parsing horaires, plages overnight, plages de jours circulaires
- `config_test.go` — YAML happy path, validation slug, doublons, types inconnus
- `profile_test.go` — déterminisme avec seed, montée du CO2 quand occupé,
  réponse lux au relais, ACK actuator avec corrélation `cmd_id`,
  monotonie de l'index énergie Linky
