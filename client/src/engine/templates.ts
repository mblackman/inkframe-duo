import type {
  ImageLayer,
  StampId,
  StampLayer,
  TemplateId,
  TextFont,
  TextLayer,
} from "../types";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "./transforms";

export interface StationeryTemplateMeta {
  id: TemplateId;
  label: string;
  description: string;
}

export const STATIONERY_TEMPLATES: StationeryTemplateMeta[] = [
  { id: "blank", label: "Blank Paper", description: "Clean warm Spectra paper" },
  { id: "airmail", label: "Air-Mail", description: "Red & blue postcard border" },
  { id: "postcard", label: "Postcard", description: "Divider, stamp box & address lines" },
  { id: "dotted", label: "Dot Grid", description: "28px studio bullet grid" },
  { id: "memo", label: "Morning Memo", description: "Checklist & dispatch notes" },
  { id: "tictactoe", label: "Tic-Tac-Toe", description: "Desk game for Remix replies" },
  { id: "hangman", label: "Hangman", description: "Word puzzle with A-Z tracker" },
];

export interface StampMeta {
  id: StampId;
  label: string;
}

export const STAMPS: StampMeta[] = [
  { id: "heart", label: "Heart" },
  { id: "star", label: "Star" },
  { id: "coffee", label: "Coffee" },
  { id: "sun", label: "Sun" },
  { id: "cloud", label: "Cloud" },
  { id: "postmark", label: "Postmark" },
  { id: "bubble", label: "Speech" },
  { id: "cat", label: "Cat" },
  { id: "arrow", label: "Arrow" },
  { id: "check", label: "Check" },
];

const BLACK = "#1e1e1e";
const WHITE = "#e8e4d9";
const RED = "#9e2a1f";
const BLUE = "#25467a";
const GREEN = "#2d6a3e";

export function drawStationeryTemplate(
  ctx: CanvasRenderingContext2D,
  templateId: TemplateId
): void {
  if (templateId === "blank") return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (templateId === "airmail") {
    const stripeW = 24;
    const gap = 14;
    const border = 14;
    const drawStrip = (x: number, y: number, w: number, h: number, horizontal: boolean) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const total = horizontal ? w + h : h + w;
      let idx = 0;
      for (let pos = -h; pos < total; pos += stripeW + gap) {
        ctx.fillStyle = idx % 2 === 0 ? RED : BLUE;
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(x + pos, y + h);
          ctx.lineTo(x + pos + h, y);
          ctx.lineTo(x + pos + h + stripeW, y);
          ctx.lineTo(x + pos + stripeW, y + h);
        } else {
          ctx.moveTo(x, y + pos + w);
          ctx.lineTo(x + w, y + pos);
          ctx.lineTo(x + w, y + pos + stripeW);
          ctx.lineTo(x, y + pos + w + stripeW);
        }
        ctx.closePath();
        ctx.fill();
        idx++;
      }
      ctx.restore();
    };

    drawStrip(0, 0, CANVAS_WIDTH, border, true);
    drawStrip(0, CANVAS_HEIGHT - border, CANVAS_WIDTH, border, true);
    drawStrip(0, border, border, CANVAS_HEIGHT - border * 2, false);
    drawStrip(CANVAS_WIDTH - border, border, border, CANVAS_HEIGHT - border * 2, false);

    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 2;
    ctx.strokeRect(border + 4, border + 4, CANVAS_WIDTH - (border + 4) * 2, CANVAS_HEIGHT - (border + 4) * 2);
  } else if (templateId === "postcard") {
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2 + 20, 32);
    ctx.lineTo(CANVAS_WIDTH / 2 + 20, CANVAS_HEIGHT - 32);
    ctx.stroke();

    // Stamp box
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(CANVAS_WIDTH - 118, 30, 82, 96);
    ctx.setLineDash([]);

    ctx.fillStyle = RED;
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("INK", CANVAS_WIDTH - 77, 74);
    ctx.fillText("POST", CANVAS_WIDTH - 77, 90);

    // Address lines
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = 215 + i * 52;
      ctx.beginPath();
      ctx.moveTo(CANVAS_WIDTH / 2 + 52, y);
      ctx.lineTo(CANVAS_WIDTH - 36, y);
      ctx.stroke();
    }
  } else if (templateId === "dotted") {
    ctx.fillStyle = BLACK;
    for (let y = 28; y < CANVAS_HEIGHT; y += 28) {
      for (let x = 28; x < CANVAS_WIDTH; x += 28) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  } else if (templateId === "memo") {
    // Header banner
    ctx.fillStyle = BLUE;
    ctx.fillRect(28, 24, CANVAS_WIDTH - 56, 48);
    ctx.fillStyle = WHITE;
    ctx.font = "bold 22px 'Courier New', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("MORNING DISPATCH", 46, 55);

    ctx.fillStyle = WHITE;
    ctx.font = "bold 14px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText("SPECTRA DESK EDITION", CANVAS_WIDTH - 46, 54);

    // Checkboxes on left
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      const y = 115 + i * 66;
      ctx.strokeRect(36, y, 24, 24);
      ctx.beginPath();
      ctx.moveTo(74, y + 24);
      ctx.lineTo(430, y + 24);
      ctx.stroke();
    }

    // Notes box on right
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(465, 102, CANVAS_WIDTH - 493, 344);
    ctx.fillStyle = RED;
    ctx.font = "bold 15px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("NOTES & DOODLES", 482, 130);
  } else if (templateId === "tictactoe") {
    ctx.fillStyle = BLUE;
    ctx.font = "bold 28px 'Avenir Next', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("DESK TIC-TAC-TOE — YOUR TURN!", CANVAS_WIDTH / 2, 54);

    // 3x3 grid centered
    const size = 300;
    const gx = (CANVAS_WIDTH - size) / 2;
    const gy = 98;
    const cell = size / 3;

    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 6;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(gx + cell * i, gy);
      ctx.lineTo(gx + cell * i, gy + size);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(gx, gy + cell * i);
      ctx.lineTo(gx + size, gy + cell * i);
      ctx.stroke();
    }

    // Side score boxes
    ctx.lineWidth = 3;
    ctx.strokeStyle = RED;
    ctx.strokeRect(36, 150, 150, 170);
    ctx.fillStyle = RED;
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("PLAYER X", 111, 185);

    ctx.strokeStyle = GREEN;
    ctx.strokeRect(CANVAS_WIDTH - 186, 150, 150, 170);
    ctx.fillStyle = GREEN;
    ctx.fillText("PLAYER O", CANVAS_WIDTH - 111, 185);
  } else if (templateId === "hangman") {
    ctx.fillStyle = RED;
    ctx.font = "bold 26px 'Courier New', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("INKFRAME HANGMAN", 42, 54);

    // Gallows
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(65, 320);
    ctx.lineTo(220, 320);
    ctx.moveTo(115, 320);
    ctx.lineTo(115, 105);
    ctx.lineTo(240, 105);
    ctx.lineTo(240, 145);
    ctx.moveTo(115, 150);
    ctx.lineTo(160, 105);
    ctx.stroke();

    // 7 word blanks
    ctx.strokeStyle = BLUE;
    ctx.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      const bx = 310 + i * 64;
      ctx.beginPath();
      ctx.moveTo(bx, 250);
      ctx.lineTo(bx + 46, 250);
      ctx.stroke();
    }

    // Alphabet tracker at bottom
    ctx.fillStyle = BLACK;
    ctx.font = "bold 22px 'Courier New', ui-monospace, monospace";
    ctx.textAlign = "center";
    const row1 = "A B C D E F G H I J K L M";
    const row2 = "N O P Q R S T U V W X Y Z";
    ctx.fillText(row1, CANVAS_WIDTH / 2, 392);
    ctx.fillText(row2, CANVAS_WIDTH / 2, 434);
  }

  ctx.restore();
}

/**
 * Draws Polaroid or Postage Stamp mats on the crisp foreground underlay layer
 * while leaving the photo aperture transparent so the dithered photo shows cleanly.
 */
export function drawImageLayerFrameCrisp(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer
): void {
  if (layer.frameStyle === "none") return;

  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scale, layer.scale);

  const w = layer.width;
  const h = layer.height;
  const hw = w / 2;
  const hh = h / 2;

  if (layer.frameStyle === "polaroid") {
    const padSide = 14;
    const padTop = 14;
    const padBottom = 42;
    const ow = w + padSide * 2;
    const oh = h + padTop + padBottom;
    const ox = -hw - padSide;
    const oy = -hh - padTop;

    // Frame mat with inner photo cutout via evenodd fill rule
    ctx.beginPath();
    ctx.rect(ox, oy, ow, oh);
    ctx.rect(-hw, -hh, w, h);
    ctx.fillStyle = WHITE;
    ctx.fill("evenodd");

    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 2.5 / Math.max(0.25, layer.scale);
    ctx.strokeRect(ox, oy, ow, oh);
    ctx.strokeRect(-hw, -hh, w, h);
  } else if (layer.frameStyle === "stamp") {
    const pad = 16;
    const ox = -hw - pad;
    const oy = -hh - pad;
    const ow = w + pad * 2;
    const oh = h + pad * 2;

    ctx.beginPath();
    ctx.rect(ox, oy, ow, oh);
    ctx.rect(-hw, -hh, w, h);
    ctx.fillStyle = WHITE;
    ctx.fill("evenodd");

    // Dashed perforation border & dark inner photo keyline
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 2 / Math.max(0.25, layer.scale);
    ctx.strokeRect(-hw, -hh, w, h);

    ctx.setLineDash([6, 5]);
    ctx.strokeRect(ox + 4, oy + 4, ow - 8, oh - 8);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

export function getFontCss(font: TextFont, fontSize: number): string {
  switch (font) {
    case "handwritten":
      return `bold ${fontSize}px "Bradley Hand", "Segoe Print", "Chalkboard SE", cursive`;
    case "typewriter":
      return `bold ${fontSize}px "Courier New", ui-monospace, monospace`;
    case "pixel":
      return `900 ${fontSize}px ui-monospace, Menlo, Monaco, monospace`;
    case "bold":
    default:
      return `800 ${fontSize}px "Avenir Next", system-ui, -apple-system, sans-serif`;
  }
}

export function measureTextLayerBounds(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer
): { width: number; height: number; lines: string[]; lineHeight: number } {
  const lines = (layer.text || "Your note").split("\n");
  ctx.save();
  ctx.font = getFontCss(layer.font, layer.fontSize);
  let maxW = 40;
  for (const line of lines) {
    const m = ctx.measureText(line || " ");
    if (m.width > maxW) maxW = m.width;
  }
  ctx.restore();

  const lineHeight = layer.fontSize * 1.24;
  const padX = layer.backdrop === "none" ? 12 : 24;
  const padY = layer.backdrop === "none" ? 8 : 16;
  return {
    width: maxW + padX,
    height: lines.length * lineHeight + padY,
    lines,
    lineHeight,
  };
}

export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer
): void {
  const bounds = measureTextLayerBounds(ctx, layer);

  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scale, layer.scale);

  if (layer.backdrop !== "none") {
    const r = 12;
    const x = -bounds.width / 2;
    const y = -bounds.height / 2;
    const w = bounds.width;
    const h = bounds.height;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = layer.backdrop === "pill-dark" ? BLACK : WHITE;
    ctx.fill();
    ctx.strokeStyle = layer.backdrop === "pill-dark" ? WHITE : BLACK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.font = getFontCss(layer.font, layer.fontSize);
  ctx.fillStyle = layer.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const startY = -((bounds.lines.length - 1) * bounds.lineHeight) / 2;
  bounds.lines.forEach((line, idx) => {
    ctx.fillText(line, 0, startY + idx * bounds.lineHeight);
  });

  ctx.restore();
}

export function drawStamp(
  ctx: CanvasRenderingContext2D,
  layer: StampLayer
): void {
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scale, layer.scale);

  const s = layer.size / 2;
  ctx.strokeStyle = layer.color;
  ctx.fillStyle = layer.color;
  ctx.lineWidth = Math.max(3, layer.size * 0.08);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (layer.stampId) {
    case "heart": {
      ctx.beginPath();
      ctx.moveTo(0, s * 0.85);
      ctx.bezierCurveTo(-s * 1.15, s * 0.15, -s * 0.95, -s * 0.85, 0, -s * 0.25);
      ctx.bezierCurveTo(s * 0.95, -s * 0.85, s * 1.15, s * 0.15, 0, s * 0.85);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "star": {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s * 0.95 : s * 0.42;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "coffee": {
      // Mug body
      ctx.beginPath();
      ctx.roundRect(-s * 0.6, -s * 0.25, s * 1.05, s * 1.0, [2, 2, 12, 12]);
      ctx.stroke();
      // Handle
      ctx.beginPath();
      ctx.arc(s * 0.55, s * 0.2, s * 0.28, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      // Steam waves
      for (const sx of [-s * 0.28, 0, s * 0.24]) {
        ctx.beginPath();
        ctx.moveTo(sx, -s * 0.45);
        ctx.quadraticCurveTo(sx - 6, -s * 0.7, sx + 2, -s * 0.9);
        ctx.stroke();
      }
      break;
    }
    case "sun": {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.48, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * s * 0.66, Math.sin(a) * s * 0.66);
        ctx.lineTo(Math.cos(a) * s * 0.95, Math.sin(a) * s * 0.95);
        ctx.stroke();
      }
      break;
    }
    case "cloud": {
      ctx.beginPath();
      ctx.arc(-s * 0.35, s * 0.12, s * 0.36, Math.PI * 0.5, Math.PI * 1.6);
      ctx.arc(0, -s * 0.16, s * 0.42, Math.PI, Math.PI * 1.9);
      ctx.arc(s * 0.42, s * 0.1, s * 0.34, Math.PI * 1.4, Math.PI * 0.5);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "postmark": {
      ctx.beginPath();
      ctx.arc(-s * 0.18, 0, s * 0.68, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.lineWidth = Math.max(1.5, ctx.lineWidth * 0.55);
      ctx.beginPath();
      ctx.arc(-s * 0.18, 0, s * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.font = `900 ${Math.max(9, Math.round(s * 0.23))}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("INK", -s * 0.18, -s * 0.13);
      ctx.fillText("POST", -s * 0.18, s * 0.14);
      // Wavy cancel lines
      for (const wy of [-s * 0.28, 0, s * 0.28]) {
        ctx.beginPath();
        ctx.moveTo(s * 0.52, wy);
        ctx.quadraticCurveTo(s * 0.74, wy - 8, s * 0.98, wy);
        ctx.stroke();
      }
      break;
    }
    case "bubble": {
      ctx.beginPath();
      ctx.roundRect(-s * 0.85, -s * 0.65, s * 1.7, s * 1.1, 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, s * 0.45);
      ctx.lineTo(-s * 0.6, s * 0.85);
      ctx.lineTo(0, s * 0.45);
      ctx.stroke();
      break;
    }
    case "cat": {
      // Cat silhouette head + whiskers
      ctx.beginPath();
      ctx.moveTo(-s * 0.68, -s * 0.1);
      ctx.lineTo(-s * 0.72, -s * 0.82);
      ctx.lineTo(-s * 0.25, -s * 0.42);
      ctx.lineTo(s * 0.25, -s * 0.42);
      ctx.lineTo(s * 0.72, -s * 0.82);
      ctx.lineTo(s * 0.68, -s * 0.1);
      ctx.bezierCurveTo(s * 0.82, s * 0.82, -s * 0.82, s * 0.82, -s * 0.68, -s * 0.1);
      ctx.closePath();
      ctx.stroke();
      // Eyes & nose
      ctx.beginPath();
      ctx.arc(-s * 0.26, s * 0.04, s * 0.09, 0, Math.PI * 2);
      ctx.arc(s * 0.26, s * 0.04, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.1, s * 0.24);
      ctx.lineTo(s * 0.1, s * 0.24);
      ctx.lineTo(0, s * 0.36);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, 0);
      ctx.lineTo(s * 0.75, 0);
      ctx.moveTo(s * 0.28, -s * 0.48);
      ctx.lineTo(s * 0.82, 0);
      ctx.lineTo(s * 0.28, s * 0.48);
      ctx.stroke();
      break;
    }
    case "check": {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.85, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, 0);
      ctx.lineTo(-s * 0.1, s * 0.34);
      ctx.lineTo(s * 0.46, -s * 0.34);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}
