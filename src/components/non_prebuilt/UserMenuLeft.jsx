import { useEffect, useRef, useState } from "react";
import { ChevronRight, Menu } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const MENU_ITEMS = [
  { id: "search-da", label: "Search For My Area", path: "/users/search-da" },
  { id: "submissions", label: "View My Submissions", path: "/submissions" },
];

export default function UserMenuLeft() {
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
      className={`side-menu side-menu--user side-menu--users${isOpen ? " side-menu--open" : ""}`}
      aria-label="User features"
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
