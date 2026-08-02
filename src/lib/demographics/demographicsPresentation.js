const STATUS_LABELS = Object.freeze({
  suppressed: "Suppressed by Statistics Canada",
  unavailable: "Unavailable",
  not_applicable: "Not applicable",
});

export function formatDemographicValue(item, locale) {
  if (item?.status !== "available") return null;
  const value = Number(item.value);
  if (!Number.isFinite(value)) return null;
  const decimals = Math.max(0, Number(item.decimals) || 0);
  const formatted = value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (item.unit === "%") return `${formatted}%`;
  if (item.unit === "$") return `$${formatted}`;
  return `${formatted} ${item.unit ?? ""}`.trim();
}

export function getDemographicStatusLabel(status) {
  return STATUS_LABELS[status] ?? "Unavailable";
}
