"use client";

import {
  Dancing_Script,
  Great_Vibes,
  Pacifico,
  Sacramento,
} from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";
import ImageFileUploadButton from "@/components/image-file-upload-button";

/** Matches workspace signature preview / typical photo uploads on white PDF pages. */
export const SIGNATURE_CANVAS_BACKGROUND = "#ffffff";

const EXPORT_WIDTH = 600;
const EXPORT_HEIGHT = 160;
const DRAW_STROKE_COLOR = "#0f2744";
const DRAW_LINE_WIDTH = 2.5;

const dancingScript = Dancing_Script({
  subsets: ["latin"],
  weight: "400",
});

const greatVibes = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
});

const pacifico = Pacifico({
  subsets: ["latin"],
  weight: "400",
});

const sacramento = Sacramento({
  subsets: ["latin"],
  weight: "400",
});

const SIGNATURE_FONT_OPTIONS = [
  { id: "dancing", label: "Dancing Script", family: dancingScript.style.fontFamily },
  { id: "greatVibes", label: "Great Vibes", family: greatVibes.style.fontFamily },
  { id: "pacifico", label: "Pacifico", family: pacifico.style.fontFamily },
  { id: "sacramento", label: "Sacramento", family: sacramento.style.fontFamily },
] as const;

type SignatureMode = "type" | "draw" | "upload";

export type SignatureInputProps = {
  /** Prefills the Type tab (e.g. tenant signature author name). */
  defaultTypedName?: string;
  onSignatureReady: (file: File) => void | Promise<void>;
  disabled?: boolean;
  confirmLabel?: string;
};

function fillCanvasBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = SIGNATURE_CANVAS_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
}

async function canvasToPngFile(
  canvas: HTMLCanvasElement,
  filename = "signature.png",
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not export signature image."));
          return;
        }
        resolve(new File([blob], filename, { type: "image/png" }));
      },
      "image/png",
    );
  });
}

function fitSignatureFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFamily: string,
  maxWidth: number,
  maxHeight: number,
): number {
  let size = 72;
  while (size >= 24) {
    ctx.font = `${size}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const width = metrics.width;
    const height =
      (metrics.actualBoundingBoxAscent ?? size * 0.8) +
      (metrics.actualBoundingBoxDescent ?? size * 0.2);
    if (width <= maxWidth && height <= maxHeight) {
      return size;
    }
    size -= 2;
  }
  return 24;
}

function renderTypedSignatureCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  fontFamily: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
  fillCanvasBackground(ctx, EXPORT_WIDTH, EXPORT_HEIGHT);

  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  const padding = 24;
  const maxWidth = EXPORT_WIDTH - padding * 2;
  const maxHeight = EXPORT_HEIGHT - padding * 2;
  const fontSize = fitSignatureFontSize(ctx, trimmed, fontFamily, maxWidth, maxHeight);
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = DRAW_STROKE_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(trimmed, EXPORT_WIDTH / 2, EXPORT_HEIGHT / 2);
}

const tabButtonClass = (active: boolean) =>
  [
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-300",
  ].join(" ");

export default function SignatureInput({
  defaultTypedName = "",
  onSignatureReady,
  disabled = false,
  confirmLabel = "Use this signature",
}: SignatureInputProps) {
  const [mode, setMode] = useState<SignatureMode>("type");
  const [typedName, setTypedName] = useState(defaultTypedName);
  const [fontId, setFontId] = useState<(typeof SIGNATURE_FONT_OPTIONS)[number]["id"]>(
    "dancing",
  );
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [hasDrawnInk, setHasDrawnInk] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const typeCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const selectedFont =
    SIGNATURE_FONT_OPTIONS.find((option) => option.id === fontId) ??
    SIGNATURE_FONT_OPTIONS[0];

  useEffect(() => {
    setTypedName((current) => (current.trim() ? current : defaultTypedName));
  }, [defaultTypedName]);

  useEffect(() => {
    if (mode !== "type") {
      return;
    }
    const canvas = typeCanvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) {
        renderTypedSignatureCanvas(canvas, typedName, selectedFont.family);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, typedName, fontId, selectedFont.family]);

  const initDrawCanvas = useCallback(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    canvas.width = EXPORT_WIDTH;
    canvas.height = EXPORT_HEIGHT;
    fillCanvasBackground(ctx, EXPORT_WIDTH, EXPORT_HEIGHT);
    ctx.strokeStyle = DRAW_STROKE_COLOR;
    ctx.lineWidth = DRAW_LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setHasDrawnInk(false);
  }, []);

  useEffect(() => {
    if (mode === "draw") {
      initDrawCanvas();
    }
  }, [mode, initDrawCanvas]);

  useEffect(() => {
    if (!uploadFile) {
      setUploadPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(uploadFile);
    setUploadPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [uploadFile]);

  function drawLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    setHasDrawnInk(true);
  }

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = drawCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function handleDrawPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointerPosition(event);
  }

  function handleDrawPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) {
      return;
    }
    const point = pointerPosition(event);
    const last = lastPointRef.current;
    if (last) {
      drawLine(last, point);
    }
    lastPointRef.current = point;
  }

  function handleDrawPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function handleClearDraw() {
    initDrawCanvas();
  }

  const canConfirm =
    mode === "type"
      ? typedName.trim().length > 0
      : mode === "draw"
        ? hasDrawnInk
        : Boolean(uploadFile);

  async function handleConfirm() {
    if (!canConfirm || disabled || confirming) {
      return;
    }

    setConfirming(true);
    try {
      let file: File | null = null;

      if (mode === "type") {
        const canvas = typeCanvasRef.current;
        if (canvas) {
          await document.fonts.ready;
          renderTypedSignatureCanvas(canvas, typedName, selectedFont.family);
          file = await canvasToPngFile(canvas);
        }
      } else if (mode === "draw") {
        const canvas = drawCanvasRef.current;
        if (canvas) {
          file = await canvasToPngFile(canvas);
        }
      } else if (uploadFile) {
        file = uploadFile;
      }

      if (file) {
        await onSignatureReady(file);
        if (mode === "upload") {
          setUploadFile(null);
        }
      }
    } finally {
      setConfirming(false);
    }
  }

  const previewFrameClassName =
    "flex min-h-[4.5rem] w-full max-w-md items-center justify-center overflow-hidden rounded-sm border border-slate-200 bg-white p-1";

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Preview
        </p>
        <div className={previewFrameClassName}>
          {mode === "upload" && uploadPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={uploadPreviewUrl}
              alt="Upload preview"
              className="max-h-16 max-w-full object-contain"
            />
          ) : mode === "upload" ? (
            <span className="text-xs text-slate-500">Choose an image to preview</span>
          ) : mode === "type" ? (
            <canvas
              ref={typeCanvasRef}
              className="max-h-16 w-full object-contain"
              aria-label="Typed signature preview"
            />
          ) : (
            <canvas
              ref={drawCanvasRef}
              className="max-h-16 w-full touch-none cursor-crosshair object-contain"
              aria-label="Draw signature"
              onPointerDown={handleDrawPointerDown}
              onPointerMove={handleDrawPointerMove}
              onPointerUp={handleDrawPointerUp}
              onPointerLeave={handleDrawPointerUp}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={tabButtonClass(mode === "type")}
          disabled={disabled}
          onClick={() => setMode("type")}
        >
          Type
        </button>
        <button
          type="button"
          className={tabButtonClass(mode === "draw")}
          disabled={disabled}
          onClick={() => setMode("draw")}
        >
          Draw
        </button>
        <button
          type="button"
          className={tabButtonClass(mode === "upload")}
          disabled={disabled}
          onClick={() => setMode("upload")}
        >
          Upload
        </button>
      </div>

      {mode === "type" ? (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="signature_input_typed_name"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Name to sign
            </label>
            <input
              id="signature_input_typed_name"
              type="text"
              value={typedName}
              disabled={disabled}
              onChange={(event) => setTypedName(event.target.value)}
              className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]"
              placeholder="Your name"
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Script style</p>
            <div className="flex flex-wrap gap-2">
              {SIGNATURE_FONT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setFontId(option.id)}
                  className={[
                    "rounded-md border px-3 py-2 text-sm transition-colors",
                    fontId === option.id
                      ? "border-[#0f2744] bg-slate-50 ring-1 ring-[#0f2744]"
                      : "border-slate-300 bg-white hover:bg-slate-50",
                  ].join(" ")}
                  style={{ fontFamily: option.family }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {mode === "draw" ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Sign with mouse or touch in the preview area above.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={handleClearDraw}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      ) : null}

      {mode === "upload" ? (
        <div>
          <ImageFileUploadButton
            files={uploadFile ? [uploadFile] : []}
            onChange={(next) => setUploadFile(next[0] ?? null)}
            multiple={false}
            disabled={disabled}
            addLabel="Choose image"
            showClear
            resetInputAfterSelect
          />
        </div>
      ) : null}

      <button
        type="button"
        disabled={disabled || confirming || !canConfirm}
        onClick={() => void handleConfirm()}
        className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {confirming ? "Saving…" : confirmLabel}
      </button>
    </div>
  );
}
