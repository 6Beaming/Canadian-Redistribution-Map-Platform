import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getMapDataRoot } from "../../map-api-service/paths.js";

const DGUID_PATTERN = /^2021S0512\d{8}$/;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function defaultPaths() {
  const root = getMapDataRoot();
  return {
    catalogPath: path.join(root, "indexes", "da_demographics_catalog.json"),
    indexPath: path.join(root, "indexes", "da_demographics_index.json"),
  };
}

function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.groups) || !Array.isArray(catalog.indicators)) {
    throw new Error("The demographics catalog schema is invalid.");
  }
  const ids = new Set();
  catalog.indicators.forEach((indicator) => {
    if (!indicator?.id || ids.has(indicator.id)) throw new Error("The demographics catalog contains duplicate indicator IDs.");
    ids.add(indicator.id);
  });
}

function validateIndex(index, catalog) {
  if (index?.schemaVersion !== 1 || !index.dataset || !index.records || typeof index.records !== "object") {
    throw new Error("The demographics index schema is invalid.");
  }
  const recordKeys = Object.keys(index.records);
  if (index.recordCount !== recordKeys.length) throw new Error("The demographics record count is invalid.");
  if (index.catalogSha256 !== sha256(stableStringify(catalog))) {
    throw new Error("The demographics catalog checksum does not match the index.");
  }
  if (index.recordsSha256 !== sha256(stableStringify(index.records))) {
    throw new Error("The demographics records checksum is invalid.");
  }
  recordKeys.forEach((dguid) => {
    const record = index.records[dguid];
    if (!DGUID_PATTERN.test(dguid) || !Array.isArray(record?.values) || record.values.length !== catalog.indicators.length) {
      throw new Error(`The demographics record for ${dguid} is invalid.`);
    }
  });
}

function expandRecord(catalog, index, dguid) {
  const record = index.records[dguid];
  if (!record) return null;
  const itemsByGroup = new Map(catalog.groups.map((group) => [group.id, []]));
  catalog.indicators.forEach((indicator, indexPosition) => {
    const [value, status = "unavailable", flag = null, note = null] = record.values[indexPosition] ?? [];
    itemsByGroup.get(indicator.group)?.push({
      id: indicator.id,
      label: indicator.label,
      value: value ?? null,
      unit: indicator.unit,
      decimals: indicator.decimals,
      status,
      universe: indicator.universe,
      sourceCharacteristicId: indicator.sourceCharacteristicId,
      statisticCode: indicator.statisticCode,
      flag,
      note,
    });
  });
  const groups = catalog.groups.map((group) => ({
    id: group.id,
    label: group.label,
    items: itemsByGroup.get(group.id) ?? [],
  }));
  const available = groups.some((group) => group.items.some((item) => item.status === "available"));
  const quality = {
    dataQualityFlag: record.quality?.dataQualityFlag || null,
    tnrShortForm: record.quality?.tnrShortForm ?? null,
    tnrLongForm: record.quality?.tnrLongForm ?? null,
    warning: record.quality?.warning ?? null,
  };
  const payload = {
    schemaVersion: 1,
    dguid,
    availability: available ? "available" : "unavailable",
    dataset: index.dataset,
    quality,
    groups,
  };
  return {
    payload,
    etag: `"${sha256(`${stableStringify(index.dataset)}:${stableStringify(record)}`)}"`,
  };
}

export function createStatisticsStore(options = {}) {
  const paths = { ...defaultPaths(), ...options };
  const readFile = options.readFile ?? fs.readFile;
  let loadPromise = null;

  async function load() {
    if (!loadPromise) {
      loadPromise = Promise.all([
        readFile(paths.catalogPath, "utf8"),
        readFile(paths.indexPath, "utf8"),
      ]).then(([catalogText, indexText]) => {
        const catalog = JSON.parse(catalogText);
        const index = JSON.parse(indexText);
        validateCatalog(catalog);
        validateIndex(index, catalog);
        return { catalog, index };
      }).catch((error) => {
        loadPromise = null;
        throw error;
      });
    }
    return loadPromise;
  }

  return {
    async get(dguid) {
      if (!DGUID_PATTERN.test(String(dguid ?? ""))) return null;
      const { catalog, index } = await load();
      return expandRecord(catalog, index, String(dguid));
    },
    reset() { loadPromise = null; },
  };
}

export const statisticsStore = createStatisticsStore();
