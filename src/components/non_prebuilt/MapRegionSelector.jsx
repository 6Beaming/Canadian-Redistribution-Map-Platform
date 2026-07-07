import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
  const [openWidth, setOpenWidth] = useState(344);
  const [openHeight, setOpenHeight] = useState(118);
  const activeCategory =
    ROLLOUT_CATEGORIES.find((category) => category.id === value) ??
    ROLLOUT_CATEGORIES[0];

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

      const measuredWidth = measureRef.current.scrollWidth;
      const measuredHeight = measureRef.current.scrollHeight;

      setOpenWidth(Math.max(300, Math.min(window.innerWidth - 32, measuredWidth + 20)));
      setOpenHeight(Math.max(108, measuredHeight + 18));
    }

    updateMeasurements();
    window.addEventListener("resize", updateMeasurements);

    return () => {
      window.removeEventListener("resize", updateMeasurements);
    };
  }, [value]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        onOpenChange?.(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onOpenChange?.(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  function handleToggle() {
    const nextOpen = !isOpen;

    if (nextOpen && !value) {
      onValueChange?.(DEFAULT_ROLLOUT_CATEGORY_ID);
    }

    onOpenChange?.(nextOpen);
  }

  return (
    <div
      ref={containerRef}
      className={`map-region-selector${isOpen ? " map-region-selector--open" : ""}`}
      style={{
        "--map-region-selector-open-width": `${openWidth}px`,
        "--map-region-selector-open-height": `${openHeight}px`,
      }}
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
        <span className="map-region-selector__label">
          {activeCategory?.label ?? "Effected"}
        </span>
        <ChevronDown className="map-region-selector__chevron" aria-hidden="true" />
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
            <span className="map-region-selector__label map-region-selector__label--visible">
              {activeCategory?.label ?? "Effected"}
            </span>
            <ChevronDown className="map-region-selector__chevron map-region-selector__chevron--visible" />
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
