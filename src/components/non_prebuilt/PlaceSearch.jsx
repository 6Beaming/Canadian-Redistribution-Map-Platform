import { useEffect, useRef, useState } from "react";
import { CANADA_BOUNDS } from "@/lib/map/constants.js";
import {
  hasGooglePlacesApiKey,
  loadGooglePlacesLibrary,
} from "@/services/googlePlacesApi.js";

const SEARCH_PLACEHOLDER = "Search by address or postal code...";

function getCoordinate(location, key) {
  const value = location?.[key];
  return typeof value === "function" ? value.call(location) : Number(value);
}

function normalizeViewport(viewport) {
  const bounds = typeof viewport?.toJSON === "function"
    ? viewport.toJSON()
    : viewport;
  const west = Number(bounds?.west);
  const south = Number(bounds?.south);
  const east = Number(bounds?.east);
  const north = Number(bounds?.north);

  if (![west, south, east, north].every(Number.isFinite)) {
    return null;
  }

  return [[west, south], [east, north]];
}

export function PlaceSearch({ onPlaceSelect }) {
  const hostRef = useRef(null);
  const onPlaceSelectRef = useRef(onPlaceSelect);
  const [loadError, setLoadError] = useState("");

  onPlaceSelectRef.current = onPlaceSelect;

  useEffect(() => {
    let autocompleteElement = null;
    let isDisposed = false;

    async function mountAutocomplete() {
      if (!hasGooglePlacesApiKey()) {
        setLoadError("Map search requires VITE_GOOGLE_MAPS_API_KEY.");
        return;
      }

      try {
        const {
          AutocompleteSessionToken,
          AutocompleteSuggestion,
          PlaceAutocompleteElement,
        } = await loadGooglePlacesLibrary();

        if (isDisposed || !hostRef.current) {
          return;
        }

        autocompleteElement = new PlaceAutocompleteElement();
        autocompleteElement.className = "header__place-autocomplete";
        autocompleteElement.placeholder = SEARCH_PLACEHOLDER;
        autocompleteElement.description = "Search for a Canadian address or postal code";
        autocompleteElement.includedRegionCodes = ["ca"];
        autocompleteElement.locationRestriction = {
          west: CANADA_BOUNDS.sw[0],
          south: CANADA_BOUNDS.sw[1],
          east: CANADA_BOUNDS.ne[0],
          north: CANADA_BOUNDS.ne[1],
        };
        autocompleteElement.setAttribute(
          "aria-label",
          "Search by address or postal code",
        );

        let enterSelectionPending = false;
        let hasKeyboardHighlight = false;

        function clearInlineError() {
          autocompleteElement.classList.remove(
            "header__place-autocomplete--error",
          );
          autocompleteElement.placeholder = SEARCH_PLACEHOLDER;
        }

        function showInlineError(message) {
          autocompleteElement.value = "";
          autocompleteElement.placeholder = message;
          autocompleteElement.classList.add(
            "header__place-autocomplete--error",
          );
          setLoadError(message);
        }

        async function handlePlaceSelect({ placePrediction }) {
          if (!placePrediction) {
            return;
          }

          try {
            const place = placePrediction.toPlace();
            await place.fetchFields({
              fields: ["formattedAddress", "location", "viewport"],
            });

            const latitude = getCoordinate(place.location, "lat");
            const longitude = getCoordinate(place.location, "lng");

            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
              throw new Error("The selected place does not include a map location.");
            }

            const label = place.formattedAddress
              || placePrediction.text?.toString?.()
              || "Selected place";

            autocompleteElement.value = label;
            hasKeyboardHighlight = false;
            clearInlineError();
            onPlaceSelectRef.current?.({
              label,
              location: [longitude, latitude],
              viewport: normalizeViewport(place.viewport),
            });
            setLoadError("");
          } catch (error) {
            setLoadError(error?.message || "Unable to open the selected place.");
          }
        }

        function handlePlacesError(event) {
          setLoadError(
            event?.error?.message
              || "Google Places search could not complete the request.",
          );
        }

        async function selectFirstPrediction() {
          const input = String(autocompleteElement.value ?? "").trim();

          if (!input || enterSelectionPending) {
            return;
          }

          enterSelectionPending = true;

          try {
            const { suggestions } = await AutocompleteSuggestion
              .fetchAutocompleteSuggestions({
                input,
                includedRegionCodes: ["ca"],
                locationRestriction: {
                  west: CANADA_BOUNDS.sw[0],
                  south: CANADA_BOUNDS.sw[1],
                  east: CANADA_BOUNDS.ne[0],
                  north: CANADA_BOUNDS.ne[1],
                },
                sessionToken: new AutocompleteSessionToken(),
              });
            const firstPlacePrediction = suggestions.find(
              (suggestion) => suggestion.placePrediction,
            )?.placePrediction;

            if (!firstPlacePrediction) {
              showInlineError("No matching Canadian location found.");
              return;
            }

            await handlePlaceSelect({ placePrediction: firstPlacePrediction });
          } catch (error) {
            setLoadError(error?.message || "Unable to search for that location.");
          } finally {
            enterSelectionPending = false;
          }
        }

        function handleKeyDown(event) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            hasKeyboardHighlight = true;
            return;
          }

          if (event.key === "Escape") {
            hasKeyboardHighlight = false;
            return;
          }

          if (
            event.key !== "Enter"
            || event.isComposing
            || hasKeyboardHighlight
          ) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          void selectFirstPrediction();
        }

        function handleInput() {
          hasKeyboardHighlight = false;
          clearInlineError();
          setLoadError("");
        }

        function handleClearButtonClick(event) {
          if (!autocompleteElement.classList.contains(
            "header__place-autocomplete--error",
          )) {
            return;
          }

          const bounds = autocompleteElement.getBoundingClientRect();
          const clearButtonWidth = 48;
          const clickedClearButton = event.detail === 0
            || event.clientX >= bounds.right - clearButtonWidth;

          if (clickedClearButton) {
            clearInlineError();
            setLoadError("");
          }
        }

        autocompleteElement.addEventListener("gmp-select", handlePlaceSelect);
        autocompleteElement.addEventListener("gmp-error", handlePlacesError);
        autocompleteElement.addEventListener("click", handleClearButtonClick);
        autocompleteElement.addEventListener("input", handleInput);
        autocompleteElement.addEventListener("keydown", handleKeyDown);
        autocompleteElement.__removePlaceSelectListener = () => {
          autocompleteElement.removeEventListener("gmp-select", handlePlaceSelect);
          autocompleteElement.removeEventListener("gmp-error", handlePlacesError);
          autocompleteElement.removeEventListener("click", handleClearButtonClick);
          autocompleteElement.removeEventListener("input", handleInput);
          autocompleteElement.removeEventListener("keydown", handleKeyDown);
        };
        hostRef.current.replaceChildren(autocompleteElement);
      } catch (error) {
        if (!isDisposed) {
          setLoadError(error?.message || "Google Places search could not be loaded.");
        }
      }
    }

    mountAutocomplete();

    return () => {
      isDisposed = true;
      autocompleteElement?.__removePlaceSelectListener?.();
      autocompleteElement?.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="header__place-search"
      title={loadError || undefined}
    >
      <input
        type="search"
        aria-label="Search by address or postal code"
        aria-busy={!loadError}
        className="header__search-input h-10 w-full rounded-full border border-[#c9d8eb] bg-white px-4 text-[#17324d] shadow-[0_2px_8px_rgba(23,50,77,0.06)] outline-none placeholder:text-[#7a8797]"
        placeholder={loadError || SEARCH_PLACEHOLDER}
        disabled
      />
    </div>
  );
}
