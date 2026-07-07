import { useEffect, useRef, useState } from "react";
import { ChevronRight, Menu } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const MENU_ITEMS = [
  { id: "all-submission", label: "All Submission", path: "/dashboard/submissionsTable" },
  { id: "view-graphs", label: "View Graphs", path: "/dashboard/graphs" },
];

export default function CommissionerMenuLeft() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function handleItemClick(path) {
    setIsOpen(false);
    navigate(path);
  }

  return (
    <nav
      ref={containerRef}
      className={`side-menu side-menu--commissioner${isOpen ? " side-menu--open" : ""}`}
      aria-label="Commissioner features"
    >
      <button
        type="button"
        className="side-menu__toggle"
        aria-expanded={isOpen}
        aria-label={isOpen ? "Collapse menu" : "Expand menu"}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? <ChevronRight className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {isOpen ? (
        <div className="side-menu__panel">
          <ul className="side-menu__list">
            {MENU_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`side-menu__item${location.pathname === item.path ? " side-menu__item--active" : ""}`}
                  onClick={() => handleItemClick(item.path)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
