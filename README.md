# Canadian Redistribution Map Platform (CRMP)

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
