# `packages/shared`

Module Go partagé par les 4 services backend (api, ingestor, rules-engine,
simulator). Toute logique transversale vit ici pour garantir un comportement
identique côté ingest, API, moteur de règles et simulateur.

## Sous-paquets

| Paquet | Responsabilité |
|---|---|
| `domain/` | Types métier (`UserRole`, `DeviceType`, `Quality`, `CommandStatus`, ...) + payload MQTT (`Payload`, `CommandPayload`, `StatePayload`) avec décodage strict |
| `topics/` | Convention `qlab/{tenant}/{site}/{zone}/{device}/{measurement|cmd/{action}|state}` — `Build*Topic`, `Parse`, `Subscription*` |
| `mqtt/` | Wrapper paho avec reconnexion auto exponentielle, LWT, contexte propagé |
| `logger/` | Setup zerolog (JSON ou console), `WithRequestID` + récupération depuis `context.Context` |
| `jwt/` | `Signer` HS256, `SignAccess`/`SignRefresh`/`ParseAccess`/`ParseRefresh` |
| `errors/` | `AppError` + `Kind` mappé sur HTTP — utilisé partout pour erreurs typées |
| `config/` | Helpers viper : `NewLoader`, `LoadFile`, `Unmarshal` (YAML + env) |
| `db/` | `NewPool` (pgxpool avec retry au démarrage) |
| `db/sqlc/` | Code généré par sqlc — **NE PAS ÉDITER** ; régénérer via `make sqlc` |

## Convention des topics MQTT

```
qlab/{tenant}/{site}/{zone}/{device}/{measurement}      # mesure
qlab/{tenant}/{site}/{zone}/{device}/cmd/{action}       # commande
qlab/{tenant}/{site}/{zone}/{device}/state              # ACK / état
```

Tous les segments matchent `[a-z0-9][a-z0-9_-]*`. Ni `/`, ni `+`, ni `#` autorisés.
Caché par `topics.BuildMeasurementTopic` / `topics.Parse` qui valident.

## Format payload mesure

```json
{ "ts": "2026-05-05T14:23:01Z", "value": 23.4, "unit": "celsius", "quality": "good" }
```

`quality ∈ {good, uncertain, bad}` — vide = `good` par défaut. Validation des
bornes par measurement faite par l'ingestor en consultant `measurements_metadata`.

## Workflow dev

```bash
make sqlc        # régénère db/sqlc/ depuis queries/*.sql + migrations/
make tidy        # go mod tidy sur tous les modules du workspace
make build       # go build ./... sur tous les modules avec du code
make test        # go test -race -count=1 sur tous les modules
make lint        # golangci-lint (ajouter .golangci.yml à l'étape 4)
```

## Tests

- `topics/topics_test.go` — table tests Build/Parse, segments invalides, round-trip
- `jwt/jwt_test.go` — sign/parse, rejet tokens expirés/falsifiés/cross-signer

## Note sur `db/sqlc`

Le code y est généré à partir de :
- `queries/*.sql` (à la racine du repo) — requêtes annotées `-- name: Foo :one|:many|:exec`
- `migrations/*.sql` (à la racine du repo) — sqlc reconstruit le schéma pour typer les colonnes

`sqlc.yaml` (à la racine) configure :
- driver `pgx/v5`
- override `uuid` → `github.com/google/uuid.UUID`
- override `timestamptz` → `time.Time`
- override `jsonb` → `encoding/json.RawMessage`

Toute modification d'une migration ou d'une query nécessite `make sqlc`.
