import { createContext, useContext } from "react";

export const ArchivedMapLayoutContext = createContext(null);

export function useArchivedMapLayout() {
  const context = useContext(ArchivedMapLayoutContext);
  if (!context) {
    throw new Error("useArchivedMapLayout must be used within ArchivedMapLayout.");
  }
  return context;
}
