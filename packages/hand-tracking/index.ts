import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";

const wasm =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";
const model =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export async function createTracker({ numHands = 2, wasmRoot = wasm } = {}) {
  const files = await FilesetResolver.forVisionTasks(wasmRoot);
  return HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: model, delegate: "CPU" },
    runningMode: "VIDEO",
    numHands,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
}

export function drawHands(
  canvas: HTMLCanvasElement,
  result?: HandLandmarkerResult,
  color?: (side: string | undefined) => string | undefined,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  for (const [index, points] of (result?.landmarks ?? []).entries()) {
    const tint = color?.(result?.handedness[index]?.[0]?.categoryName);
    context.strokeStyle = tint ?? "#47f4ff";
    context.fillStyle = tint ?? "#c3fbff";
    context.lineWidth = 2;
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      context.beginPath();
      context.moveTo(points[start].x * width, points[start].y * height);
      context.lineTo(points[end].x * width, points[end].y * height);
      context.stroke();
    }
    for (const point of points) {
      context.beginPath();
      context.arc(point.x * width, point.y * height, 3, 0, 2 * Math.PI);
      context.fill();
    }
  }
}
