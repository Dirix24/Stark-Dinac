import "./style.css";
import { Camera, cameraError } from "../../packages/camera-engine";
import { DesktopGestures, type Hand } from "./gestures";
import type { PointerFrame } from "./pointer";
import { createTracker, drawHands } from "../../packages/hand-tracking";

declare global {
  interface Window {
    starkDesktop: {
      arm(): Promise<string>;
      pause(): void;
      pointer(frame: PointerFrame): void;
      onPaused(listener: (message: string) => void): void;
      onResizeError(listener: (message: string) => void): void;
    };
  }
}
const desktop = window.starkDesktop;

function element<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

const video = element<HTMLVideoElement>("camera");
const overlay = element<HTMLCanvasElement>("landmarks");
const state = element("state");
const message = element("message");
const picker = element<HTMLSelectElement>("cameras");
const cameraToggle = element<HTMLButtonElement>("camera-toggle");
const controlToggle = element<HTMLButtonElement>("control-toggle");
const camera = new Camera(video, video, () =>
  stopCamera("Se desconectó la cámara."),
);
let starting = false;
let cameraRequest = 0;
let listing = 0;
let tracker: Awaited<ReturnType<typeof createTracker>> | undefined;
let trackerLoading: ReturnType<typeof createTracker> | undefined;
let armRequest = 0;
let arming = false;
let controlling = false;
let animation = 0;
let lastTime = -Infinity;
let lastVideo = -1;
const gestures = new DesktopGestures();
const left = element("left-hand");
const right = element("right-hand");

function color(side: string | undefined) {
  return side === "Left" ? "#60aaff" : side === "Right" ? "#53e5a2" : "#ece7ef";
}

function refresh() {
  const live = camera.active;
  state.toggleAttribute("data-live", live);
  if (!controlling) {
    state.textContent = starting
      ? "Abriendo cámara…"
      : live
        ? "Cámara encendida"
        : "Cámara apagada";
  }
  cameraToggle.textContent =
    live || starting ? "Apagar cámara" : "Activar cámara";
  controlToggle.textContent =
    controlling || arming ? "Pausar control" : "Activar control";
  controlToggle.disabled = !live;
  picker.disabled = starting || picker.options.length < 3;
}

async function listCameras() {
  const request = ++listing;
  try {
    const devices = await camera.devices();
    if (request !== listing) return;
    const previous = camera.deviceId || picker.value;
    picker.replaceChildren(
      new Option("Automática", ""),
      ...devices.map(
        ({ deviceId, label }, index) =>
          new Option(label || "Cámara " + (index + 1), deviceId),
      ),
    );
    picker.value = previous;
    if (picker.selectedIndex === -1) picker.value = "";
    refresh();
  } catch {
    if (request === listing)
      message.textContent = "No se pudo actualizar la lista de cámaras.";
  }
}

function pauseControl(reason = "") {
  armRequest++;
  arming = false;
  controlling = false;
  cancelAnimationFrame(animation);
  gestures.reset();
  left.removeAttribute("data-detected");
  right.removeAttribute("data-detected");
  desktop.pause();
  drawHands(overlay);
  message.textContent = reason;
  refresh();
}

function stopCamera(reason = "") {
  cameraRequest++;
  starting = false;
  camera.stop();
  pauseControl(reason);
  void listCameras();
}

async function openCamera(deviceId: string) {
  const request = ++cameraRequest;
  listing++;
  pauseControl();
  starting = true;
  const pending = camera.start(deviceId || undefined);
  refresh();
  try {
    await pending;
  } catch (error) {
    if (request === cameraRequest) message.textContent = cameraError(error);
  } finally {
    if (request === cameraRequest) {
      starting = false;
      refresh();
      void listCameras();
    }
  }
}

function trackFrame(time: number) {
  if (!controlling || !tracker) return;
  if (
    time - lastTime >= 32 &&
    video.readyState >= 2 &&
    video.currentTime !== lastVideo
  ) {
    lastTime = time;
    lastVideo = video.currentTime;
    try {
      const result = tracker.detectForVideo(video, time);
      if (
        overlay.width !== video.videoWidth ||
        overlay.height !== video.videoHeight
      ) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }
      drawHands(overlay, result, color);
      const hands = result.landmarks.map<Hand>((points, index) => {
        const label = result.handedness[index]?.[0]?.categoryName;
        const side = label === "Left" || label === "Right" ? label : undefined;
        return { points, side };
      });
      left.toggleAttribute(
        "data-detected",
        hands.some(({ side }) => side === "Left"),
      );
      right.toggleAttribute(
        "data-detected",
        hands.some(({ side }) => side === "Right"),
      );
      const frame = gestures.update(hands, time);
      desktop.pointer(frame);
      const status = frame.resize
        ? "Control activo · Cambiando tamaño"
        : frame.down
          ? "Control activo · Botón pulsado"
          : frame.x === undefined
            ? "Control activo · Muestra una o dos manos"
            : "Control activo";
      if (state.textContent !== status) state.textContent = status;
    } catch {
      pauseControl("Se interrumpió el seguimiento de la mano.");
      return;
    }
  }
  animation = requestAnimationFrame(trackFrame);
}

async function armControl() {
  if (!camera.active) return;
  const request = ++armRequest;
  arming = true;
  message.textContent = "Cargando el seguimiento de manos…";
  refresh();
  try {
    if (!tracker) {
      trackerLoading ??= createTracker({
        numHands: 2,
        wasmRoot: new URL(".", location.href).href.replace(/\/$/, ""),
      }).finally(() => {
        trackerLoading = undefined;
      });
      tracker = await trackerLoading;
    }
    if (request !== armRequest) return;
    const error = await desktop.arm();
    if (request !== armRequest) return;
    if (error) throw new Error(error);
    controlling = true;
    lastTime = -Infinity;
    lastVideo = -1;
    state.textContent = "Control activo · Muestra una o dos manos";
    message.textContent = "";
    animation = requestAnimationFrame(trackFrame);
  } catch (error) {
    if (request === armRequest) {
      pauseControl(
        error instanceof Error
          ? error.message
          : "No se pudo activar el control.",
      );
    }
  } finally {
    if (request === armRequest) {
      arming = false;
      refresh();
    }
  }
}

cameraToggle.onclick = () =>
  camera.active || starting ? stopCamera() : void openCamera(picker.value);
controlToggle.onclick = () =>
  controlling || arming ? pauseControl() : void armControl();
picker.onchange = () => {
  if (camera.active) void openCamera(picker.value);
};
desktop.onPaused(pauseControl);
desktop.onResizeError((reason) => {
  message.textContent = reason;
});
navigator.mediaDevices?.addEventListener(
  "devicechange",
  () => void listCameras(),
);
window.addEventListener("focus", () => void listCameras());
window.addEventListener("pagehide", () => {
  desktop.pause();
  camera.stop();
  tracker?.close();
});
refresh();
void listCameras();
