> **Superseded for readiness status (2026-10-21).** This guide predates the import LC lifecycle. The current test inventory, readiness classification and production blockers are in [PRETRADE_IMPLEMENTATION_REPORT.md](PRETRADE_IMPLEMENTATION_REPORT.md). The deployment steps below still apply; its environment-variable names (e.g. `JWT_SECRET`, `STORAGE_MODE`) should be checked against `backend/.env.example`.

# TRADEGUARD INTELLIGENCE: PRODUCTION DEPLOYMENT READINESS GUIDE

**Document Reference:** `DOC-TBML-DEPLOY-2026-V1`  
**Classification:** Operational Runbook & DevOps Deployment Guide  
**System Version:** 1.0.0 (Hardened Production Candidate)  
**Target Architecture:** Docker / Node.js 20 LTS / MongoDB 7.0+ / NGINX Reverse Proxy  
**Date:** October 13, 2026  

---

## 1. Deployment Readiness Status

| Checkpoint | Status | Evidence |
|---|---|---|
| **Backend TypeScript Build** | **READY** | `npm run build` exits code `0`, clean `backend/dist` |
| **Backend Typecheck** | **READY** | `npm run typecheck` exits code `0`, 0 errors |
| **Automated Test Suites** | **READY** | `npm test` passed 28/28 tests across 6 test suites |
| **Frontend Production Bundle** | **READY** | `ng build` exits code `0`, 640 kB initial chunk, 0 CommonJS warnings |
| **Static Assets Protection** | **READY** | Unignored in `.gitignore` (`!frontend/public/**`) |
| **CORS & Header Hardening** | **READY** | `Authorization`, custom headers, `PUT/PATCH` enabled |
| **Formula & Path Security** | **READY** | Verified against CWE-22, CWE-918, CWE-1236 |

---

## 2. Environment Variables Configuration

Create a production `.env` file in `backend/` based on the following template:

```env
# ==============================================================================
# TRADEGUARD INTELLIGENCE — PRODUCTION CONFIGURATION
# ==============================================================================

# Node Environment & Port
NODE_ENV=production
PORT=4000

# Primary MongoDB Connection (Replica Set Recommended)
MONGODB_URI=mongodb://dbuser:StrongPasswordHere@mongo-primary:27017/tradeguard?replicaSet=rs0&authSource=admin
TRADEGUARD_MONGODB_URI=mongodb://dbuser:StrongPasswordHere@mongo-primary:27017/tradeguard?replicaSet=rs0&authSource=admin

# Secondary MongoDB Connection (Optional Geo-Redundant Mirror)
MONGODB_SECONDARY_URI=

# Storage Mode (mongo, local, or dual)
STORAGE_DRIVER=mongo
STORAGE_ALLOW_MEMORY_FALLBACK=false
UPLOAD_DIR=storage/uploads
DATA_DIR=storage/data
COMPLIANCE_DIR=storage/compliance

# JWT & Authentication Secret (Must be 32+ cryptographically random bytes)
# Generate each with: openssl rand -hex 32. Values shorter than 32 characters, or that look like the example
# file, are ignored and production refuses to start on them.
AUTH_SECRET=<32+ random bytes>
# Keys the audit hash chains (HMAC). Keep it in a secret store, not in the database, and not equal to AUTH_SECRET.
AUDIT_HMAC_KEY=<32+ random bytes>
ENABLE_DEMO_LOGIN=false
AUTH_USERS=<JSON array of provisioned users; see backend/.env.example>

# CORS Allowed Origins (Comma-separated)
ALLOWED_ORIGINS=https://tradeguard.yourbank.com,https://aml.yourbank.com

# AI Inference & Analysis Providers (Optional / Fallback to Heuristic Engine)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
AI_PROVIDER=heuristic

# Rate Limiting & Concurrency
MAX_REQUESTS_PER_MINUTE=120
MAX_CONCURRENT_UPLOADS=10
MAX_UPLOAD_SIZE_MB=50

# Automated Sync & Screening Feeds
ENABLE_BACKGROUND_SYNC=true
SYNC_CRON_EXPRESSION=0 2 * * *
```

---

## 3. Production Deployment Prerequisites

1. **Hardware & Operating Environment:**
   - Linux (Ubuntu 22.04 LTS / RHEL 9) or Windows Server 2022.
   - Minimum 4 CPU cores, 8 GB RAM (16 GB recommended for high-volume OCR concurrency).
   - Node.js `>= 20.19.0` (LTS) and npm `>= 10.8.0`.
2. **Database:**
   - MongoDB 7.0+ with WiredTiger storage engine and replica set enabled for change streams.
   - Ensure network firewall permits port 27017 only from backend host.
3. **SSL / TLS Termination:**
   - NGINX or AWS ALB terminating TLS 1.3 with strict HSTS (`max-age=31536000; includeSubDomains`).

---

## 4. Step-by-Step Production Startup Procedures

### Step 1: Clone & Checkout Hardened Branch
```bash
git clone https://github.com/TradeGuard/tradeguard-intelligence.git
cd tradeguard-intelligence
git checkout audit/tbml-production-hardening
```

### Step 2: Install Production Dependencies & Build Backend
```bash
cd backend
npm ci --omit=dev
# Compile TypeScript to dist/
npm run build
```

### Step 3: Build Frontend Production Artifacts
```bash
cd ../frontend
npm ci
npm run build
# Built files output to frontend/dist/frontend/
```

### Step 4: Configure Reverse Proxy (NGINX Example)
```nginx
server {
    listen 443 ssl http2;
    server_name tradeguard.yourbank.com;

    ssl_certificate /etc/ssl/certs/tradeguard.crt;
    ssl_certificate_key /etc/ssl/private/tradeguard.key;

    # Static Frontend SPA
    location / {
        root /var/www/tradeguard/frontend/dist/frontend/browser;
        try_files $uri $uri/ /index.html;
    }

    # API Proxy to Express Backend
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }
}
```

### Step 5: Start Backend Service with Process Manager (PM2)
```bash
cd /var/www/tradeguard/backend
# ONE instance. The job queue, the rate limiter, the fraud history and the file stores are in-process; cluster mode
# (-i max) would give each worker its own copy and split the work. Scale up the host, not out the process.
pm2 start dist/server.js --name "tradeguard-api" -i 1 --max-memory-restart 1G
pm2 save
```

---

## 5. Health Verification & Post-Deployment Smoke Tests

Execute following curl commands to verify service integrity:

1. **System Health Check:**
   ```bash
   curl -s -f http://127.0.0.1:4000/api/health | jq .
   ```
   *Expected Response:*
   ```json
   {
     "status": "healthy",
     "environment": "production",
     "storage": { "driver": "mongo" },
     "queue": { "active": 0, "pending": 0 }
   }
   ```

2. **Compliance Store Health Check:**
   ```bash
   curl -s -f http://127.0.0.1:4000/api/documents/compliance/health | jq .
   ```
   *Expected Response:*
   ```json
   {
     "overallStatus": "HEALTHY",
     "sourcesCount": 8,
     "freshCount": 8,
     "staleCount": 0
   }
   ```

---

## 6. Backup, Disaster Recovery, & Rollback Guidance

1. **Database Backups:**
   - Execute daily automated snapshots using `mongodump`:
     ```bash
     mongodump --uri="$MONGODB_URI" --gzip --archive=/backups/tradeguard_$(date +%F).archive
     ```
2. **Document File Storage:**
   - Back up `storage/` directory containing cryptographic audit trails, original PDFs, and rendered extraction images.
3. **Rollback Procedure:**
   - In case of deployment incident, revert to previous stable release tag:
     ```bash
     git checkout tags/v1.0.0-stable
     cd backend && npm run build
     pm2 restart tradeguard-api
     ```
   - Re-deploy previous frontend static bundle from archive to NGINX root.
