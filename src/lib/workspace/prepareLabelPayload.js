import { isDraftCustomLabelId } from "./labelIdentity.js";
import { replaceCatalogDraft } from "./catalogMerge.js";

export async function preparePayloadWithRealUuids(selected, catalog, {
  createCustomLabel,
  onCatalogEntrySaved,
}) {
  const catalogById = new Map(catalog.map((entry) => [String(entry.id), entry]));
  let nextCatalog = catalog;
  const resolved = [];

  for (const label of selected) {
    if (!label.custom) {
      resolved.push(label);
      continue;
    }

    let entry = catalogById.get(String(label.id)) ?? label;
    const name = String(entry.name ?? "").trim();
    if (!name) {
      throw new Error("Custom labels must have a name before they can be selected.");
    }

    if (isDraftCustomLabelId(entry.id)) {
      const saved = await createCustomLabel({
        name,
        color: entry.color,
        custom: true,
      });
      nextCatalog = replaceCatalogDraft(nextCatalog, entry.id, saved);
      catalogById.set(String(saved.id), saved);
      onCatalogEntrySaved?.(entry.id, saved, nextCatalog);
      entry = saved;
    }

    resolved.push({
      ...entry,
      custom: true,
      name,
      color: entry.color,
    });
  }

  return { labels: resolved, catalog: nextCatalog };
}
