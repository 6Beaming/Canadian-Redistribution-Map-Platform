import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

const MENU_ITEMS = [
  { id: "search-da", label: "Search for your DA", action: "navigate" },
  { id: "other-1", label: "Other Feature 1", action: "none" },
  { id: "other-2", label: "Other Feature 2", action: "none" }
];

export default function UserMenuLeft() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  function handleItemClick(item) {
    if (item.action === "navigate" && item.id === "search-da") {
      setIsOpen(false);
      navigate("/users/search-da");
    }
  }

  return (
    <>
      {isOpen ? (
        <button
          type="button"
          className="side-menu__backdrop"
          aria-label="Close menu"
          onClick={() => setIsOpen(false)}
        />
      ) : null}

      <nav
        className={`side-menu side-menu--user${isOpen ? " side-menu--open" : ""}`}
        aria-label="User features"
      >
        <button
          type="button"
          className="side-menu__toggle"
          aria-expanded={isOpen}
          aria-label={isOpen ? "Collapse menu" : "Expand menu"}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <ChevronRight className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>

        {isOpen ? (
          <div className="side-menu__panel">
            <p className="side-menu__heading">Features</p>
            <ul className="side-menu__list">
              {MENU_ITEMS.map((item) => (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    className="side-menu__item w-full justify-start"
                    disabled={item.action === "none"}
                    onClick={() => handleItemClick(item)}
                  >
                    {item.label}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>
    </>
  );
}
