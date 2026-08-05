# Grading Instructions

These steps run the published Demo 4 image **without cloning this repository**. You only need Docker Desktop, a local runtime folder, and access to the shared secrets folder.

Published image:

```text
ghcr.io/utsc-cscc01-software-engineering-i/course-project-five-guys:main
```

Package page: [course-project-five-guys on GHCR](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/pkgs/container/course-project-five-guys)

Commands below are written for **PowerShell on Windows**. On macOS or Linux, use the same `docker` commands; create the folder with `mkdir` / `cd` as usual.

---

## Step 1 — Install Docker Desktop and create a local runtime folder

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) for your operating system and complete the first-run setup.
2. In any convenient location, create a local runtime folder named `run-five-guys-CRMP` and enter it:

```powershell
mkdir .\run-five-guys-CRMP
cd .\run-five-guys-CRMP
```

3. Request access to the private secrets folder (environment file and GitHub token are **not** public):

[Google Drive — CSCC01 Group Project secrets](https://drive.google.com/drive/folders/1vghIpVvFSZXfrdK4OnuEW62W0a3WoseV?usp=sharing)

Open the link while signed into Google, then **Request access** / **Request view permission**.

You may notify either of the following so we can approve quickly:

- Erfang Yuan: [erfang.yuan@mail.utoronto.ca](mailto:erfang.yuan@mail.utoronto.ca)
- Eric Liu (Google Drive folder owner): [ericb.liu@mail.utoronto.ca](mailto:ericb.liu@mail.utoronto.ca)

We will process requests as soon as possible.

---

## Step 2 — Download `.env` into the runtime folder

After access is granted:

1. Open the shared Google Drive folder **CSCC01 - Group Project**.
2. Download the `.env` file.
3. Place it here (same directory you created in Step 1):

```text
run-five-guys-CRMP/.env
```

Confirm the filename is exactly `.env` (not `.env.txt`).

Do not commit this file anywhere. It contains Supabase and Google Maps secrets required at container runtime.

---

## Step 3 — Start Docker Desktop

1. Open **Docker Desktop**.
2. Wait until the status is **Running**.
3. Verify the engine from a terminal:

```powershell
docker version
```

You should see both **Client** and **Server**. If only Client appears, wait for Docker Desktop to finish starting and try again.

---

## Step 4 — Free port 3000 without stopping Docker

The app listens on host port **3000**. Clear that port carefully: **do not kill Docker Desktop processes** (`com.docker.backend`, `docker-proxy`, or PIDs `0` / `4`).

**Preferred order**

1. Stop any previous grading container:

```powershell
docker ps --filter "publish=3000" -q | ForEach-Object { docker stop $_ }
```

2. Inspect who owns port 3000:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, State, OwningProcess,
    @{n='Name';e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}
```

3. If the process is `node` / `nodejs` (for example a leftover `npm run dev`), stop only that process:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  Where-Object { $_ -gt 4 } |
  ForEach-Object {
    $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -match '^(node|nodejs)$') {
      Stop-Process -Id $_ -Force
    } else {
      Write-Host "Skip PID $_ ($($p.ProcessName))"
    }
  }
```

4. Confirm the port is free:

```powershell
netstat -ano | findstr :3000
```

No output means port 3000 is available.

---

## Step 5 — Log in to GHCR

The image is published to a private GitHub Container Registry package. Authenticate before pulling.

```powershell
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

When prompted for **Password**, do **not** use your GitHub account password.

1. Return to Google Drive → **CSCC01 - Group Project**.
2. Open **Github-Token.txt** and copy its contents.
3. Paste the token into the terminal as the password (it will not be shown on screen).

This token expires on **4 September**. After that date, request a replacement from the contacts in Step 1.

---

## Step 6 — Pull the image

From any directory (Docker stores images locally):

```powershell
docker pull ghcr.io/utsc-cscc01-software-engineering-i/course-project-five-guys:main
```

Confirm the image is present:

```powershell
docker images ghcr.io/utsc-cscc01-software-engineering-i/course-project-five-guys
```

You should see tag `main`.

---

## Step 7 — Run the container with `.env`

Stay in `run-five-guys-CRMP` so `--env-file .env` resolves correctly.

Drive `.env` may still list `localhost:5173` origins used for local `npm run dev`. The `-e` flags below override those values for the single-port Docker origin on **3000**.

```powershell
cd .\run-five-guys-CRMP

docker run --rm -p 3000:3000 --name crmp-ghcr-test --env-file .env `
  -e NODE_ENV=production `
  -e PORT=3000 `
  -e CLIENT_ORIGIN=http://localhost:3000 `
  -e SIGNUP_EMAIL_REDIRECT_URL=http://localhost:3000/sign-in `
  -e COMMISSIONER_INVITE_REDIRECT_URL=http://localhost:3000/accept-invite `
  -e PASSWORD_RESET_REDIRECT_URL=http://localhost:3000/reset-password `
  ghcr.io/utsc-cscc01-software-engineering-i/course-project-five-guys:main
```

Leave this terminal running. In another terminal:

```powershell
docker ps
```

You should see `crmp-ghcr-test` with `0.0.0.0:3000->3000/tcp`.

---

## Step 8 — Check the health endpoint

Open a **second** terminal and run:

```powershell
curl.exe -i http://localhost:3000/api/health
```

Expect **HTTP 200**.

---

## Step 9 — Open the application

In a browser, open [http://localhost:3000](http://localhost:3000).

The home page should load. You are an anonymous **Public User** until you sign in.

---

## Step 10 — Test accounts

Self-serve sign-up is limited by the Supabase free tier (about **two new users per hour**, and normal SMS verification is not available). Use the seeded accounts below for grading.

### Public users

| Account | Email | Password |
| --- | --- | --- |
| 1 | `erfang.yuan@mail.utoronto.ca` | `12345678` |
| 2 | `beaming6666@gmail.com` | `12345678` |
| 3 | `hamburgerz2006@gmail.com` | `12345678` |

### Yukon commissioners

| Account | Email | Password |
| --- | --- | --- |
| 1 | `ericb.liu@mail.utoronto.ca` | `12345678` |
| 2 | `2259793082@qq.com` | `12345678` |

To exercise registration or a brand-new account, contact the authentication owner: [ericb.liu@mail.utoronto.ca](mailto:ericb.liu@mail.utoronto.ca).

---

## Stopping the container

In the `docker run` terminal press `Ctrl+C`, or run:

```powershell
docker stop crmp-ghcr-test
```

Optional:

```powershell
docker logout ghcr.io
```

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Drive link asks you to sign in / request access | Request view permission and email Erfang or Eric (Step 1) |
| `403 Forbidden` on `docker pull` | Complete Step 5 (`docker login`) with the Drive token, not your GitHub password |
| `dockerDesktopLinuxEngine` / daemon not running | Start Docker Desktop and wait until Running |
| Port already in use | Repeat Step 4; do not force-kill Docker processes |
| Health check fails | Confirm `docker ps` shows the container and `.env` is in `run-five-guys-CRMP` |
| Token rejected | Token expires **4 September**; request a new `Github-Token.txt` from the Drive owners |
