import { isDraftCustomLabelId, prepareCatalog } from "./labelIdentity.js";

export function mergeCatalogFromServer(currentCatalog = [], savedCatalog = []) {
  const serverById = new Map(savedCatalog.map((entry) => [String(entry.id), entry]));
  const merged = [];
  const seen = new Set();

  for (const entry of currentCatalog) {
    if (isDraftCustomLabelId(entry.id)) {
      merged.push(entry);
      seen.add(String(entry.id));
      continue;
    }
    const serverEntry = serverById.get(String(entry.id));
    if (serverEntry) {
      merged.push(serverEntry);
      seen.add(String(serverEntry.id));
    }
  }

  for (const entry of savedCatalog) {
    if (!seen.has(String(entry.id))) {
      merged.push(entry);
    }
  }

  return prepareCatalog(merged);
}

export function replaceCatalogDraft(catalog, draftId, saved) {
  return prepareCatalog(catalog.map((entry) => (
    String(entry.id) === String(draftId) ? saved : entry
  )));
}
