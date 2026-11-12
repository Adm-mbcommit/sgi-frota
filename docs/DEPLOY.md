# Implantação

Dois caminhos. O **recomendado é a Vercel** (sem servidor para administrar). O caminho com
Docker em um servidor próprio continua disponível mais abaixo.

## Vercel (recomendado)

Na Vercel o front-end é servido como site estático e a API roda como Função Serverless
(`api/index.mjs` → `apps/api/src/vercel.ts`). O banco é um PostgreSQL gerenciado (Neon), ligado pelo
Marketplace da Vercel.

### 1. Projeto
1. Em vercel.com → **Add New… → Project**, importe o repositório `sgi-frota` do GitHub.
2. Deixe **Framework Preset = Other** e **Root Directory** = raiz. Build, instalação e saída já vêm do `vercel.json`.

### 2. Banco
1. No projeto → **Storage → Create Database → Neon (Postgres)**, região **São Paulo (sa-east-1)** se disponível
   (a função da Vercel deve ficar na mesma região: Settings → Functions → Region → `gru1`).
2. Conecte ao projeto. A Vercel cria a variável `DATABASE_URL` (use a conexão **pooled**).

### 3. Variáveis de ambiente (Settings → Environment Variables, ambiente Production)
| Nome | Valor |
|---|---|
| `JWT_SECRET` | texto aleatório longo (`openssl rand -base64 48`) |
| `SEED_ADMIN_EMAIL` | seu e-mail (primeiro administrador) |
| `SEED_ADMIN_PASSWORD` | senha provisória com 10+ caracteres |
| `JWT_EXPIRES_IN` | opcional, padrão `8h` |

### 4. Deploy
Faça o deploy (ou um push na `main`). No build de produção, `scripts/vercel-build.mjs`:
1. compila core, API e front;
2. aplica as migrações do banco;
3. se o banco estiver vazio e `SEED_ADMIN_*` existirem, carrega o snapshot do artefato e cria o administrador.

Depois do primeiro acesso: troque a senha, **apague `SEED_ADMIN_PASSWORD`** das variáveis e crie os
demais usuários na tela **Usuários**. Domínio próprio: Settings → Domains.

### Observações da Vercel
- **Previews** (branches e pull requests) não aplicam migrações nem carga. Para testar com dados, crie um
  branch de banco no Neon, use-o como `DATABASE_URL` só em Preview e defina `MIGRATE_ON_PREVIEW=1`.
- **Upload de planilhas**: o limite de corpo de requisição da Vercel é 4,5 MB. As planilhas atuais são
  bem menores; se crescerem, exporte só o período recente do Chronos.
- **Limite de tentativas de login**: é contado por instância da função (não global). Para um limite
  global, ligue o Vercel Firewall (rate limiting) na rota `/api/v1/auth/login`.
- **Backup**: o Neon guarda histórico para restauração (point-in-time) conforme o plano; para cópias
  próprias, rode `pg_dump "$DATABASE_URL" -Fc > backup.dump` periodicamente.

---

## Alternativa: servidor próprio com Docker

Um servidor Linux (VPS) com Docker, um domínio próprio e HTTPS automático.

## 1. Servidor

- VPS com 2 vCPU, 2 GB de RAM e 20 GB de disco é suficiente (ex.: Hetzner, DigitalOcean, AWS Lightsail, Magalu Cloud, Locaweb).
- Ubuntu 24.04 LTS, com [Docker Engine](https://docs.docker.com/engine/install/ubuntu/) instalado.
- Firewall: liberar só 22 (SSH), 80 e 443.
- Criar um registro DNS `A` do domínio (ex.: `frota.suaempresa.com.br`) apontando para o IP do servidor.

## 2. Subir

```bash
git clone <repositório> sgi-frota && cd sgi-frota
cp infra/.env.prod.example infra/.env.prod
nano infra/.env.prod   # DOMAIN, POSTGRES_PASSWORD (openssl rand -base64 32), JWT_SECRET (openssl rand -base64 48)
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

A API aplica as migrações ao iniciar. O Caddy emite o certificado HTTPS na primeira requisição.

## 3. Carga inicial e primeiro usuário

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec api node apps/api/dist/db/seed.js
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec api node apps/api/dist/db/create-user.js voce@empresa.com.br "Seu Nome" "senha-com-10+-caracteres" ADMIN
```

Depois, crie os demais usuários pela tela **Usuários**.

## 4. Atualizar versão

```bash
git pull
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

## 5. Backup

`infra/backup.sh` gera um dump diário em `infra/backups/` e mantém 30 dias. Agende no `crontab` e
**copie os dumps para fora do servidor** (ex.: Google Drive via rclone, S3). Restaurar:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T db pg_restore -U sgi -d sgi_frota --clean < infra/backups/ARQUIVO.dump
```

## Segurança — lista de verificação

- [ ] `JWT_SECRET` e `POSTGRES_PASSWORD` longos e aleatórios; `.env.prod` fora do Git.
- [ ] Banco sem porta exposta (o compose de produção não publica a 5432).
- [ ] HTTPS ativo (Caddy) com HSTS.
- [ ] Senhas de no mínimo 10 caracteres; login limitado a 10 tentativas por minuto por IP.
- [ ] Usuários com o menor perfil necessário; desativar quem sair da empresa.
- [ ] Backups testados (restaure um dump em outro banco de vez em quando).
- [ ] Atualizações do sistema operacional automáticas (`unattended-upgrades`).

