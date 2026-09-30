# Docker Access Guide

This guide explains how to run the Canadian Redistribution Map Platform (CRMP) in Docker and open it in a browser. The recommended method builds the image from this repository so your own public Supabase and Google Maps settings are included in the frontend.

## What Docker runs

The production container includes:

- the compiled React frontend;
- the Express API;
- the authenticated WebSocket gateway; and
- the checked-in map data required by the application.

The frontend and backend are served together at [http://localhost:3000](http://localhost:3000). Supabase and Google Maps remain external services, so valid project credentials are required for the corresponding features.

## Prerequisites

Install the following before continuing:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows or macOS, or Docker Engine with the Compose plugin on Linux;
- [Git](https://git-scm.com/) to clone the repository;
- a Supabase project with the SQL migrations from `supabase/migrations` applied; and
- Google Maps keys configured for the APIs described in `.env.example`.

Start Docker and confirm that both Docker and Compose are available:

```bash
docker version
docker compose version
```

## Recommended: build and run with Docker Compose

### 1. Clone the repository

```bash
git clone https://github.com/6Beaming/Canadian-Redistribution-Map-Platform.git
cd Canadian-Redistribution-Map-Platform
```

If the repository is already on your computer, open a terminal in its root directory instead.

### 2. Create the environment file

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux:

```bash
cp .env.example .env
```

Open `.env` and replace every placeholder required by your environment.

| Variable | Used for | Exposure |
| --- | --- | --- |
| `SUPABASE_URL` | Server connection to Supabase | Server only |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side authenticated requests | Publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted database operations | Secret; server only |
| `VITE_SUPABASE_URL` | Browser connection to Supabase | Compiled into frontend |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser authentication | Compiled into frontend |
| `VITE_GOOGLE_MAPS_API_KEY` | Places and Map Tiles in the browser | Compiled into frontend |
| `GOOGLE_MAPS_SERVER_API_KEY` | Postal-code geocoding | Secret; server only |

Do not commit `.env`. Never place a service-role or server Google key in a variable beginning with `VITE_`, because Vite exposes those values to the browser bundle.

For local Docker use, the `DOCKER_*` variables in `.env.example` can remain commented out. Docker Compose automatically uses `http://localhost:3000` for the application origin and authentication redirects.

### 3. Build and start CRMP

```bash
docker compose up --build -d
```

The first build takes longer because Docker installs dependencies and compiles the frontend. Later builds can reuse cached layers.

### 4. Confirm that the container is healthy

```bash
docker compose ps
docker compose logs --tail=100 crmp
```

Then check the health endpoint:

```bash
curl http://localhost:3000/api/health
```

PowerShell users can use:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

A healthy server returns:

```json
{"ok":true}
```

### 5. Open the application

Visit [http://localhost:3000](http://localhost:3000) in a browser.

The repository does not include production secrets or shared test accounts. Create users through the configured Supabase project, subject to that project's authentication settings.

## Stop, restart, or rebuild

Stop and remove the running container and network:

```bash
docker compose down
```

Restart the existing service:

```bash
docker compose restart crmp
```

Rebuild after changing source code or any `VITE_*` value:

```bash
docker compose up --build -d
```

View live logs:

```bash
docker compose logs -f crmp
```

## Optional: run the published GHCR image

The GitHub Actions publishing workflow produces this image from the `main` branch:

```text
ghcr.io/6beaming/canadian-redistribution-map-platform:main
```

If the package is public, pull it directly:

```bash
docker pull ghcr.io/6beaming/canadian-redistribution-map-platform:main
```

If GitHub Container Registry returns `denied` or `403 Forbidden`, authenticate with a GitHub personal access token (classic) that has `read:packages` permission:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

Enter the token when Docker asks for a password, then repeat the pull command.

Run the image with the server settings from your `.env`:

```bash
docker run --rm -d \
  --name crmp \
  --env-file .env \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e CLIENT_ORIGIN=http://localhost:3000 \
  -e SIGNUP_EMAIL_REDIRECT_URL=http://localhost:3000/sign-in \
  -e COMMISSIONER_INVITE_REDIRECT_URL=http://localhost:3000/accept-invite \
  -e PASSWORD_RESET_REDIRECT_URL=http://localhost:3000/reset-password \
  -p 3000:3000 \
  ghcr.io/6beaming/canadian-redistribution-map-platform:main
```

The published image already contains the `VITE_*` values used by its GitHub Actions build. Passing different `VITE_*` values to `docker run` will not change the compiled frontend. To use your own browser-facing Supabase or Google Maps configuration, build the image from source with Docker Compose instead.

Stop the standalone container with:

```bash
docker stop crmp
```

## Deploying at another origin

For a domain or a non-localhost address, set these values in `.env` before building and starting Compose:

```dotenv
DOCKER_CLIENT_ORIGIN=https://your-domain.example
DOCKER_SIGNUP_EMAIL_REDIRECT_URL=https://your-domain.example/sign-in
DOCKER_COMMISSIONER_INVITE_REDIRECT_URL=https://your-domain.example/accept-invite
DOCKER_PASSWORD_RESET_REDIRECT_URL=https://your-domain.example/reset-password
DOCKER_COOKIE_SECURE=true
```

Add the same redirect URLs to the allowed authentication URLs in Supabase. Use HTTPS whenever the application is reachable outside your local machine.

## Troubleshooting

### Docker is not running

If `docker version` shows client information but no server information, start Docker Desktop or the Docker daemon and wait until it is ready.

### Port 3000 is already in use

Find containers publishing port `3000`:

```bash
docker ps --filter publish=3000
```

Stop the conflicting container by name or ID, or change the Compose port mapping from `3000:3000` to another host port such as `8080:3000` and open `http://localhost:8080`.

### The container exits during startup

Read the logs:

```bash
docker compose logs --tail=200 crmp
```

Check that `.env` exists in the repository root and that the required Supabase server variables are not placeholders.

### The page loads but sign-in or maps fail

- Confirm that the Supabase migrations have been applied to the configured project.
- Confirm that the Supabase URL and publishable key refer to the same project.
- Allow the application origin and redirect URLs in Supabase Auth settings.
- Restrict the browser Google key by HTTP referrer and enable Places API (New) and Map Tiles API.
- Restrict the server Google key to the Geocoding API.
- Rebuild the image after changing any `VITE_*` value.

### Check container health directly

```bash
docker inspect --format '{{json .State.Health}}' crmp-crmp-1
```

Compose-generated container names can vary. Run `docker compose ps` to find the actual name, or rely on the health status shown by that command.
