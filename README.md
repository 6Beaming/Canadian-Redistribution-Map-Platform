# Canadian Redistribution Map Platform (CRMP)

## Release
The current software release is [CRMP v0.1.0](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/releases/tag/v0.1.0).

This release was verified with `npm test`, `npm run check:server`, and `npm run build`.

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
* **Database:** Supabase *(An open-source Firebase alternative providing our <b>PostgreSQL</b> database, authentication, and instant APIs)*
* **Testing:** Jest, Cypress

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SIGNUP_EMAIL_REDIRECT_URL`, and `PASSWORD_RESET_REDIRECT_URL`.
3. Start the React frontend and Express backend:
   ```bash
   npm run dev
   ```

## Team information
**Team Name:** Five Guys
| Team member | Student # | Email |
| :--- | :--- | :--- |
| Eric Liu | 1011195939 | ericb.liu@mail.utoronto.ca |
| Erfang Yuan | 1011400360 | erfang.yuan@mail.utoronto.ca |
| Alex Xu | 1010244264 | alexxx.xu@mail.utoronto.ca |
| Muhammad Hamza | 1011333709 | maza.hamza@mail.utoronto.ca |
| Arvindh Sengu | 1010396947 | arvindh.sengu@mail.utoronto.ca |
