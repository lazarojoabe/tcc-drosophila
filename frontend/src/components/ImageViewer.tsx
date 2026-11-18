import { useCallback, useEffect, useRef, useState } from "react";
import { imageUrl } from "../api";
import type { Nucleus, SelectionModifiers } from "../types";
import {
  imageToScreen,
  pointInPolygon,
  screenToImage,
  zoomAt,
  type Point,
  type Transform,
} from "../utils/geometry";

interface Props {
  sessionId: string | null;
  shape: { width: number; height: number } | null;
  nuclei: Nucleus[];
  selected: number[];
  layer: "nucleus" | "protein" | "mask";
  labels: boolean;
  editId: number | null;
  editMode: "adjust" | "redraw";
  redrawVersion: number;
  onSelect: (id: number, modifiers: SelectionModifiers) => void;
  onEditChange: (polygon: Point[]) => void;
}
const MIN_SCALE = 0.1;
const MAX_SCALE = 12;

export function ImageViewer({
  sessionId,
  shape,
  nuclei,
  selected,
  layer,
  labels,
  editId,
  editMode,
  redrawVersion,
  onSelect,
  onEditChange,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragMovedRef = useRef(false);
  const hasInteractedRef = useRef(false);
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [drag, setDrag] = useState<{
    start: Point;
    transform: Transform;
  } | null>(null);
  const [handle, setHandle] = useState<number | null>(null);
  const [isRedrawing, setIsRedrawing] = useState(false);
  const [editingPolygon, setEditingPolygon] = useState<Point[] | null>(null);
  const drawRef = useRef<() => void>(() => undefined);

  const fit = useCallback(() => {
    const target = shellRef.current;
    if (!target || !shape || shape.width <= 0 || shape.height <= 0) return;
    const width = target.clientWidth;
    const height = target.clientHeight;
    if (width <= 0 || height <= 0) return;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(width / shape.width, height / shape.height)),
    );
    setTransform({
      scale,
      x: (width - shape.width * scale) / 2,
      y: (height - shape.height * scale) / 2,
    });
  }, [shape]);

  const draw = useCallback(() => {
    const target = canvasRef.current;
    if (!target) return;
    const width = target.clientWidth;
    const height = target.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (target.width !== pixelWidth || target.height !== pixelHeight) {
      target.width = pixelWidth;
      target.height = pixelHeight;
    }
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#0e171e";
    ctx.fillRect(0, 0, width, height);
    if (imageRef.current)
      ctx.drawImage(
        imageRef.current,
        transform.x,
        transform.y,
        imageRef.current.width * transform.scale,
        imageRef.current.height * transform.scale,
      );
    nuclei
      .filter((n) => n.state !== "excluded")
      .forEach((n) => {
        const polygon =
          n.nucleus_id === editId && editingPolygon
            ? editingPolygon
            : n.polygon;
        if (!polygon.length) return;
        ctx.beginPath();
        polygon.forEach((point, index) => {
          const screen = imageToScreen(point, transform);
          index ? ctx.lineTo(...screen) : ctx.moveTo(...screen);
        });
        if (editMode !== "redraw" || !isRedrawing) ctx.closePath();
        ctx.strokeStyle = selected.includes(n.nucleus_id)
          ? "#facc15"
          : n.state === "hidden"
            ? "#64748b"
            : "#38bdf8";
        ctx.lineWidth = selected.includes(n.nucleus_id) ? 3 : 1.5;
        ctx.globalAlpha = n.state === "hidden" ? 0.35 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (labels) {
          const screen = imageToScreen([n.centroid_x, n.centroid_y], transform);
          ctx.fillStyle = "#e0f2fe";
          ctx.font = "12px ui-monospace";
          ctx.fillText(String(n.nucleus_id), screen[0] + 4, screen[1] - 4);
        }
        if (n.nucleus_id === editId)
          polygon.forEach((point) => {
            const screen = imageToScreen(point, transform);
            ctx.fillStyle = "#fbbf24";
            ctx.beginPath();
            ctx.arc(screen[0], screen[1], 5, 0, Math.PI * 2);
            ctx.fill();
          });
      });
  }, [editId, editMode, editingPolygon, isRedrawing, labels, nuclei, selected, transform]);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);
  useEffect(() => {
    hasInteractedRef.current = false;
    imageRef.current = null;
    if (!sessionId) {
      draw();
      return;
    }
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      drawRef.current();
    };
    image.src = imageUrl(sessionId, layer);
    return () => {
      image.onload = null;
      imageRef.current = null;
    };
  }, [layer, sessionId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(fit);
    return () => window.cancelAnimationFrame(frame);
  }, [fit, sessionId]);
  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    const target = shellRef.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!hasInteractedRef.current) fit();
      drawRef.current();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [fit]);
  useEffect(() => {
    const selectedNucleus = nuclei.find((n) => n.nucleus_id === editId);
    setEditingPolygon(
      selectedNucleus
        ? editMode === "redraw"
          ? []
          : selectedNucleus.polygon.map((p) => [p[0], p[1]])
        : null,
    );
    setIsRedrawing(false);
  }, [editId, editMode, nuclei, redrawVersion]);
  useEffect(() => {
    if (editingPolygon) onEditChange(editingPolygon);
  }, [editingPolygon, onEditChange]);

  function locate(
    event:
      | React.PointerEvent<HTMLCanvasElement>
      | React.MouseEvent<HTMLCanvasElement>,
  ): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return screenToImage(
      [event.clientX - rect.left, event.clientY - rect.top],
      transform,
    );
  }
  function vertexTolerance() {
    return Math.max(8, Math.min(22, 12 / transform.scale));
  }
  function closestEdge(
    point: Point,
    polygon: Point[],
  ): { index: number; point: Point; distance: number } | null {
    if (polygon.length < 2) return null;
    let best: { index: number; point: Point; distance: number } | null = null;
    polygon.forEach((item, index) => {
      const next = polygon[(index + 1) % polygon.length];
      const dx = next[0] - item[0];
      const dy = next[1] - item[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - item[0]) * dx + (point[1] - item[1]) * dy) /
            (dx * dx + dy * dy || 1),
        ),
      );
      const candidate: Point = [item[0] + t * dx, item[1] + t * dy];
      const distance = Math.hypot(
        point[0] - candidate[0],
        point[1] - candidate[1],
      );
      if (!best || distance < best.distance)
        best = { index: index + 1, point: candidate, distance };
    });
    return best;
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const screen: Point = [event.clientX - rect.left, event.clientY - rect.top];
    if (editId && editMode === "redraw") {
      setEditingPolygon([screenToImage(screen, transform)]);
      setIsRedrawing(true);
      return;
    }
    if (editId && editingPolygon) {
      const point = screenToImage(screen, transform);
      const index = editingPolygon.findIndex(
        (item) =>
          Math.hypot(item[0] - point[0], item[1] - point[1]) <
          vertexTolerance(),
      );
      if (index >= 0) {
        setHandle(index);
        return;
      }
    }
    dragMovedRef.current = false;
    setDrag({ start: [event.clientX, event.clientY], transform });
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (isRedrawing) {
      const point = locate(event);
      setEditingPolygon((current) => {
        const previous = current?.[current.length - 1];
        return !previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) >= 3 / transform.scale
          ? [...(current ?? []), point]
          : current;
      });
      return;
    }
    if (handle !== null) {
      const point = locate(event);
      setEditingPolygon((current) =>
        current
          ? current.map((item, index) => (index === handle ? point : item))
          : current,
      );
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.start[0];
    const dy = event.clientY - drag.start[1];
    if (Math.hypot(dx, dy) > 2) {
      dragMovedRef.current = true;
      hasInteractedRef.current = true;
    }
    setTransform({
      ...drag.transform,
      x: drag.transform.x + dx,
      y: drag.transform.y + dy,
    });
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setHandle(null);
    setIsRedrawing(false);
    setDrag(null);
  }
  function click(event: React.MouseEvent<HTMLCanvasElement>) {
    if (dragMovedRef.current || editId) {
      dragMovedRef.current = false;
      return;
    }
    const point = locate(event);
    const nucleus = [...nuclei]
      .reverse()
      .find((n) => n.state !== "excluded" && pointInPolygon(point, n.polygon));
    if (nucleus) {
      onSelect(nucleus.nucleus_id, {
        additive: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      });
    }
  }
  function doubleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!editingPolygon || editMode === "redraw") return;
    const point = locate(event);
    const edge = closestEdge(point, editingPolygon);
    if (!edge || edge.distance > vertexTolerance()) return;
    setEditingPolygon((current) =>
      current
        ? [...current.slice(0, edge.index), point, ...current.slice(edge.index)]
        : current,
    );
  }
  function contextMenu(event: React.MouseEvent<HTMLCanvasElement>) {
    if (editMode === "redraw") {
      event.preventDefault();
      setEditingPolygon([]);
      setIsRedrawing(false);
      return;
    }
    if (!editingPolygon || editingPolygon.length <= 3) return;
    event.preventDefault();
    const point = locate(event);
    const index = editingPolygon.findIndex(
      (item) =>
        Math.hypot(item[0] - point[0], item[1] - point[1]) < vertexTolerance(),
    );
    if (index >= 0)
      setEditingPolygon((current) =>
        current ? current.filter((_, i) => i !== index) : current,
      );
  }
  function wheel(event: React.WheelEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".viewer-controls")) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursor: Point = [event.clientX - rect.left, event.clientY - rect.top];
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const factor = Math.min(1.35, Math.max(0.75, Math.exp(-delta * 0.0015)));
    hasInteractedRef.current = true;
    setTransform((current) => zoomAt(current, cursor, factor));
  }
  function zoomCenter(factor: number) {
    const target = shellRef.current;
    if (!target) return;
    hasInteractedRef.current = true;
    setTransform((current) =>
      zoomAt(
        current,
        [target.clientWidth / 2, target.clientHeight / 2],
        factor,
      ),
    );
  }
  function resetTo100() {
    const target = shellRef.current;
    if (!target || !shape) return;
    hasInteractedRef.current = true;
    setTransform({
      scale: 1,
      x: (target.clientWidth - shape.width) / 2,
      y: (target.clientHeight - shape.height) / 2,
    });
  }

  return (
    <div ref={shellRef} className="viewer-shell" onWheelCapture={wheel}>
      <canvas
        ref={canvasRef}
        className={`viewer-canvas${editId ? " editing" : ""}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onClick={click}
        onDoubleClick={doubleClick}
        onContextMenu={contextMenu}
      />
      <div className="viewer-controls">
        <button onClick={() => zoomCenter(1.2)}>+</button>
        <button onClick={() => zoomCenter(1 / 1.2)}>−</button>
        <button
          onClick={() => {
            hasInteractedRef.current = false;
            fit();
          }}
        >
          Ajustar
        </button>
        <button onClick={resetTo100}>100%</button>
      </div>
      <div className="viewer-help">
        {editId
          ? editMode === "redraw"
            ? "Redesenho livre: clique e arraste sobre a borda do núcleo · botão direito: limpar"
            : "Ajuste fino: arraste vértices · duplo clique na borda: adicionar · botão direito no vértice: remover"
          : "Roda: zoom preciso · arraste: pan · selecione um núcleo para editar o contorno"}
      </div>
    </div>
  );
}
