# COE Finance Claims Portal

An internal finance portal for managing claims across legal entities. Built with Next.js App Router, Better Auth (Google SSO), Drizzle ORM, and PostgreSQL.

---

## Prerequisites

Ensure the following are installed before getting started:

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | v20+ | |
| [pnpm](https://pnpm.io/) | v9+ | `npm install -g pnpm` |
| [Docker](https://www.docker.com/) | Any recent version | For running PostgreSQL locally |
| A Google Cloud project | — | OAuth 2.0 credentials required (see below) |

---

## 1. Start PostgreSQL with Docker

```bash
docker run -d \
  --name finance-coe-db \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=postgres \
  -p 5432:5432 \
  postgres:16
```

When pc is restarted, you can start the container:

```bash
docker start finance-coe-db
```


To stop and remove the container:

```bash
docker stop finance-coe-db && docker rm finance-coe-db
```

---

## 2. Configure Environment Variables

Copy the example below into a `.env.local` file at the project root:

```bash
# Database
DATABASE_URL=postgresql://admin:yourpassword@127.0.0.1:5432/postgres

# Better Auth
BETTER_AUTH_SECRET=        # generate with: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Access control — comma-separated allowed email domains
ALLOWED_EMAIL_DOMAIN=yourcompany.com

# Comma-separated emails that are bootstrapped as Admin on first login
BOOTSTRAP_ADMIN_EMAILS=admin@yourcompany.com
```

### Getting Google OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an **OAuth 2.0 Client ID** (Application type: Web application).
3. Add `http://localhost:3000/api/auth/callback/google` to **Authorised redirect URIs**.
4. Copy the Client ID and Client Secret into `.env.local`.

---

## 3. Run the Application Locally

### Install dependencies

```bash
pnpm install
```

### Run database migrations

```bash
pnpm db:migrate
```

### Start the development server

```bash
pnpm dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the development server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start` | Start the production server |
| `pnpm lint` | Run ESLint |
| `pnpm db:generate` | Generate a new Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations to the database |
| `pnpm db:seed` | Seed the database (bootstrap admin users) |

---

## First-time Setup

1. Start the app and navigate to [http://localhost:3000](http://localhost:3000).
2. Sign in with a Google account whose email matches `BOOTSTRAP_ADMIN_EMAILS` — this account is automatically granted the Admin role.
3. Go to **Admin → Entities** and create your legal entities (e.g. `apd-my`, `apd-sg`).
4. Go to **Admin → User Management** and add users for your organisation.
