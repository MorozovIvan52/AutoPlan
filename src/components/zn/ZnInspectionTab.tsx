import { useCallback, useEffect, useRef, useState } from "react";
import type { InspectionReportData, StampMark } from "./zn-types";

const VIEWS = [
  { id: "left", label: "Слева" },
  { id: "right", label: "Справа" },
  { id: "front", label: "Спереди" },
  { id: "rear", label: "Сзади" },
  { id: "top", label: "Сверху" },
] as const;

const COMPLETENESS_OPTS = [
  "Домкрат",
  "Запасное колесо",
  "Аптечка",
  "Огнетушитель",
  "Знак аварийной остановки",
  "Коврики",
];

type Tool = "marker" | "eraser" | "stamp";

type Props = {
  value: InspectionReportData;
  onChange: (next: InspectionReportData) => void;
};

function CarSilhouette({ view }: { view: string }) {
  // Simple SVG outlines — marker draws on canvas above
  if (view === "top") {
    return (
      <svg viewBox="0 0 200 120" className="zn-car-svg">
        <rect x="50" y="20" width="100" height="80" rx="18" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect x="70" y="35" width="60" height="50" rx="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="65" cy="30" r="6" fill="none" stroke="currentColor" />
        <circle cx="135" cy="30" r="6" fill="none" stroke="currentColor" />
        <circle cx="65" cy="90" r="6" fill="none" stroke="currentColor" />
        <circle cx="135" cy="90" r="6" fill="none" stroke="currentColor" />
      </svg>
    );
  }
  if (view === "front" || view === "rear") {
    return (
      <svg viewBox="0 0 200 120" className="zn-car-svg">
        <path
          d="M40 80 Q40 40 100 30 Q160 40 160 80 L150 95 H50 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect x="55" y="50" width="35" height="18" rx="3" fill="none" stroke="currentColor" />
        <rect x="110" y="50" width="35" height="18" rx="3" fill="none" stroke="currentColor" />
        <line x1="70" y1="95" x2="85" y2="95" stroke="currentColor" strokeWidth="3" />
        <line x1="115" y1="95" x2="130" y2="95" stroke="currentColor" strokeWidth="3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 220 100" className="zn-car-svg">
      <path
        d="M20 70 L40 45 Q55 30 90 28 L140 28 Q170 30 185 50 L200 70 L190 78 H30 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="60" cy="78" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="160" cy="78" r="12" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M75 45 L95 32 H135 L150 45 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function MarkerCanvas({
  viewId,
  strokes,
  stamps,
  tool,
  stampKind,
  onStroke,
  onStamp,
  onEraseNear,
}: {
  viewId: string;
  strokes: { x: number; y: number }[][];
  stamps: StampMark[];
  tool: Tool;
  stampKind: StampMark["kind"];
  onStroke: (view: string, stroke: { x: number; y: number }[]) => void;
  onStamp: (mark: StampMark) => void;
  onEraseNear: (view: string, x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const current = useRef<{ x: number; y: number }[]>([]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 3;
    for (const stroke of strokes) {
      if (stroke.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0]!.x * w, stroke[0]!.y * h);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i]!.x * w, stroke[i]!.y * h);
      }
      ctx.stroke();
    }
    for (const s of stamps.filter((x) => x.view === viewId)) {
      const colors: Record<string, string> = { B: "#e11d48", C: "#2563eb", T: "#ea580c", Ц: "#7c3aed" };
      ctx.fillStyle = colors[s.kind] || "#e11d48";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(s.kind, s.x * w - 6, s.y * h + 6);
    }
  }, [strokes, stamps, viewId]);

  useEffect(() => {
    redraw();
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  return (
    <canvas
      ref={canvasRef}
      className="zn-marker-canvas"
      onPointerDown={(e) => {
        const p = pos(e);
        if (tool === "stamp") {
          onStamp({ view: viewId, x: p.x, y: p.y, kind: stampKind });
          return;
        }
        if (tool === "eraser") {
          onEraseNear(viewId, p.x, p.y);
          return;
        }
        drawing.current = true;
        current.current = [p];
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drawing.current || tool !== "marker") return;
        current.current.push(pos(e));
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const pts = current.current;
        if (pts.length < 2) return;
        ctx.strokeStyle = "#e11d48";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        const a = pts[pts.length - 2]!;
        const b = pts[pts.length - 1]!;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }}
      onPointerUp={() => {
        if (!drawing.current) return;
        drawing.current = false;
        if (current.current.length > 1) onStroke(viewId, current.current);
        current.current = [];
      }}
    />
  );
}

export function ZnInspectionTab({ value, onChange }: Props) {
  const [tool, setTool] = useState<Tool>("marker");
  const [stampKind, setStampKind] = useState<StampMark["kind"]>("B");
  const [activeView, setActiveView] = useState<string>("left");

  const patch = (partial: Partial<InspectionReportData>) => onChange({ ...value, ...partial });

  const toggleComplete = (tag: string) => {
    const has = value.completeness.includes(tag);
    patch({
      completeness: has
        ? value.completeness.filter((x) => x !== tag)
        : [...value.completeness, tag],
    });
  };

  return (
    <div className="zn-inspect">
      <div className="zn-inspect__tools">
        <button type="button" className={`crm-btn${tool === "marker" ? " crm-btn-primary" : ""}`} onClick={() => setTool("marker")}>
          Красный маркер
        </button>
        <button type="button" className={`crm-btn${tool === "eraser" ? " crm-btn-primary" : ""}`} onClick={() => setTool("eraser")}>
          Ластик
        </button>
        <button type="button" className={`crm-btn${tool === "stamp" ? " crm-btn-primary" : ""}`} onClick={() => setTool("stamp")}>
          Штамп
        </button>
        {tool === "stamp" && (
          <div className="zn-legend">
            {(["B", "C", "T", "Ц"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`zn-legend__btn${stampKind === k ? " is-active" : ""}`}
                onClick={() => setStampKind(k)}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        <span className="zn-muted">B вмятина · C скол · T трещина · Ц царапина</span>
      </div>

      <div className="zn-inspect__views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`zn-inspect__view-tab${activeView === v.id ? " is-active" : ""}`}
            onClick={() => setActiveView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="zn-inspect__stage">
        <CarSilhouette view={activeView} />
        <MarkerCanvas
          viewId={activeView}
          strokes={value.strokes[activeView] || []}
          stamps={value.stamps}
          tool={tool}
          stampKind={stampKind}
          onStroke={(view, stroke) => {
            const prev = value.strokes[view] || [];
            patch({ strokes: { ...value.strokes, [view]: [...prev, stroke] } });
          }}
          onStamp={(mark) => patch({ stamps: [...value.stamps, mark] })}
          onEraseNear={(view, x, y) => {
            const prev = value.strokes[view] || [];
            const next = prev.filter(
              (stroke) =>
                !stroke.some((p) => Math.hypot(p.x - x, p.y - y) < 0.04),
            );
            const stamps = value.stamps.filter(
              (s) => !(s.view === view && Math.hypot(s.x - x, s.y - y) < 0.05),
            );
            patch({ strokes: { ...value.strokes, [view]: next }, stamps });
          }}
        />
      </div>

      <div className="zn-grid" style={{ marginTop: 16 }}>
        <label className="zn-field">
          <span>Уровень топлива</span>
          <select
            value={value.fuelLevel}
            onChange={(e) => patch({ fuelLevel: e.target.value as InspectionReportData["fuelLevel"] })}
          >
            {(["E", "1/4", "1/2", "3/4", "F"] as const).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="zn-field">
          <span>Пробег, км</span>
          <input
            value={value.mileage ?? ""}
            onChange={(e) =>
              patch({ mileage: e.target.value ? Number(e.target.value) || 0 : null })
            }
            inputMode="numeric"
          />
        </label>
        <label className="zn-field zn-field--wide">
          <span>Дефекты ЛКП</span>
          <input
            value={value.paintDefects}
            onChange={(e) => patch({ paintDefects: e.target.value })}
          />
        </label>
        <label className="zn-field zn-field--wide">
          <span>Особые отметки</span>
          <textarea
            rows={3}
            value={value.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </label>
        <div className="zn-field zn-field--wide">
          <span>Комплектность</span>
          <div className="zn-tags">
            {COMPLETENESS_OPTS.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`zn-tag${value.completeness.includes(tag) ? " is-on" : ""}`}
                onClick={() => toggleComplete(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
