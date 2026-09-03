import { createContext, useContext } from "react";

export const WorkspaceMapLayoutContext = createContext(null);

export function useWorkspaceMapLayout() {
  const context = useContext(WorkspaceMapLayoutContext);
  if (!context) {
    throw new Error("useWorkspaceMapLayout must be used within WorkspaceMapLayout.");
  }
  return context;
}
