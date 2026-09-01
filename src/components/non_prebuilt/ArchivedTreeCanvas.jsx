import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import {
  buildArchivedTreeLayout,
  canvasFont,
} from "@/lib/archiveTreeLayout.js";

function roundedRect(context, node, radius = 12) {
  context.beginPath();
  context.roundRect(node.x, node.y, node.width, node.height, radius);
}

function drawText(context, text, x, y, {
  color = "#17324d",
  size = 14,
  weight = 500,
  align = "left",
  baseline = "alphabetic",
} = {}) {
  context.fillStyle = color;
  context.font = canvasFont({ size, weight });
  context.textAlign = align;
  context.textBaseline = baseline;
  context.fillText(String(text ?? ""), x, y);
}

function drawMeasuredText(context, layout, x, y, color) {
  context.fillStyle = color;
  context.font = layout.font;
  context.textAlign = "left";
  context.textBaseline = "top";
  layout.lines.forEach((line, index) => {
    context.fillText(line, x, y + index * layout.lineHeight);
  });
}

function drawIcon(context, icon, x, y, color = "#fff") {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (icon === "comments") {
    context.beginPath();
    context.roundRect(x + 7, y + 8, 22, 17, 6);
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
    const nodes = icon === "archive-map"
      ? [[18, 7], [9, 27], [27, 27]]
      : [[10, 11], [26, 9], [19, 27]];
    context.beginPath();
    if (icon === "archive-map") {
      context.moveTo(x + 18, y + 10);
      context.lineTo(x + 10, y + 24);
      context.moveTo(x + 18, y + 10);
      context.lineTo(x + 26, y + 24);
      context.moveTo(x + 12, y + 27);
      context.lineTo(x + 24, y + 27);
    } else {
      context.moveTo(x + 13, y + 11);
      context.lineTo(x + 23, y + 9);
      context.moveTo(x + 12, y + 14);
      context.lineTo(x + 17, y + 24);
      context.moveTo(x + 24, y + 12);
      context.lineTo(x + 20, y + 24);
    }
    context.stroke();
    nodes.forEach(([nodeX, nodeY]) => {
      context.beginPath();
      context.arc(x + nodeX, y + nodeY, 3.2, 0, Math.PI * 2);
      context.fill();
    });
  }
  context.restore();
}

function drawConnector(context, start, end, color, alpha = 0.68) {
  const distance = Math.max(48, (end.x - start.x) * 0.45);
  context.save();
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(start.x + distance, start.y, end.x - distance, end.y, end.x, end.y);
  context.stroke();
  context.restore();
}

function drawCard(context, node, { border = "#d7e3ec", selected = false } = {}) {
  context.save();
  context.shadowColor = "rgba(23, 50, 77, 0.09)";
  context.shadowBlur = 16;
  context.shadowOffsetY = 5;
  roundedRect(context, node, 13);
  context.fillStyle = selected ? "#effbf8" : "#fff";
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = border;
  context.lineWidth = selected ? 1.8 : 1.2;
  context.stroke();
  context.restore();
}

function drawRootCard(context, node, {
  icon,
  color,
  footer,
  superRoot = false,
}) {
  drawCard(context, node, { border: superRoot ? "#18aa9e" : `${color}88` });
  const iconSize = superRoot ? 50 : 54;
  const iconNode = {
    x: node.x + 15,
    y: node.y + (node.height - iconSize) / 2,
    width: iconSize,
    height: iconSize,
  };
  roundedRect(context, iconNode, 14);
  const gradient = context.createLinearGradient(
    iconNode.x,
    iconNode.y,
    iconNode.x + iconSize,
    iconNode.y + iconSize,
  );
  gradient.addColorStop(0, "#20c9bd");
  gradient.addColorStop(1, color);
  context.fillStyle = gradient;
  context.fill();
  drawIcon(context, icon, iconNode.x + (iconSize - 36) / 2, iconNode.y + (iconSize - 36) / 2);

  const textX = node.x + node.text.leftInset;
  let textY = node.y + node.text.topPadding;
  drawMeasuredText(context, node.text.title, textX, textY, "#17324d");
  textY += node.text.title.height + node.text.textGap;
  drawMeasuredText(context, node.text.description, textX, textY, "#60758a");
  drawText(context, footer, textX, node.y + node.height - 16, {
    color,
    size: 10.5,
    weight: 750,
  });
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
    point.x >= region.x && point.x <= region.x + region.width
    && point.y >= region.y && point.y <= region.y + region.height
  ));
}

export function ArchivedTreeCanvas({
  categories,
  isLoading = false,
  selectedVersionId,
  onSelect,
  onOpenSuperRootMap,
}) {
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
    if (branch) setExpandedBranches((current) => new Set(current).add(branch.key));
  }, [categories, selectedVersionId]);

  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready?.then(() => {
      if (!cancelled) setViewportVersion((value) => value + 1);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isLoading) {
      regionsRef.current = [];
      setHasRendered(false);
      return undefined;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;

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

      const layout = buildArchivedTreeLayout(context, categories, {
        expandedCategories,
        expandedBranches,
      });
      const regions = [];
      const superCenter = {
        x: layout.superRoot.x + layout.superRoot.width,
        y: layout.superRoot.y + layout.superRoot.height / 2,
      };
      layout.categories.forEach(({ category, root }) => {
        drawConnector(context, superCenter, {
          x: root.x,
          y: root.y + root.height / 2,
        }, "#14a89d", 0.72);
      });
      drawRootCard(context, layout.superRoot, {
        icon: "archive-map",
        color: "#087f70",
        footer: "Latest Archived Map",
        superRoot: true,
      });
      regions.push({ type: "super-root", ...layout.superRoot });

      layout.categories.forEach(({ category, root, branches, more }) => {
        drawRootCard(context, root, {
          icon: category.id,
          color: category.color,
          footer: `${category.count} branch${category.count === 1 ? "" : "es"}`,
        });
        regions.push({ type: "category", category, ...root });
        const rootCenter = { x: root.x + root.width, y: root.y + root.height / 2 };

        branches.forEach(({ branch, node, versions, isExpanded }) => {
          const branchCenter = { x: node.x, y: node.y + node.height / 2 };
          drawConnector(context, rootCenter, branchCenter, category.color);
          drawCard(context, node, { border: isExpanded ? category.color : "#d7e3ec" });
          context.beginPath();
          context.arc(node.x + 24, node.y + node.height / 2, 11, 0, Math.PI * 2);
          context.fillStyle = "#f8fbff";
          context.fill();
          context.strokeStyle = "#9bb0c4";
          context.stroke();
          drawText(context, isExpanded ? "−" : "+", node.x + 24, node.y + node.height / 2, {
            align: "center",
            baseline: "middle",
            size: 17,
            color: "#47627a",
          });
          const textX = node.x + node.text.leftInset;
          let textY = node.y + node.text.topPadding;
          drawMeasuredText(context, node.text.title, textX, textY, "#17324d");
          textY += node.text.title.height + node.text.textGap;
          drawMeasuredText(context, node.text.description, textX, textY, "#708497");
          regions.push({ type: "branch", category, branch, ...node });

          versions.forEach((versionNode, versionIndex) => {
            const { version } = versionNode;
            const isLatest = version.id === branch.latestVersion?.id;
            const isSelected = version.id === selectedVersionId;
            drawConnector(context, {
              x: versionIndex === 0 ? node.x + node.width : versions[versionIndex - 1].x + versions[versionIndex - 1].width,
              y: node.y + node.height / 2,
            }, {
              x: versionNode.x,
              y: versionNode.y + versionNode.height / 2,
            }, category.color);
            drawCard(context, versionNode, {
              border: isLatest || isSelected ? category.color : "#d6e1e9",
              selected: isSelected,
            });
            if (isLatest) {
              const badge = { x: versionNode.x + 24, y: versionNode.y + 6, width: 56, height: 20 };
              roundedRect(context, badge, 10);
              context.fillStyle = category.color;
              context.fill();
              drawText(context, "Latest", badge.x + badge.width / 2, badge.y + badge.height / 2, {
                align: "center",
                baseline: "middle",
                color: "#fff",
                size: 9.5,
                weight: 750,
              });
            }
            drawText(context, version.label, versionNode.x + versionNode.width / 2, versionNode.y + (isLatest ? 44 : 31), {
              align: "center",
              color: isLatest ? category.color : "#17324d",
              size: 12,
              weight: 800,
            });
            const date = new Date(version.mergedAt);
            drawText(context, Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString("en-CA", { month: "short", day: "numeric" }), versionNode.x + versionNode.width / 2, versionNode.y + (isLatest ? 62 : 52), {
              align: "center",
              color: "#61768a",
              size: 9.5,
            });
            regions.push({ type: "version", category, branch, version, ...versionNode });
          });
        });

        if (more) {
          drawText(context, more.label, more.x + 4, more.y + more.height / 2, {
            color: category.color,
            size: 11.5,
            weight: 750,
            baseline: "middle",
          });
          regions.push({ type: "more", category, ...more });
        }
      });

      if (!categories.some((category) => category.branches.length)) {
        drawText(context, "No archived submissions match this view.", layout.categories[0]?.root.x ?? 340, 24, {
          color: "#758899",
          size: 14,
        });
      }
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
    if (hit.type === "super-root") {
      onOpenSuperRootMap?.();
    } else if (hit.type === "category" || hit.type === "more") {
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
