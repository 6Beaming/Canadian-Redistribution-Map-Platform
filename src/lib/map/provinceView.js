const PROVINCE_VIEWS = {
  AB: {
    name: "Alberta",
    pruid: "48",
    viewport: [[-120.002718, 48.996776], [-109.999666, 60.000059]],
  },
  BC: {
    name: "British Columbia",
    pruid: "59",
    viewport: [[-139.052238, 48.249998], [-114.053793, 60.000059]],
  },
  MB: {
    name: "Manitoba",
    pruid: "46",
    viewport: [[-102.007627, 48.99886], [-88.979559, 60.000059]],
  },
  NB: {
    name: "New Brunswick",
    pruid: "13",
    viewport: [[-69.05345, 44.555677], [-63.614702, 48.08926]],
  },
  NL: {
    name: "Newfoundland and Labrador",
    pruid: "10",
    viewport: [[-67.821693, 46.595616], [-52.582283, 60.377727]],
  },
  NS: {
    name: "Nova Scotia",
    pruid: "12",
    viewport: [[-66.447115, 43.251767], [-59.651728, 47.235072]],
  },
  NT: {
    name: "Northwest Territories",
    pruid: "61",
    viewport: [[-141.010122, 60.000016], [-101.999989, 83.6]],
  },
  NU: {
    name: "Nunavut",
    pruid: "62",
    viewport: [[-120.724897, 51.152432], [-59.991274, 83.6]],
  },
  ON: {
    name: "Ontario",
    pruid: "35",
    viewport: [[-95.156021, 41.676951], [-74.320364, 56.861596]],
  },
  PE: {
    name: "Prince Edward Island",
    pruid: "11",
    viewport: [[-64.446058, 45.858037], [-61.954994, 47.065971]],
  },
  QC: {
    name: "Quebec",
    pruid: "24",
    viewport: [[-79.770784, 44.991452], [-57.105474, 62.593578]],
  },
  SK: {
    name: "Saskatchewan",
    pruid: "47",
    viewport: [[-110.010395, 48.998972], [-101.361837, 60.000059]],
  },
  YT: {
    name: "Yukon",
    pruid: "60",
    // Yukon is much taller than the commissioner's wide map. Fitting its
    // complete bounds makes the territory occupy only a narrow strip, so use
    // a closer southern/central focus that matches the intended dashboard
    // view while retaining nearby geographic context.
    location: [-131.8, 62.4],
    zoom: 5.3,
  },
};

// These extents were generated from the bundled 2023 FED boundary geometry,
// grouped by the province/territory prefix in each FED number. Keeping the
// bounds local lets the initial camera start in the right place without a
// Google lookup or a delayed Canada-to-province transition.
export function getProvinceMapView(provinceCode) {
  const normalizedCode = String(provinceCode ?? "").trim().toUpperCase();
  const province = PROVINCE_VIEWS[normalizedCode];

  if (!province) {
    return null;
  }

  return {
    code: normalizedCode,
    name: province.name,
    pruid: province.pruid,
    mapTarget: {
      label: province.name,
      showMarker: false,
      ...(province.location
        ? {
            location: province.location,
            zoom: province.zoom,
          }
        : {
            viewport: province.viewport,
            fitBoundsOptions: {
              padding: 48,
              maxZoom: 8,
            },
          }),
    },
  };
}
