import { useEffect, useMemo, useRef, useState } from "react";
import { HorizontalTabs } from "@/components/ui/horizontal-tabs";
import iconSrc from "@/assets/icon.svg";
import { DEFAULT_ROLLOUT_CATEGORY_ID, ROLLOUT_CATEGORIES } from "@/lib/map/rolloutPlan.js";

export function MapRegionSelector({
  isOpen = false,
  onOpenChange,
  value = DEFAULT_ROLLOUT_CATEGORY_ID,
  onValueChange,
}) {
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [openWidth, setOpenWidth] = useState(520);
  const [openHeight, setOpenHeight] = useState(58);
  const activeCategory =
    ROLLOUT_CATEGORIES.find((category) => category.id === value) ??
    ROLLOUT_CATEGORIES[0];

  function getTargetWidth() {
    if (typeof window === "undefined") {
      return 420;
    }

    const mapCanvas =
      containerRef.current?.parentElement?.querySelector(".map-canvas");
    const baseWidth =
      mapCanvas?.clientWidth ??
      containerRef.current?.parentElement?.clientWidth ??
      window.innerWidth;

    return Math.max(50, Math.floor(baseWidth * 0.8));
  }

  const tabItems = useMemo(
    () =>
      ROLLOUT_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
      })),
    [],
  );

  useEffect(() => {
    function updateMeasurements() {
      if (!measureRef.current) {
        return;
      }

      const nextWidth = getTargetWidth();
      measureRef.current.style.width = `${nextWidth}px`;

      const measuredHeight = measureRef.current.scrollHeight;

      setOpenWidth(nextWidth);
      setOpenHeight(Math.max(50, measuredHeight + 8));
    }

    updateMeasurements();
    window.addEventListener("resize", updateMeasurements);

    return () => {
      window.removeEventListener("resize", updateMeasurements);
    };
  }, [isOpen, value]);

  function handleToggle() {
    const nextOpen = !isOpen;

    if (nextOpen && !value) {
      onValueChange?.(DEFAULT_ROLLOUT_CATEGORY_ID);
    }

    onOpenChange?.(nextOpen);
  }

  function stopMapEvent(event) {
    event.stopPropagation();
  }

  return (
    <div
      ref={containerRef}
      className={`map-region-selector${isOpen ? " map-region-selector--open" : ""}`}
      style={{
        "--map-region-selector-open-width": `${openWidth}px`,
        "--map-region-selector-open-height": `${openHeight}px`,
      }}
      onPointerDown={stopMapEvent}
      onClick={stopMapEvent}
      onDoubleClick={stopMapEvent}
    >
      <button
        type="button"
        className="map-region-selector__head"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={isOpen ? "Collapse rollout regions" : "Expand rollout regions"}
        onClick={handleToggle}
      >
        <span className="map-region-selector__icon-shell">
          <img src={iconSrc} alt="" className="map-region-selector__icon" />
        </span>
      </button>

      <div className="map-region-selector__tabs">
        <HorizontalTabs
          items={tabItems}
          value={activeCategory?.id ?? DEFAULT_ROLLOUT_CATEGORY_ID}
          onValueChange={onValueChange}
          className="map-region-selector__tabs-shell"
          listClassName="map-region-selector__tabs-list"
          itemClassName="map-region-selector__tab-item"
        />
      </div>

      <div className="map-region-selector__measure" aria-hidden="true">
        <div ref={measureRef} className="map-region-selector__measure-frame">
          <div className="map-region-selector__measure-head">
            <span className="map-region-selector__icon-shell">
              <img src={iconSrc} alt="" className="map-region-selector__icon" />
            </span>
          </div>
          <div className="map-region-selector__measure-tabs">
            {ROLLOUT_CATEGORIES.map((category) => (
              <span key={category.id} className="map-region-selector__measure-tab">
                {category.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
