# Deployment Notes for Cybersecurity Ticket System

## Quick-start: Docker Compose (recommended)

```bash
# 1. Copy and fill in secrets — never commit this file.
cp node-backend/.env.example .env
$env:SECRET_KEY       = (openssl rand -hex 32)   # or any 32+ char secret
$env:ADMIN_PASSWORD   = "your-strong-password"
$env:POSTGRES_PASSWORD = "your-db-password"
$env:DATABASE_URL     = "postgresql://ccc:${POSTGRES_PASSWORD}@postgres:5432/ccc_prod"

# 2. Build and start all services.
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# 3. Tail logs.
docker compose -f docker-compose.prod.yml logs -f
```

The stack starts:
| Container | Role | Port |
|-----------|------|------|
| `postgres` | PostgreSQL 16 | internal only |
| `node-api` | Node/Express API | internal only |
| `frontend` | React SPA (nginx:alpine) | internal only |
| `nginx` | Reverse proxy | `80`, `443` (public) |

---

## Quick-start: PM2 (bare-metal / VPS)

```bash
# Install PM2 globally once.
npm install -g pm2

# Start with crash-restart.
pm2 start ecosystem.config.cjs

# Start in cluster mode (uses all CPU cores).
PM2_INSTANCES=max pm2 start ecosystem.config.cjs --env production

# Persist across reboots.
pm2 save
pm2 startup
```

---

## Production Environment Setup

### 1. Secrets Management

- Use Azure Key Vault, AWS Secrets Manager, or HashiCorp Vault for secrets.
- Never commit secrets to code; use environment variables or vault references.
- Rotate secrets regularly (e.g., JWT secret every 30 days).
- For Telegram bot token: store in vault and inject at runtime.
- **Startup guard**: If `NODE_ENV=production` and any default secret is detected, the process exits immediately with a descriptive error message.

### 2. Environment Variables

Set these in your deployment platform (e.g., Azure App Service, AWS ECS, Docker Compose):

```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname  # Use PostgreSQL in prod
TELEGRAM_BOT_TOKEN=<vault-ref>
MONTHLY_REPORT_CHAT_ID=<vault-ref>
SECRET_KEY=<vault-ref>  # 32+ char random string, NOT "PLEASE_CHANGE_ME"
ADMIN_USERNAME=<vault-ref>
ADMIN_PASSWORD=<vault-ref>
PORT=8001
NODE_ENV=production
```

### 3. Database

- `DATABASE_URL` dialect is auto-detected: `postgresql://` → postgres, `mysql://` → mysql, `sqlite://` → sqlite (dev only).
- Run `sequelize db:migrate` (or let `sync({ alter: true })` handle it on first boot) before going live.
- Enable connection pooling (configured automatically for non-SQLite dialects: max 10, min 2).

### 4. HTTPS and TLS (bare-metal)

```bash
# Install certbot and get a cert.
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com

# Copy the production nginx config, update YOUR_DOMAIN.
sudo cp nginx.conf /etc/nginx/sites-available/ccc
sudo sed -i 's/YOUR_DOMAIN/your-domain.example.com/g' /etc/nginx/sites-available/ccc
sudo ln -s /etc/nginx/sites-available/ccc /etc/nginx/sites-enabled/ccc
sudo nginx -t && sudo systemctl reload nginx
```

### 5. HTTPS and TLS (Docker)

Mount your certs into `./ssl/` at the repo root:
```
ssl/
  fullchain.pem
  privkey.pem
```
Then uncomment the HTTPS `server {}` block in `nginx.docker.conf`.

### 6. Monitoring and Logging

- Integrate with Azure Monitor, AWS CloudWatch, or ELK stack.
- Log security events (failed logins, rate limits) to SIEM.
- Set up alerts for anomalies.
- PM2 logs: `pm2 logs` or `~/.pm2/logs/`.

### 7. Rate Limiting

- Auth-path rate limiting (`forgot-password/request` and `forgot-password/reset`) is now DB-backed (`AuthRateLimits` table).
- Survives process restarts and works across PM2 cluster workers.
- Global API rate limit (`express-rate-limit`, 200 req/15 min) remains in-memory per process; use Redis adapter for multi-instance deployments.

### 8. Backup and Recovery

- Daily DB backups to encrypted storage.
- Test restore procedures quarterly.

### 9. Scaling

- Use PM2 cluster mode (`PM2_INSTANCES=max`) on a single host.
- For multi-host: Docker Swarm or Kubernetes (Helm chart in `helm/`).
- Move global `express-rate-limit` to `rate-limit-redis` adapter when scaling horizontally.

### 10. Security Scans

- Run `npm audit --audit-level=high` in CI (currently passes at high level).
- Use OWASP ZAP for dynamic scans.
- Known accepted risk: `request` SSRF (moderate) in `node-telegram-bot-api` — see `SECURITY.md` AR-001.

### 11. Compliance

- Ensure GDPR/CCPA compliance for user data.
- Audit logs for SOX/PCI if applicable.

