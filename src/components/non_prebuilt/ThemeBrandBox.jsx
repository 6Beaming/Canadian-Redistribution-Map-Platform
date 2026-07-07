import { useEffect, useRef, useState } from "react";
import iconSrc from "@/assets/icon.svg";
import { cn } from "@/lib/utils";

const EXPANSION_DURATION_MS = 3000;

export function ThemeBrandBox({ className, disableMobileExpansion = false }) {
  const containerRef = useRef(null);
  const titleRef = useRef(null);
  const cooldownRef = useRef(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 576,
  );
  const [isTruncated, setIsTruncated] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [metrics, setMetrics] = useState({
    expandedWidth: 0,
    shift: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 576px)");
    const handleChange = (event) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQuery.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  useEffect(() => {
    function clearCooldown() {
      if (cooldownRef.current) {
        window.clearTimeout(cooldownRef.current);
        cooldownRef.current = null;
      }
    }

    return clearCooldown;
  }, []);

  useEffect(() => {
    if (!isMobile || disableMobileExpansion) {
      setIsExpanded(false);
      setIsCoolingDown(false);
      setIsTruncated(false);
      return undefined;
    }

    function measure() {
      const container = containerRef.current;
      const title = titleRef.current;

      if (!container || !title) {
        return;
      }

      const collapsedWidth = container.getBoundingClientRect().width;
      const expandedWidth = Math.min(
        window.innerWidth - 16,
        Math.max(collapsedWidth, title.scrollWidth + 92),
      );
      const shift = Math.max(0, expandedWidth - collapsedWidth);

      setMetrics({
        expandedWidth,
        shift,
      });
      setIsTruncated(title.scrollWidth > title.clientWidth + 1);
    }

    measure();

    const animationFrame = window.requestAnimationFrame(measure);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;

    resizeObserver?.observe(containerRef.current);
    resizeObserver?.observe(titleRef.current);
    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [disableMobileExpansion, isMobile]);

  function handleExpand() {
    if (!isMobile || disableMobileExpansion || !isTruncated || isCoolingDown) {
      return;
    }

    if (cooldownRef.current) {
      window.clearTimeout(cooldownRef.current);
    }

    setIsExpanded(true);
    setIsCoolingDown(true);

    cooldownRef.current = window.setTimeout(() => {
      setIsExpanded(false);
      cooldownRef.current = window.setTimeout(() => {
        setIsCoolingDown(false);
        cooldownRef.current = null;
      }, 320);
    }, EXPANSION_DURATION_MS);
  }

  function handleKeyDown(event) {
    if (!isMobile || disableMobileExpansion || !isTruncated || isCoolingDown) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleExpand();
    }
  }

  const isInteractive = isMobile && isTruncated && !disableMobileExpansion;

  return (
    <div
      ref={containerRef}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive && !isCoolingDown ? 0 : undefined}
      aria-disabled={isInteractive && isCoolingDown ? "true" : undefined}
      className={cn(
        "theme-brand-box inline-flex h-12 items-center gap-3 rounded-[24px] border border-[#d7e6fb] bg-white/90 px-4 py-2 shadow-[0_10px_30px_rgba(26,115,232,0.12)] backdrop-blur transition-[transform,max-width,width,box-shadow] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
        isInteractive ? "theme-brand-box--interactive cursor-pointer" : "",
        isExpanded ? "theme-brand-box--expanded" : "",
        isCoolingDown ? "theme-brand-box--cooldown" : "",
        className,
      )}
      style={{
        "--theme-brand-expanded-width": `${metrics.expandedWidth}px`,
        "--theme-brand-shift": `${metrics.shift}px`,
      }}
      onClick={handleExpand}
      onKeyDown={handleKeyDown}
    >
      <div className="theme-brand-box__icon-shell flex h-9 w-9 items-center justify-center rounded-[14px] bg-[#e8f0fe]">
        <img src={iconSrc} alt="" className="theme-brand-box__icon h-7 w-7 object-contain" />
      </div>
      <span
        ref={titleRef}
        className="theme-brand-box__title min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[23px] font-bold text-[#1a73e8] [font-family:'Times_New_Roman',Times,serif]"
      >
        Canadian Redistribution Map Platform
      </span>
    </div>
  );
}
