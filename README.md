# ZEINA — Hyperviseur Énergie & Environnement

Plateforme SaaS B2B de collecte, supervision et pilotage de capteurs
d'environnement et d'énergie installés dans des sites clients (écoles, bureaux,
hôtels, supermarchés, agences bancaires). Objectif : **réduction de la
consommation énergétique** via un moteur de règles déclaratif.

## État actuel

**Étape 1 — fondations infra terminée :**

- Workspace Go (4 services + 1 package partagé) avec stubs `go.mod` + `go.work`
- Schéma TimescaleDB complet (tenants/users/sites/zones/devices/rules/commands)
  + hypertable `measurements` avec compression et continuous aggregates
  (1min, 15min, 1h, 1jour) + politiques de rétention
- `sqlc.yaml` + 7 fichiers de queries
- Mosquitto 2.x avec ACL par rôle (api / ingestor / rules / simulator)
- `docker-compose.yml` (timescaledb + mosquitto + redis + migrate)
- `Makefile` orchestrant up/down, migrations, sqlc, MQTT pub/sub, psql

Les services Go (api, ingestor, rules-engine, simulator) seront implémentés
aux étapes suivantes.

## Démarrage rapide

```bash
cp .env.example .env       # copier puis éditer les mots de passe
make up                    # démarre db + mqtt + redis
make ps                    # vérifier que tout est healthy (~30s)
make migrate-up            # applique les migrations TimescaleDB

# tester :
make psql                  # ouvrir psql
make mqtt-sub t='qlab/#'   # écouter tous les topics
make mqtt-pub t=qlab/test/site/zone/dev/temperature m='{"ts":"2026-05-05T14:00:00Z","value":23.4,"unit":"celsius","quality":"good"}'
```

## Structure du repo

```
hyperviseur/
├── go.work                     # workspace Go (5 modules)
├── Makefile                    # orchestration (up/migrate/sqlc/...)
├── docker-compose.yml          # infra : timescaledb, mosquitto, redis, migrate
├── .env.example                # variables d'env (à copier vers .env)
├── sqlc.yaml                   # génération code SQL → Go
├── migrations/                 # golang-migrate (versioned, up/down)
│   ├── 0001_init.up.sql        # schéma + hypertable
│   ├── 0001_init.down.sql
│   ├── 0002_continuous_aggregates.up.sql
│   └── 0002_continuous_aggregates.down.sql
├── queries/                    # fichiers .sql consommés par sqlc
│   ├── tenants.sql
│   ├── users.sql
│   ├── sites.sql
│   ├── zones.sql
│   ├── devices.sql
│   ├── measurements.sql
│   ├── rules.sql
│   └── commands.sql
├── mosquitto/config/           # mosquitto.conf + ACL (passwd généré au boot)
├── db/init/                    # scripts d'init Postgres (extensions)
├── scripts/
│   └── mosquitto-bootstrap.sh  # génère /mosquitto/config/passwd à partir d'env vars
├── packages/shared/            # module Go partagé (étape 2)
├── services/
│   ├── api/                    # Echo v4 + JWT + WS (étapes 5+)
│   ├── ingestor/               # MQTT → Timescale (étape 4)
│   ├── rules-engine/           # moteur de règles (étape 7)
│   └── simulator/              # capteurs virtuels (étape 3)
├── frontend/                   # React + Vite + Tailwind + shadcn (étape 6+)
└── openapi/                    # spec OpenAPI 3.1 (étape 5)
```

## Convention de topics MQTT

```
qlab/{tenant}/{site}/{zone}/{device}/{measurement}            # mesures
qlab/{tenant}/{site}/{zone}/{device}/cmd/{action}             # commandes
qlab/{tenant}/{site}/{zone}/{device}/state                    # ACK actuateur
```

**Payload JSON standard** :

```json
{
  "ts": "2026-05-05T14:23:01.000Z",
  "value": 23.4,
  "unit": "celsius",
  "quality": "good"
}
```

`quality ∈ {good, uncertain, bad}`. Validation des bornes par
`measurements_metadata` côté ingestor.

## Stack

- **Backend** : Go 1.22+, Echo v4, pgx/v5, sqlc, golang-migrate, paho.mqtt
- **DB** : PostgreSQL 16 + TimescaleDB 2.17 (hypertables, compression,
  continuous aggregates)
- **MQTT** : Mosquitto 2.0 (auth user/password + ACL)
- **Cache / état rules** : Redis 7
- **Frontend** : React 18 + Vite + TypeScript + Tailwind + Recharts + shadcn/ui
- **Infra** : Docker Compose, images distroless

## Roadmap

| Étape | Contenu                                                        | Statut |
| ----- | -------------------------------------------------------------- | ------ |
| 1     | Workspace + Docker Compose + DB + sqlc + migrations            | ✅ |
| 2     | Package `shared` (topics, domain, logger, jwt, mqtt, errors, config, db) | ✅ |
| 3     | Simulator (4 profils + actuateur, bus site-wide, déterminisme seed) | ✅ |
| 4     | Ingestor MQTT → TimescaleDB (batch CopyFrom + métriques Prometheus) | ✅ |
| 5     | API : auth JWT + CRUD + mesures (raw/1m/15m/1h/1d) + commandes MQTT + WebSocket | ✅ |
| 6     | Frontend React + Tailwind : login, dashboard, vue site live + actions relais | ✅ |
| 7     | Rules-engine + UI builder règles                               | ⏳ |
| 8     | Commandes actuateur (UI + API + MQTT + ACK)                    | ⏳ |
| 9     | Tests unit + intégration + E2E Playwright + k6                 | ⏳ |
| 10    | Seed démo + bibliothèque règles + déploiement VPS              | ⏳ |

## Voir aussi

- `make help` — toutes les cibles disponibles
- `mosquitto/config/acl` — ACL par rôle MQTT
- `sqlc.yaml` — config de génération du code DB
