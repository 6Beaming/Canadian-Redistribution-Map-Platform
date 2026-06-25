import { useState } from "react";
import { ChevronRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

const MENU_ITEMS = [
  { id: "feature-1", label: "Feature 1" },
  { id: "feature-2", label: "Feature 2" }
];

export default function CommissionerMenuLeft() {
  const [isOpen, setIsOpen] = useState(false);

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
                    disabled
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
