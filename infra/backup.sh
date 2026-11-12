#!/bin/sh
# Backup diário do banco. Agende no servidor (crontab -e):
#   30 2 * * * cd /caminho/sgi-frota && sh infra/backup.sh
set -e
STAMP=$(date +%Y%m%d-%H%M)
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T db \
  pg_dump -U sgi -Fc sgi_frota > "infra/backups/sgi_frota-$STAMP.dump"
# mantém 30 dias
find infra/backups -name 'sgi_frota-*.dump' -mtime +30 -delete
echo "Backup salvo: infra/backups/sgi_frota-$STAMP.dump"
