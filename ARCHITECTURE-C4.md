# Cybersecurity Command Centre: C4 Architecture

## C1: System Context

```mermaid
flowchart LR
    User[Security Analyst / Admin]
    System[Cybersecurity Command Centre]

    Telegram[Telegram Platform]
    Email[SMTP Service]
    Wazuh[Wazuh SIEM]
    Suricata[Suricata IDS]
    Prometheus[Prometheus Alertmanager]

    User --> System
    Wazuh --> System
    Suricata --> System
    Prometheus --> System
    System --> Telegram
    System --> Email
```

System purpose:
- ingest security signals
- coordinate incident response
- provide dashboards, ticketing, and reporting

## C2: Container View

```mermaid
flowchart TB
    subgraph Client
        Browser[Web Browser]
    end

    subgraph Application
        Frontend[Frontend SPA\nReact + Vite\nPort 5173]
        NodeAPI[Primary API\nNode.js + Express\nPort 8001]
        PyAPI[Legacy/Scaffold API\nFastAPI\nPort 8000/8001]
    end

    subgraph Data
        NodeDB[(SQLite Node DB)]
        PyDB[(SQLite Python DB)]
    end

    subgraph External
        TG[Telegram API]
        SMTP[SMTP]
        WAZUH[Wazuh]
        SURI[Suricata]
        PROM[Prometheus]
    end

    Browser --> Frontend
    Frontend --> NodeAPI
    Frontend -. optional legacy path .-> PyAPI

    NodeAPI --> NodeDB
    PyAPI --> PyDB

    NodeAPI --> TG
    NodeAPI --> SMTP

    WAZUH --> NodeAPI
    SURI --> NodeAPI
    PROM --> NodeAPI
```

Container responsibilities:

Frontend SPA:
- dashboard rendering
- token/session handling
- API orchestration for tickets, findings, reports

Node API (primary):
- authn/authz, incident/ticket workflows
- security findings ingestion
- automation jobs and reporting
- notifications and governance logs

FastAPI (secondary):
- scaffold API, webhook and SSE functions
- narrower endpoint surface than Node API

## C3: Component View (Node API)

```mermaid
flowchart LR
    App[app.js bootstrap]

    Auth[Auth + RBAC\nJWT middleware]
    Users[Users Route]
    Tickets[Tickets Route]
    Security[Security Route]
    Connectors[Security Connectors Route]
    Assistant[Assistant Route]
    Reports[Reports + Governance Endpoints]

    Engine[Security Engine Service]
    AssistSvc[Ticket Assist Service]
    Tele[Telegram Adapter]
    Mail[Mailer Adapter]

    Models[Sequelize Models]
    DB[(SQLite/PostgreSQL target)]

    App --> Auth
    App --> Users
    App --> Tickets
    App --> Security
    App --> Connectors
    App --> Assistant
    App --> Reports

    Tickets --> AssistSvc
    Security --> Engine
    Connectors --> Engine
    Assistant --> AssistSvc

    Tickets --> Tele
    Tickets --> Mail

    Users --> Models
    Tickets --> Models
    Security --> Models
    Connectors --> Models
    Assistant --> Models
    Reports --> Models

    Models --> DB
```

Key component details:

Auth and RBAC:
- bearer JWT validation
- role enforcement for admin-only operations

Tickets:
- lifecycle transitions (identified to closed)
- SLA and impact metadata
- comments, action-items, history, resolution reports

Security:
- findings, asset health, executive impact, threat intel views
- network and database monitoring APIs

Connectors:
- receives Wazuh/Suricata/Prometheus payloads
- signature/secret validation, replay protection, dead-letter handling

Assistant:
- command-centre summaries
- triage/ticket/alert analysis recommendations

## C4: Code/Module Mapping

Frontend modules:
- api client: frontend/src/api.js
- application shell: frontend/src/App.jsx
- styling/theme: frontend/src/App.css

Node backend modules:
- bootstrap + wiring: node-backend/src/app.js
- domain routes: node-backend/src/routes/*.js
- ingestion service: node-backend/src/services/securityEngine.js
- model bootstrap: node-backend/src/models/index.js
- integration adapters: node-backend/src/telegram.js, node-backend/src/mailer.js

Python backend modules:
- API root: backend/app/main.py
- auth/data services: backend/app/auth.py, backend/app/crud.py

## Cross-Cutting Concerns

Security:
- helmet, express-rate-limit, CORS policy, validator/sanitizer

Observability:
- request logs via morgan
- audit logs persisted in DB

Reliability:
- dead-letter queue for failed connector ingests
- scheduled automation routines for recurring security checks

## Architectural Constraints

- Dual backend introduces routing ambiguity if ports are misaligned.
- SQLite is suitable for local/dev but not ideal for HA production workloads.
- Connector replay and rate-limit state currently local-process scoped.

## Suggested C4 Evolution

1. Remove ambiguity by assigning one production API boundary.
2. Promote shared services (DB, Redis, observability) as first-class containers.
3. Add API gateway/WAF and identity provider container in production C2 diagram.
