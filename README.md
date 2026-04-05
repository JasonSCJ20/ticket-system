# Cybersecurity Ticket Management System

## Current Runtime (Primary)

- Node backend: Express + Sequelize + SQLite (default local DB)
- Frontend: React + Vite dashboard
- Core local ports:
  - Node API: 8001
  - Frontend: 5173

The Python backend remains in this repository as a legacy/parallel implementation, but the active dashboard API path is the Node backend on port 8001.

## Quick Start

1. Start core services from repository root:
   - PowerShell: .\run-all.ps1
   - CMD: run-all.bat
2. Open the app at http://localhost:5173

Optional legacy backend startup:

- PowerShell: .\run-all.ps1 -IncludePythonBackend
- CMD: run-all.bat --include-python

## Manual Start (Core Services)

1. Node backend:
   - cd node-backend
   - npm install
   - npm run dev
2. Frontend:
   - cd frontend
   - npm install
   - npm run dev

## Testing and Build

- Node backend tests: cd node-backend; npm test
- Frontend production build: cd frontend; npm run build
- Full sign-off precheck (PowerShell): .\\run-signoff-checks.ps1
- Full sign-off precheck (CMD): run-signoff-checks.bat

## Key Features

- Ticket lifecycle, collaboration notes, action items
- Security findings and executive/technical reporting
- Database and network asset visibility
- Patch Management board by asset class and status lanes
- Auth flows: login, registration, forgot username, password reset

## Deployment

- See deployment-notes.md for production guidance
- Helm chart is available in helm/ticket-system/
