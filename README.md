# Canadian Redistribution Map Platform (CRMP)

**Graders:** follow [docs/Grading-Instructions.md](docs/Grading-Instructions.md) to pull and run the published Docker image without cloning this repository.

**User Guide (GitHub Wiki):** [Platform, Public User, and Commissioner feature docs](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/wiki)

## Release
The current software release is [CRMP v1.0.0](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/releases/tag/v1.0.0)

Past Releases:
[CRMP v0.2.0](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/releases/tag/v0.2.0)
[CRMP v0.1.0](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/releases/tag/v0.1.0).

These releases were verified with `npm test`, `npm run check:server`, and `npm run build`.

## After Course

Since August 6, the project has received broad post-course hardening and optimization across immutable map releases, sparse geometry operations, database contracts and security, submission queries and caching, realtime synchronization, Workspace and Archived Tree workflows, responsive map UI, diagnostics, and integration coverage. The remaining Counter-Proposal editing scalability gap is the replacement of runtime exact geometry with a canonical operational mesh, documented in the [future Counter-Proposal canonical mesh plan](docs/After-Course/future-update-plan.md).

## Background
Every ten years, the Canadian government redraws the lines for federal voting districts (ridings). Currently, if citizens want to provide feedback or object to new boundaries, they must submit emails or physical letters. This project provides a map-centered web application where people can view proposed electoral maps, submit feedback, or even draw better lines directly on the screen.

## Core Architecture
* **Interactive Map Frontend:** A responsive user interface where users can pan, zoom, click on geographic shapes, and drag district boundaries around.
* **Validation Backend:** A robust backend system that instantly checks the math to see if a user's new map is valid, ensuring that population numbers and geographic constraints still make sense.
* **Commissioner Dashboard:** A secure, private administrative portal for government officials to log in and read all public complaints and proposals organized in one centralized place.

## User Workflows
### 1. Public Users (Citizens)
Regular citizens use the platform to engage with the redistribution process. 
* **Simple Feedback:** A user goes to the website, zooms in on their neighborhood, and sees a proposed line cutting their community in half. They click that specific line, type a comment like *"This is a bad idea,"* and hit submit.
* **Advanced Counter-Proposals:** A more advanced user can use the interactive tools to actually redraw the boundary line on the screen, submitting their newly shaped district as a formal suggestion.

### 2. Commissioners (Government Officials)
The backend dashboard is strictly for the independent boundary commissioners tasked with reviewing the maps. 
* **Structure:** There are 10 separate commissions (one for each of the 10 provinces), with each team consisting of 3 to 5 commissioners. 
* **Workflow:** These officials log into the private dashboard to read, categorize, and analyze all public complaints and counter-proposals.

## Tech Stack

This project is built using the following technologies:

* **Front-end:** React, D3.js
* **Back-end:** Express.js
* **Database:** Supabase (PostgreSQL database, authentication, and real-time APIs)
* **Testing:** Jest, Cypress

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Download the current root `.env` file from the project Google Drive shared folder and place it in the repository root. The file is Git-ignored and is the only local environment file used by this project. It contains `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SIGNUP_EMAIL_REDIRECT_URL`, `PASSWORD_RESET_REDIRECT_URL`, `VITE_GOOGLE_MAPS_API_KEY`, and `GOOGLE_MAPS_SERVER_API_KEY`.
   Do not commit the downloaded file or create a `.env.local` override. Each teammate must use the shared project configuration or obtain a replacement Google key with `localhost` and `127.0.0.1` referrer access enabled in Google Cloud Console. `GOOGLE_MAPS_SERVER_API_KEY` is a separate server-only key restricted to the Geocoding API; never expose it through a `VITE_*` variable.
3. Start the React frontend and Express backend:
   ```bash
   npm run dev
   ```

## Docker

The production container builds the Vite client and serves it together with the
Express API on port `3000`. It also includes the checked-in local map assets
used by the map API.

1. Download the current project `.env` from the shared Google Drive folder and
   place it in the repository root. Do not commit it. The file must include the
   Supabase and Google Maps variables described in `.env.example`.
2. Build and start the service:
   ```bash
   docker compose up --build
   ```
3. Open `http://localhost:3000`. Health can be checked at
   `http://localhost:3000/api/health`.

For a deployed origin, set `DOCKER_CLIENT_ORIGIN` and the three
`DOCKER_*_REDIRECT_URL` values before starting Compose. Public `VITE_*` values
are compiled into the browser bundle, so rebuild the image whenever any of
those values change. Server-only values such as `SUPABASE_SERVICE_ROLE_KEY`
remain runtime environment variables and must never be embedded in a client
build or committed to Git. Compose automatically allows non-Secure cookies for
its HTTP `localhost` origin; for a deployed HTTPS origin, explicitly set
`DOCKER_COOKIE_SECURE=true`.

## Map Data Notes

- Canonical DA metadata shards live in `src/data/map/metadata/`.
- Frontend render artifacts live in `src/data/map/render/`.
- FED reference assets live in `src/data/map/reference/`.
- Runtime lookup files live in `src/data/map/manifests/` and `src/data/map/indexes/`.
- Raw external StatCan CSV inputs stay outside the committed map bundle under `data/external/statcan/`.
- The current map architecture is documented in [docs/Demo-3/map-architecture.md](docs/Demo-3/map-architecture.md).

## Team information
**Team Name:** Five Guys
| Team member | Student # | Email |
| :--- | :--- | :--- |
| Eric Liu | 1011195939 | ericb.liu@mail.utoronto.ca |
| Erfang Yuan | 1011400360 | erfang.yuan@mail.utoronto.ca |
| Alex Xu | 1010244264 | alexxx.xu@mail.utoronto.ca |
| Muhammad Hamza | 1011333709 | maza.hamza@mail.utoronto.ca |
| Arvindh Sengu | 1010396947 | arvindh.sengu@mail.utoronto.ca |
