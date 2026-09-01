export const ARCHIVE_TREE_LAYOUT = Object.freeze({
  marginX: 34,
  marginY: 42,
  superRootX: 34,
  categoryX: 340,
  branchX: 680,
  versionX: 1010,
  superRootWidth: 246,
  categoryWidth: 272,
  branchWidth: 278,
  versionWidth: 104,
  versionHeight: 76,
  branchGap: 32,
  categoryGap: 88,
  versionGap: 28,
  moreHeight: 38,
  maxCollapsedBranches: 3,
});

export function canvasFont({ size = 14, weight = 500 } = {}) {
  return `${weight} ${size}px Inter, system-ui, sans-serif`;
}

function splitLongToken(context, token, maxWidth) {
  const pieces = [];
  let current = "";
  for (const character of [...token]) {
    const candidate = `${current}${character}`;
    if (current && context.measureText(candidate).width > maxWidth) {
      pieces.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function ellipsize(context, text, maxWidth) {
  const ellipsis = "…";
  let candidate = String(text ?? "").trimEnd();
  while (candidate && context.measureText(`${candidate}${ellipsis}`).width > maxWidth) {
    candidate = [...candidate].slice(0, -1).join("").trimEnd();
  }
  return `${candidate}${ellipsis}`;
}

export function measureWrappedText(context, text, {
  maxWidth,
  maxLines = 2,
  size = 14,
  weight = 500,
  lineHeight = Math.ceil(size * 1.35),
} = {}) {
  context.save();
  context.font = canvasFont({ size, weight });
  const tokens = String(text ?? "").trim().split(/\s+/u).filter(Boolean).flatMap((token) => (
    context.measureText(token).width <= maxWidth
      ? [token]
      : splitLongToken(context, token, maxWidth)
  ));
  const lines = [];
  let current = "";
  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current || !lines.length) lines.push(current);
  const truncated = lines.length > maxLines;
  const visibleLines = lines.slice(0, maxLines);
  if (truncated) {
    visibleLines[visibleLines.length - 1] = ellipsize(context, visibleLines.at(-1), maxWidth);
  }
  context.restore();
  return {
    lines: visibleLines,
    lineHeight,
    height: visibleLines.length * lineHeight,
    truncated,
    font: canvasFont({ size, weight }),
  };
}

function measureCard(context, title, description, width, {
  leftInset,
  rightPadding = 16,
  topPadding = 16,
  bottomPadding = 14,
  titleSize = 13,
  titleLines = 2,
  descriptionSize = 10.5,
  descriptionLines = 2,
  textGap = 6,
  footerHeight = 16,
  minHeight = 0,
} = {}) {
  const maxWidth = width - leftInset - rightPadding;
  const titleLayout = measureWrappedText(context, title, {
    maxWidth,
    maxLines: titleLines,
    size: titleSize,
    weight: 750,
  });
  const descriptionLayout = measureWrappedText(context, description, {
    maxWidth,
    maxLines: descriptionLines,
    size: descriptionSize,
    weight: 500,
  });
  return {
    title: titleLayout,
    description: descriptionLayout,
    height: Math.max(
      minHeight,
      topPadding + titleLayout.height + textGap + descriptionLayout.height + footerHeight + bottomPadding,
    ),
    maxWidth,
    leftInset,
    topPadding,
    textGap,
  };
}

function layoutCategory(context, category, top, expandedCategories, expandedBranches) {
  const geometry = ARCHIVE_TREE_LAYOUT;
  const categoryIsExpanded = expandedCategories.has(category.id);
  const visibleBranches = categoryIsExpanded
    ? category.branches
    : category.branches.slice(0, geometry.maxCollapsedBranches);
  const branchEntries = visibleBranches.map((branch) => {
    const text = measureCard(context, branch.label, branch.communityName, geometry.branchWidth, {
      leftInset: 50,
      topPadding: 14,
      bottomPadding: 13,
      titleSize: 11.5,
      descriptionSize: 10,
      footerHeight: 0,
      minHeight: 72,
    });
    return {
      branch,
      text,
      isExpanded: expandedBranches.has(branch.key),
      subtreeHeight: Math.max(text.height, geometry.versionHeight),
    };
  });
  const remaining = category.branches.length - visibleBranches.length;
  const hasMoreControl = remaining > 0
    || (categoryIsExpanded && category.branches.length > geometry.maxCollapsedBranches);
  const branchStackHeight = branchEntries.reduce((sum, entry) => sum + entry.subtreeHeight, 0)
    + Math.max(0, branchEntries.length - 1) * geometry.branchGap
    + (hasMoreControl ? geometry.moreHeight : 0);
  const rootText = measureCard(context, category.title, category.description, geometry.categoryWidth, {
    leftInset: 82,
    titleSize: 13,
    descriptionSize: 10.5,
    footerHeight: 18,
    minHeight: 116,
  });
  const subtreeHeight = Math.max(rootText.height, branchStackHeight || rootText.height);
  const root = {
    x: geometry.categoryX,
    y: top + (subtreeHeight - rootText.height) / 2,
    width: geometry.categoryWidth,
    height: rootText.height,
    text: rootText,
  };
  let branchY = top;
  const branches = branchEntries.map((entry) => {
    const node = {
      x: geometry.branchX,
      y: branchY + (entry.subtreeHeight - entry.text.height) / 2,
      width: geometry.branchWidth,
      height: entry.text.height,
      text: entry.text,
    };
    const versions = entry.isExpanded
      ? entry.branch.versions.map((version, index) => ({
        version,
        x: geometry.versionX + index * (geometry.versionWidth + geometry.versionGap),
        y: branchY + (entry.subtreeHeight - geometry.versionHeight) / 2,
        width: geometry.versionWidth,
        height: geometry.versionHeight,
      }))
      : [];
    const result = { ...entry, node, versions };
    branchY += entry.subtreeHeight + geometry.branchGap;
    return result;
  });
  const more = hasMoreControl ? {
    x: geometry.branchX + 10,
    y: top + branchStackHeight - geometry.moreHeight,
    width: 190,
    height: geometry.moreHeight,
    label: remaining > 0 ? `+ ${remaining} more DA IDs` : "Show fewer",
  } : null;
  return { category, root, branches, more, subtreeHeight, top };
}

export function buildArchivedTreeLayout(context, categories, {
  expandedCategories = new Set(),
  expandedBranches = new Set(),
} = {}) {
  const geometry = ARCHIVE_TREE_LAYOUT;
  let cursorY = geometry.marginY;
  const categoryLayouts = categories.map((category) => {
    const layout = layoutCategory(context, category, cursorY, expandedCategories, expandedBranches);
    cursorY += layout.subtreeHeight + geometry.categoryGap;
    return layout;
  });
  const firstCenter = categoryLayouts[0]
    ? categoryLayouts[0].root.y + categoryLayouts[0].root.height / 2
    : geometry.marginY + 58;
  const lastCenter = categoryLayouts.at(-1)
    ? categoryLayouts.at(-1).root.y + categoryLayouts.at(-1).root.height / 2
    : firstCenter;
  const superText = measureCard(
    context,
    "Click to open the Archived Map",
    "Latest legal archived geometry overlay",
    geometry.superRootWidth,
    {
      leftInset: 74,
      titleSize: 14,
      descriptionSize: 10.5,
      footerHeight: 18,
      minHeight: 120,
    },
  );
  const superRoot = {
    x: geometry.superRootX,
    y: (firstCenter + lastCenter) / 2 - superText.height / 2,
    width: geometry.superRootWidth,
    height: superText.height,
    text: superText,
  };
  const maxVersionRight = Math.max(
    geometry.versionX + geometry.versionWidth,
    ...categoryLayouts.flatMap(({ branches }) => branches.flatMap(({ versions }) => (
      versions.map(({ x, width }) => x + width)
    ))),
  );
  return {
    superRoot,
    categories: categoryLayouts,
    worldWidth: maxVersionRight + geometry.marginX,
    worldHeight: Math.max(
      cursorY - geometry.categoryGap + geometry.marginY,
      superRoot.y + superRoot.height + geometry.marginY,
    ),
  };
}
