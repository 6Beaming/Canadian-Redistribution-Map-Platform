export function customPlaceholder(label, index) {
  if (!label?.custom || label?.createdBy) return "";
  const match = String(label.name ?? "").match(/^custom (?:label )?(cyan|pink|purple|[1-3])$/iu);
  const slots = { cyan: 1, pink: 2, purple: 3 };
  const slot = match ? (slots[String(match[1]).toLowerCase()] ?? Number(match[1])) : index + 1;
  return `Customized Label ${slot}`;
}

export function prepareCatalog(entries = []) {
  return entries
    .map((entry, index) => {
      const placeholder = customPlaceholder(entry, index);
      return placeholder ? { ...entry, name: "", placeholder } : { ...entry };
    })
    .sort((left, right) => Number(Boolean(left.custom)) - Number(Boolean(right.custom)));
}

export function labelIdentity(label) {
  return String(label?.custom
    ? label?.id ?? ""
    : label?.key ?? label?.catalogId ?? label?.id ?? "");
}

export function isSameLabel(left, right) {
  return labelIdentity(left) === labelIdentity(right);
}

export function reconcileLabelsInOrder(referenceLabels = [], persistedLabels = []) {
  const persistedById = new Map(
    persistedLabels.map((label) => [labelIdentity(label), label]),
  );
  const reconciled = referenceLabels
    .map((label) => persistedById.get(labelIdentity(label)))
    .filter(Boolean);
  const reconciledIds = new Set(reconciled.map(labelIdentity));
  persistedLabels.forEach((label) => {
    if (!reconciledIds.has(labelIdentity(label))) reconciled.push(label);
  });
  return reconciled;
}

export function selectionFingerprint(labels = []) {
  return JSON.stringify(labels.map((label) => labelIdentity(label)).sort());
}

export function isDraftCustomLabelId(id) {
  return String(id ?? "").startsWith("draft-custom-");
}
