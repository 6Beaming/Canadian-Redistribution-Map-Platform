const PROVINCE_BY_CODE = Object.freeze({
  AB: { name: "Alberta", pruid: "48" },
  BC: { name: "British Columbia", pruid: "59" },
  MB: { name: "Manitoba", pruid: "46" },
  NB: { name: "New Brunswick", pruid: "13" },
  NL: { name: "Newfoundland and Labrador", pruid: "10" },
  NS: { name: "Nova Scotia", pruid: "12" },
  NT: { name: "Northwest Territories", pruid: "61" },
  NU: { name: "Nunavut", pruid: "62" },
  ON: { name: "Ontario", pruid: "35" },
  PE: { name: "Prince Edward Island", pruid: "11" },
  QC: { name: "Quebec", pruid: "24" },
  SK: { name: "Saskatchewan", pruid: "47" },
  YT: { name: "Yukon", pruid: "60" },
});

const PROVINCE_BY_PRUID = Object.freeze(
  Object.fromEntries(
    Object.entries(PROVINCE_BY_CODE).map(([code, value]) => [
      value.pruid,
      { code, name: value.name, pruid: value.pruid },
    ]),
  ),
);

export function normalizeProvinceCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizePruid(value) {
  return String(value ?? "").trim();
}

export function resolvePruidFromProvinceCode(provinceCode) {
  const entry = PROVINCE_BY_CODE[normalizeProvinceCode(provinceCode)];
  return entry?.pruid ?? null;
}

export function resolveProvinceNameFromPruid(pruid) {
  return PROVINCE_BY_PRUID[normalizePruid(pruid)]?.name ?? null;
}

export function resolveCommissionerPruid(profile) {
  return resolvePruidFromProvinceCode(profile?.province);
}

export function formatCrossProvinceWarning(eligibilityPruids = []) {
  const unique = [...new Set(eligibilityPruids.map(normalizePruid).filter(Boolean))];
  if (unique.length < 2) return null;

  const names = unique
    .map((pruid) => resolveProvinceNameFromPruid(pruid))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (names.length < 2) return null;
  return `You are processing a boundary between ${names[0]} and ${names[1]}.`;
}
