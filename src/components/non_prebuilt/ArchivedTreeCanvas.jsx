import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

const ROOT_X = 48;
const BRANCH_X = 382;
const VERSION_X = 710;
const ROOT_WIDTH = 260;
const ROOT_HEIGHT = 104;
const BRANCH_WIDTH = 250;
const BRANCH_HEIGHT = 48;
const VERSION_WIDTH = 82;
const VERSION_HEIGHT = 58;
const BAND_HEIGHT = 260;
const MAX_COLLAPSED_BRANCHES = 3;

function roundedRect(context, x, y, width, height, radius = 12) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawText(context, text, x, y, options = {}) {
  context.fillStyle = options.color ?? "#17324d";
  context.font = `${options.weight ?? 500} ${options.size ?? 14}px Inter, system-ui, sans-serif`;
  context.textAlign = options.align ?? "left";
  context.textBaseline = options.baseline ?? "alphabetic";
  context.fillText(String(text ?? ""), x, y, options.maxWidth);
}

function drawIcon(context, icon, x, y, color = "#fff") {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  const cx = x + 18;
  const cy = y + 18;

  if (icon === "comments") {
    roundedRect(context, x + 7, y + 8, 22, 17, 6);
    context.stroke();
    context.beginPath();
    context.moveTo(x + 13, y + 25);
    context.lineTo(x + 10, y + 31);
    context.lineTo(x + 18, y + 26);
    context.stroke();
    [13, 18, 23].forEach((dotX) => {
      context.beginPath();
      context.arc(x + dotX, y + 17, 1.3, 0, Math.PI * 2);
      context.fill();
    });
  } else if (icon === "objections") {
    context.strokeRect(x + 8, y + 8, 20, 20);
    context.beginPath();
    context.moveTo(x + 8, y + 13);
    context.lineTo(x + 8, y + 8);
    context.lineTo(x + 13, y + 8);
    context.moveTo(x + 23, y + 8);
    context.lineTo(x + 28, y + 8);
    context.lineTo(x + 28, y + 13);
    context.moveTo(x + 28, y + 23);
    context.lineTo(x + 28, y + 28);
    context.lineTo(x + 23, y + 28);
    context.moveTo(x + 13, y + 28);
    context.lineTo(x + 8, y + 28);
    context.lineTo(x + 8, y + 23);
    context.stroke();
  } else {
    [[10, 11], [26, 9], [19, 27]].forEach(([nodeX, nodeY]) => {
      context.beginPath();
      context.arc(x + nodeX, y + nodeY, 3.2, 0, Math.PI * 2);
      context.fill();
    });
    context.beginPath();
    context.moveTo(x + 13, y + 11);
    context.lineTo(x + 23, y + 9);
    context.moveTo(x + 12, y + 14);
    context.lineTo(x + 17, y + 24);
    context.moveTo(x + 24, y + 12);
    context.lineTo(x + 20, y + 24);
    context.stroke();
  }
  context.restore();
}

function getWorldPoint(event, canvas, camera) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - camera.x) / camera.scale,
    y: (event.clientY - rect.top - camera.y) / camera.scale,
  };
}

function hitTest(regions, point) {
  return [...regions].reverse().find((region) => (
    point.x >= region.x && point.x <= region.x + region.width &&
    point.y >= region.y && point.y <= region.y + region.height
  ));
}

export function ArchivedTreeCanvas({ categories, isLoading = false, selectedVersionId, onSelect, onOpenMap }) {
  const canvasRef = useRef(null);
  const regionsRef = useRef([]);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [hasRendered, setHasRendered] = useState(false);
  const [expandedBranches, setExpandedBranches] = useState(() => new Set());
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());

  useEffect(() => {
    if (!selectedVersionId) return;
    const branch = categories.flatMap((category) => category.branches)
      .find((entry) => entry.versions.some((version) => version.id === selectedVersionId));
    if (branch) {
      setExpandedBranches((current) => new Set(current).add(branch.key));
    }
  }, [categories, selectedVersionId]);

  useEffect(() => {
    if (isLoading) {
      regionsRef.current = [];
      setHasRendered(false);
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    function render() {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.fillStyle = "#fbfdff";
      context.fillRect(0, 0, rect.width, rect.height);
      context.save();
      const camera = cameraRef.current;
      context.translate(camera.x, camera.y);
      context.scale(camera.scale, camera.scale);
      const regions = [];

      if (!categories.some((category) => category.branches.length)) {
        drawText(context, "No archived submissions match this view.", 54, 72, {
          color: "#758899",
          size: 15,
        });
      }

      categories.forEach((category, categoryIndex) => {
        const bandTop = 34 + categoryIndex * BAND_HEIGHT;
        const rootY = bandTop + 55;
        const visibleBranches = expandedCategories.has(category.id)
          ? category.branches
          : category.branches.slice(0, MAX_COLLAPSED_BRANCHES);
        const rootCenterY = rootY + ROOT_HEIGHT / 2;

        context.strokeStyle = category.color;
        context.lineWidth = 2;
        context.globalAlpha = 0.72;
        context.beginPath();
        context.moveTo(ROOT_X + ROOT_WIDTH, rootCenterY);
        context.lineTo(BRANCH_X - 36, rootCenterY);
        context.stroke();
        context.globalAlpha = 1;

        roundedRect(context, ROOT_X, rootY, ROOT_WIDTH, ROOT_HEIGHT, 14);
        context.fillStyle = "#fff";
        context.fill();
        context.strokeStyle = `${category.color}55`;
        context.lineWidth = 1.25;
        context.stroke();
        context.shadowColor = "rgba(23, 50, 77, 0.09)";
        context.shadowBlur = 16;
        context.shadowOffsetY = 5;
        context.stroke();
        context.shadowColor = "transparent";

        // Keep root-category icon containers square. Canvas does not preserve
        // CSS aspect ratios, so a taller rectangle makes the three branch icons
        // appear vertically stretched beside their Workspace counterparts.
        const rootIconSize = 52;
        const rootIconX = ROOT_X + 14;
        const rootIconY = rootY + (ROOT_HEIGHT - rootIconSize) / 2;
        roundedRect(context, rootIconX, rootIconY, rootIconSize, rootIconSize, 13);
        const gradient = context.createLinearGradient(
          rootIconX,
          rootIconY,
          rootIconX + rootIconSize,
          rootIconY + rootIconSize,
        );
        gradient.addColorStop(0, "#20c9bd");
        gradient.addColorStop(1, category.color);
        context.fillStyle = gradient;
        context.fill();
        drawIcon(context, category.id, rootIconX + 8, rootIconY + 8);
        drawText(context, category.title, ROOT_X + 82, rootY + 42, { size: 13, weight: 750, maxWidth: 165 });
        drawText(context, category.description, ROOT_X + 82, rootY + 66, { size: 11, color: "#60758a", maxWidth: 165 });
        drawText(context, `${category.count} branch${category.count === 1 ? "" : "es"}`, ROOT_X + 82, rootY + 84, { size: 10.5, color: category.color, weight: 700 });
        regions.push({ type: "category", category, x: ROOT_X, y: rootY, width: ROOT_WIDTH, height: ROOT_HEIGHT });

        visibleBranches.forEach((branch, branchIndex) => {
          const branchY = bandTop + branchIndex * 62;
          const branchCenterY = branchY + BRANCH_HEIGHT / 2;
          context.strokeStyle = category.color;
          context.lineWidth = 1.8;
          context.globalAlpha = 0.75;
          context.beginPath();
          context.moveTo(BRANCH_X - 36, rootCenterY);
          context.bezierCurveTo(BRANCH_X - 14, rootCenterY, BRANCH_X - 26, branchCenterY, BRANCH_X, branchCenterY);
          context.stroke();
          context.globalAlpha = 1;
          context.beginPath();
          context.arc(BRANCH_X - 36, rootCenterY, 4.5, 0, Math.PI * 2);
          context.fillStyle = category.color;
          context.fill();

          const isExpanded = expandedBranches.has(branch.key);
          roundedRect(context, BRANCH_X, branchY, BRANCH_WIDTH, BRANCH_HEIGHT, 10);
          context.fillStyle = "#fff";
          context.fill();
          context.strokeStyle = isExpanded ? category.color : "#d7e3ec";
          context.lineWidth = isExpanded ? 1.6 : 1;
          context.stroke();
          context.beginPath();
          context.arc(BRANCH_X + 23, branchCenterY, 11, 0, Math.PI * 2);
          context.fillStyle = "#f8fbff";
          context.fill();
          context.strokeStyle = "#9bb0c4";
          context.stroke();
          drawText(context, isExpanded ? "−" : "+", BRANCH_X + 23, branchCenterY + 0.5, {
            align: "center", baseline: "middle", size: 17, color: "#47627a", weight: 500,
          });
          drawText(context, branch.label, BRANCH_X + 44, branchY + 21, { size: 11.5, weight: 750, maxWidth: 194 });
          drawText(context, branch.communityName, BRANCH_X + 44, branchY + 37, { size: 9.5, color: "#708497", maxWidth: 194 });
          regions.push({ type: "branch", category, branch, x: BRANCH_X, y: branchY, width: BRANCH_WIDTH, height: BRANCH_HEIGHT });

          if (!isExpanded) return;
          let versionX = VERSION_X;
          branch.versions.forEach((version) => {
            const versionY = branchY - 5;
            const isLatest = version.id === branch.latestVersion?.id;
            const isSelected = version.id === selectedVersionId;
            context.strokeStyle = category.color;
            context.globalAlpha = 0.68;
            context.lineWidth = 1.8;
            context.beginPath();
            context.moveTo(versionX === VERSION_X ? BRANCH_X + BRANCH_WIDTH : versionX - 28, branchCenterY);
            context.lineTo(versionX, branchCenterY);
            context.stroke();
            context.globalAlpha = 1;

            roundedRect(context, versionX, versionY, VERSION_WIDTH, VERSION_HEIGHT, 10);
            context.fillStyle = isSelected ? "#effbf7" : "#fff";
            context.fill();
            context.strokeStyle = isLatest || isSelected ? category.color : "#d6e1e9";
            context.lineWidth = isLatest || isSelected ? 1.7 : 1;
            context.stroke();
            if (isLatest) {
              roundedRect(context, versionX + 18, versionY - 17, 47, 20, 10);
              context.fillStyle = category.color;
              context.fill();
              drawText(context, "Latest", versionX + 41.5, versionY - 6.5, {
                align: "center", baseline: "middle", color: "#fff", size: 9.5, weight: 750,
              });
            }
            drawText(context, version.label, versionX + VERSION_WIDTH / 2, versionY + 24, {
              align: "center", color: isLatest ? category.color : "#17324d", size: 12, weight: 800,
            });
            const date = new Date(version.mergedAt);
            drawText(context, Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString("en-CA", { month: "short", day: "numeric" }), versionX + VERSION_WIDTH / 2, versionY + 43, {
              align: "center", color: "#61768a", size: 9.5,
            });
            regions.push({ type: "version", category, branch, version, x: versionX, y: versionY, width: VERSION_WIDTH, height: VERSION_HEIGHT });
            versionX += VERSION_WIDTH + 28;
          });
        });

        const remaining = category.branches.length - visibleBranches.length;
        if (remaining > 0) {
          const moreY = bandTop + visibleBranches.length * 62 + 2;
          drawText(context, `+ ${remaining} more DA IDs`, BRANCH_X + 14, moreY + 16, {
            color: category.color, size: 11.5, weight: 750,
          });
          regions.push({ type: "more", category, x: BRANCH_X, y: moreY, width: 145, height: 28 });
        } else if (expandedCategories.has(category.id) && category.branches.length > MAX_COLLAPSED_BRANCHES) {
          const moreY = bandTop + visibleBranches.length * 62 + 2;
          drawText(context, "Show fewer", BRANCH_X + 14, moreY + 16, {
            color: category.color, size: 11.5, weight: 750,
          });
          regions.push({ type: "more", category, x: BRANCH_X, y: moreY, width: 100, height: 28 });
        }
      });
      regionsRef.current = regions;
      context.restore();
    }

    render();
    setHasRendered(true);
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [categories, expandedBranches, expandedCategories, isLoading, selectedVersionId, viewportVersion]);

  function changeZoom(nextScale, anchor = null) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const camera = cameraRef.current;
    const scale = Math.min(1.9, Math.max(0.55, nextScale));
    const rect = canvas.getBoundingClientRect();
    const point = anchor ?? { x: rect.width / 2, y: rect.height / 2 };
    const worldX = (point.x - camera.x) / camera.scale;
    const worldY = (point.y - camera.y) / camera.scale;
    camera.x = point.x - worldX * scale;
    camera.y = point.y - worldY * scale;
    camera.scale = scale;
    setViewportVersion((value) => value + 1);
  }

  function resetViewport() {
    cameraRef.current = { x: 0, y: 0, scale: 1 };
    setViewportVersion((value) => value + 1);
  }

  function handlePointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: cameraRef.current.x,
      cameraY: cameraRef.current.y,
      moved: false,
    };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    cameraRef.current.x = drag.cameraX + dx;
    cameraRef.current.y = drag.cameraY + dy;
    setViewportVersion((value) => value + 1);
  }

  function handlePointerUp(event) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    const canvas = canvasRef.current;
    const hit = hitTest(regionsRef.current, getWorldPoint(event, canvas, cameraRef.current));
    if (!hit) return;
    if (hit.type === "category") {
      onOpenMap(hit.category);
    } else if (hit.type === "more") {
      setExpandedCategories((current) => {
        const next = new Set(current);
        if (next.has(hit.category.id)) next.delete(hit.category.id);
        else next.add(hit.category.id);
        return next;
      });
    } else if (hit.type === "branch") {
      setExpandedBranches((current) => {
        const next = new Set(current);
        if (next.has(hit.branch.key)) next.delete(hit.branch.key);
        else next.add(hit.branch.key);
        return next;
      });
      if (hit.branch.latestVersion) onSelect(hit.category, hit.branch, hit.branch.latestVersion);
    } else if (hit.type === "version") {
      onSelect(hit.category, hit.branch, hit.version);
    }
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    changeZoom(cameraRef.current.scale * (event.deltaY > 0 ? 0.9 : 1.1), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  return (
    <div className="archive-tree-canvas-shell" aria-busy={isLoading || !hasRendered}>
      <canvas
        ref={canvasRef}
        className="archive-tree-canvas"
        aria-hidden={isLoading || !hasRendered || undefined}
        aria-label="Interactive archived submission version tree. Drag to pan and use the mouse wheel to zoom."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        onWheel={handleWheel}
      />
      {isLoading || !hasRendered ? (
        <div className="archive-tree-canvas-loading" role="status" aria-live="polite">
          <div className="route-loading-overlay__indicator">
            <span className="route-loading-overlay__spinner" aria-hidden="true" />
            <span>Loading...</span>
          </div>
        </div>
      ) : (
        <div className="archive-tree-canvas-controls" aria-label="Tree viewport controls">
          <button type="button" aria-label="Zoom in" onClick={() => changeZoom(cameraRef.current.scale * 1.15)}><Plus /></button>
          <button type="button" aria-label="Zoom out" onClick={() => changeZoom(cameraRef.current.scale / 1.15)}><Minus /></button>
          <button type="button" aria-label="Reset viewport" onClick={resetViewport}><Maximize2 /></button>
        </div>
      )}
    </div>
  );
}
