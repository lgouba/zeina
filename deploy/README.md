# Déploiement ZEINA — VPS qalitylabs.fr

## Architecture

```
Internet
   │
   ▼
jwilder/nginx-proxy + acme-companion (réseau apps_web, déjà en place)
   │   ↳ vhosts auto-générés depuis VIRTUAL_HOST des containers
   │   ↳ certificats Let's Encrypt auto-émis et renouvelés
   │
   ├── zeina.qalitylabs.fr      → zeina-frontend:80   (SPA + proxy interne /v1/*)
   └── api-zeina.qalitylabs.fr  → zeina-api:3000      (REST + WebSocket)

Réseau Docker `zeina` (privé) :
   timescaledb, mosquitto, redis, ingestor, rules-engine, simulator, iotsens-*
```

La SPA appelle des chemins **relatifs** (`/v1/*`) → proxifiés en interne par le nginx du container frontend → pas de CORS croisé. `api-zeina.qalitylabs.fr` est exposé pour Bruno / Swagger / intégrateurs externes.

## Pré-requis sur le VPS

- ✅ Docker + docker compose v2
- ✅ Réseau Docker externe `apps_web`
- ✅ Containers `nginx-proxy` (jwilder) + `nginx-acme` (acme-companion) déjà en place
- DNS pointés vers l'IP du VPS :
  - `zeina.qalitylabs.fr      A  <ip_vps>`
  - `api-zeina.qalitylabs.fr  A  <ip_vps>`

## Étapes de déploiement

### 1. Cloner le projet

```bash
cd /opt
git clone <repo> zeina && cd zeina
# ou rsync depuis local si pas encore en repo git
```

### 2. Configurer les secrets

```bash
cp .env.prod.example .env.prod
openssl rand -base64 48               # générer JWT_SECRET fort
nano .env.prod                        # remplir tous les __CHANGE_ME__
chmod 600 .env.prod
```

### 3. Build + démarrage

```bash
docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build
```

**nginx-proxy détecte automatiquement** les nouveaux containers via leurs env vars `VIRTUAL_HOST` et regénère sa config. **acme-companion** émet les certificats Let's Encrypt dans la foulée (peut prendre 30-60 s la première fois).

### 4. Appliquer les migrations DB

```bash
docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  --profile tools run --rm migrate up
```

### 5. Vérification

```bash
# Frontend
curl -I https://zeina.qalitylabs.fr

# API
curl https://api-zeina.qalitylabs.fr/v1/health
curl -I https://api-zeina.qalitylabs.fr/docs

# Logs nginx-proxy si ça ne route pas
docker logs nginx-proxy --tail 50
docker logs nginx-acme --tail 50      # cert émission/renouvellement
```

Login navigateur sur `https://zeina.qalitylabs.fr` avec les creds du tenant `acme`.
**Modifier le password admin par défaut avant ouverture publique.**

## Mises à jour

```bash
cd /opt/zeina
git pull
docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build api frontend rules-engine ingestor

# Si nouvelle migration :
docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  --profile tools run --rm migrate up
```

## Logs / debug

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f frontend
docker exec -it zeina-timescaledb psql -U zeina -d zeina

# Voir la config nginx-proxy générée
docker exec nginx-proxy cat /etc/nginx/conf.d/default.conf | less
```

## Backup DB

```bash
docker exec zeina-timescaledb pg_dump -U zeina -Fc zeina > backup-$(date +%F).dump
```

## Rollback rapide

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
git checkout <previous_tag>
docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  --profile tools run --rm migrate down 1
```

## Notes

- **WebSocket /v1/ws** : nginx-proxy gère nativement l'upgrade HTTP→WS, rien à configurer.
- **Mosquitto** : par défaut `1883` reste publié sur le host (capteurs externes).
  Pour fermer : décommenter `ports: !reset []` dans `docker-compose.prod.yml`.
- **HTTPS pour cookie refresh** : l'API détecte HTTPS via `X-Forwarded-Proto`
  envoyé par nginx-proxy → cookie `Secure` automatique. Rien à configurer côté API.
- **Tenant unique** : `DEMO_TENANT_SLUG=acme` reste hardcodé côté API. Pour
  multi-tenant SaaS, voir limitation dans `project_state.md`.
- **Si certificat ne s'émet pas** : vérifier `docker logs nginx-acme`, le DNS doit
  bien pointer vers l'IP du VPS et le port 80 doit être ouvert (challenge HTTP-01).
