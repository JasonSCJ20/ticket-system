# Node Express Cybersecurity Ticketing Backend

## Setup
1. `cd node-backend`
2. copy `.env.example` to `.env` and fill keys
3. `npm install`
4. `npm run dev` (requires nodemon) or `npm start`

## Routes
- POST `/webhook/telegram` (Telegram webhook)
- POST `/api/users` {name, telegramId}
- GET `/api/users`
- GET `/api/tickets`
- POST `/api/tickets` {title, description, priority, assigneeId, creatorId}
- PATCH `/api/tickets/:id` {status, assigneeId...}
- GET `/api/tickets/:id/history`
- GET `/api/reports/monthly`

## Telegram setup
Set webhook:
`https://api.telegram.org/bot<token>/setWebhook?url=https://<your-host>:8001/webhook/telegram`

## Notes
- Sequelize uses SQLite by default.
- Monthly report cron job runs at 09:00 UTC on first day.
