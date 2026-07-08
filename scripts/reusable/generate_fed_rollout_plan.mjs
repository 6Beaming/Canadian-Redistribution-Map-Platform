import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const labelsPath = path.join(repoRoot, "src", "data", "map", "reference", "fed_labels.geojson");
const outputPath = path.join(repoRoot, "src", "data", "map", "manifests", "fed_rollout_plan.json");

const fedPrefixToProvince = new Map([
  ["10", "nl"],
  ["11", "pe"],
  ["12", "ns"],
  ["13", "nb"],
  ["24", "qc"],
  ["35", "on"],
  ["46", "mb"],
  ["47", "sk"],
  ["48", "ab"],
  ["59", "bc"],
  ["60", "yt"],
  ["61", "nt"],
  ["62", "nu"],
]);

const blockedProvinces = new Set(["on", "qc", "ns", "nb", "nt", "nu"]);
const readyProvinces = new Set(["nl", "pe", "mb", "sk", "ab", "bc"]);
const effectedFedNums = new Set(["60001"]);
const developingFedNums = new Set(["11001", "11002", "11003"]);

function getProvinceCode(fedNum) {
  return fedPrefixToProvince.get(String(fedNum).slice(0, 2)) ?? "unknown";
}

function getCategoryId(fedNum, provinceCode) {
  if (effectedFedNums.has(fedNum)) {
    return "effected";
  }

  if (blockedProvinces.has(provinceCode)) {
    return "data-blocked";
  }

  if (developingFedNums.has(fedNum)) {
    return "developing";
  }

  if (readyProvinces.has(provinceCode)) {
    return "planned-in-developing";
  }

  return "planned-in-developing";
}

async function main() {
  const raw = await fs.readFile(labelsPath, "utf8");
  const fedLabels = JSON.parse(raw);

  const areas = (fedLabels.features ?? [])
    .map((feature) => {
      const fedNum = String(feature.properties?.fed_num ?? "").trim();
      const name = String(feature.properties?.name ?? "").trim();
      const provinceCode = getProvinceCode(fedNum);

      return {
        fedNum,
        name,
        provinceCode,
        categoryId: getCategoryId(fedNum, provinceCode),
      };
    })
    .filter((area) => area.fedNum && area.name)
    .sort((left, right) => Number(left.fedNum) - Number(right.fedNum));

  const payload = {
    generatedAt: new Date().toISOString(),
    basedOn: [
      "docs/Actual_redist-mini-guide.md",
      "docs/Missing_Files.md",
      "src/data/map/fed_labels.geojson",
      "https://redecoupage-redistribution-2022.ca/com/on/fbnd/index_e.aspx",
      "https://redecoupage-redistribution-2022.ca/com/qc/fbnd/index_e.aspx",
      "https://redecoupage-redistribution-2022.ca/com/ns/fbnd/index_e.aspx",
      "https://redecoupage-redistribution-2022.ca/com/nb/fbnd/index_e.aspx",
    ],
    areas,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`Wrote ${areas.length} FED rollout records to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
