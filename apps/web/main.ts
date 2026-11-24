import "./style.css";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { Camera, cameraError } from "../../packages/camera-engine";
import { createTracker, drawHands } from "../../packages/hand-tracking";
import {
  classify,
  GestureGate,
  palmSize,
  type Point,
} from "../../packages/gesture-engine";
import { clamp, VideoEngine } from "../../packages/video-engine";
import type { Editor } from "../../packages/3d-editor";

function element<T extends HTMLElement>(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error("Falta el elemento " + id);
  return node as T;
}
const button = (id: string) => element<HTMLButtonElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const input = (id: string) => element<HTMLInputElement>(id);
const report = (message: string) => {
  element("message").textContent = message;
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const source = element<HTMLVideoElement>("camera");
const overlay = element<HTMLCanvasElement>("landmarks");
const camera = new Camera(source, element("feed"), () =>
  stopCamera("Se desconectó la cámara."),
);
const gate = new GestureGate();
let tracker: HandLandmarker | undefined;
let loading: Promise<HandLandmarker> | undefined;
let generation = 0;
let cameraRequest = 0;
let deviceListRequest = 0;
let preferredDevice = "";
let starting = false;
let visible = true;
let active = false;
let animation = 0;
let lastFrame = -Infinity;
let lastVideoTime = -1;
let frames = 0;
let fpsSince = 0;
let currentHand: Point[] | undefined;
let handLabel: string | undefined;
let cursor: { x: number; y: number } | undefined;
let calibration = { x: 0.5, y: 0.5, size: 0.14 };
let editor: Editor | undefined;
let editorLoading: Promise<Editor> | undefined;
let mode: "video" | "editor" = "video";

function updateStatus() {
  const live = camera.active;
  const state = element("privacy");
  state.toggleAttribute("data-live", live);
  state.textContent = live
    ? visible
      ? "Cámara conectada · Vista en directo"
      : "Cámara conectada · Vista oculta"
    : starting
      ? "Solicitando cámara…"
      : "Cámara apagada";
  element("sensor-status").textContent = active
    ? "Reconocimiento activo"
    : state.textContent;
  element("sensor-status").hidden = live && visible && !active;
  button("start").disabled = live || starting;
  button("stop").disabled = !(live || starting);
  button("visibility").disabled = !live;
  button("visibility").textContent = visible
    ? "Ocultar cámara"
    : "Mostrar cámara";
  button("gestures").disabled = !live;
  button("gestures").textContent = active ? "Pausar gestos" : "Activar gestos";
  button("calibrate").disabled = !active || !currentHand;
  select("devices").disabled = starting || select("devices").options.length < 3;
}

function resetGesture() {
  gate.reset();
  cursor = undefined;
  handLabel = undefined;
  currentHand = undefined;
  element("cursor").hidden = true;
  editor?.endDrag();
}

function pauseGestures() {
  generation++;
  active = false;
  cancelAnimationFrame(animation);
  resetGesture();
  drawHands(overlay);
  element("fps").textContent = "0 FPS";
  element("hands").textContent = "0 manos";
  updateStatus();
}

function stopCamera(message = "Cámara detenida.") {
  cameraRequest++;
  starting = false;
  camera.stop();
  pauseGestures();
  report(message);
  void listDevices();
}

async function listDevices() {
  const request = ++deviceListRequest;
  try {
    const devices = await camera.devices();
    if (request !== deviceListRequest) return;
    if (!devices.some((device) => device.deviceId === preferredDevice)) {
      preferredDevice = "";
    }
    const picker = select("devices");
    picker.replaceChildren(
      new Option("Automática", ""),
      ...devices.map(
        (device, index) =>
          new Option(device.label || "Cámara " + (index + 1), device.deviceId),
      ),
    );
    picker.value = camera.deviceId || preferredDevice;
    if (picker.selectedIndex < 0) picker.value = "";
    updateStatus();
  } catch {
    if (request === deviceListRequest && camera.active) {
      report("No se pudo actualizar la lista de cámaras.");
    }
  }
}

async function startCamera() {
  const request = ++cameraRequest;
  deviceListRequest++;
  const resume = active;
  pauseGestures();
  starting = true;
  const pending = camera.start(preferredDevice || undefined);
  updateStatus();
  report("");
  try {
    if (!(await pending) || request !== cameraRequest) return;
    report("Cámara conectada.");
    if (resume) void activateGestures();
    void listDevices();
  } catch (error) {
    if (request === cameraRequest) {
      report(cameraError(error));
      void listDevices();
    }
  } finally {
    if (request === cameraRequest) {
      starting = false;
      updateStatus();
    }
  }
}

const player = element<HTMLVideoElement>("player");
const video = new VideoEngine(player);
const playlist: File[] = [];
let videoUrl: string | undefined;
const jump = () => Number(select("jump").value);

function loadVideo(index: number) {
  const file = playlist[index];
  if (!file) return;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  player.src = videoUrl;
  select("playlist").selectedIndex = index;
  report("");
}

function videoGesture(pose: ReturnType<typeof classify>) {
  if (!videoUrl) return;
  if (pose === "pinch")
    void video.toggle().catch((error) => report(errorMessage(error)));
  if (pose === "palm") video.seek(jump());
  if (pose === "fist") video.seek(-jump());
}

function frame(time: number) {
  if (!active || !tracker) return;
  animation = requestAnimationFrame(frame);
  if (
    source.readyState < 2 ||
    source.currentTime === lastVideoTime ||
    time - lastFrame < 1000 / Number(select("performance").value) - 1
  )
    return;
  lastVideoTime = source.currentTime;
  lastFrame = time;
  try {
    const result = tracker.detectForVideo(source, time);
    if (overlay.width !== source.videoWidth) overlay.width = source.videoWidth;
    if (overlay.height !== source.videoHeight)
      overlay.height = source.videoHeight;
    drawHands(overlay, result);
    const labels = result.handedness.map((hand) => hand[0]?.categoryName);
    const preferred = labels.indexOf(select("side").value);
    const index = preferred >= 0 ? preferred : 0;
    const label = labels[index];
    if (!result.landmarks[index] || (handLabel && label !== handLabel))
      resetGesture();
    handLabel = label;
    currentHand = result.landmarks[index];
    const names = labels.map((name) =>
      name === "Left"
        ? "izquierda"
        : name === "Right"
          ? "derecha"
          : "lateralidad desconocida",
    );
    const count = result.landmarks.length;
    element("hands").textContent = count
      ? count + (count === 1 ? " mano · " : " manos · ") + names.join(" / ")
      : "0 manos";
    frames++;
    if (time - fpsSince >= 1000) {
      element("fps").textContent =
        Math.round((frames * 1000) / (time - fpsSince)) + " FPS";
      frames = 0;
      fpsSince = time;
    }
    button("calibrate").disabled = !currentHand;
    if (!currentHand) return;
    const pose = classify(currentHand, Number(input("sensitivity").value));
    const size = palmSize(currentHand);
    const nearCalibration =
      size >= calibration.size * 0.38 && size <= calibration.size * 3;
    if (!nearCalibration) {
      gate.reset();
      editor?.endDrag();
      element("cursor").hidden = true;
      return;
    }
    const phase = gate.update(pose, time, Number(select("hold").value));
    if (mode === "video") {
      if (phase === "start") videoGesture(pose);
      return;
    }
    const tip = currentHand[8];
    const x = clamp(0.5 + (1 - tip.x - calibration.x) * 1.35, 0, 1);
    const y = clamp(0.5 + (tip.y - calibration.y) * 1.35, 0, 1);
    const previous = cursor;
    cursor = previous
      ? {
          x: previous.x + (x - previous.x) * 0.42,
          y: previous.y + (y - previous.y) * 0.42,
        }
      : { x, y };
    const marker = element("cursor");
    marker.hidden = false;
    marker.style.left = cursor.x * 100 + "%";
    marker.style.top = cursor.y * 100 + "%";
    if (phase === "start" && pose === "pinch")
      editor?.beginDrag(cursor.x, cursor.y);
    if (phase === "start" && (pose === "palm" || pose === "fist"))
      editor?.beginTransform();
    if (phase === "hold" && pose === "pinch") editor?.move(cursor.x, cursor.y);
    if (phase === "hold" && pose === "palm" && previous)
      editor?.transform((cursor.x - previous.x) * 7, 1);
    if (phase === "hold" && pose === "fist" && previous)
      editor?.transform(0, Math.exp((previous.y - cursor.y) * 4));
    if (phase === "end" || phase === "cancel") editor?.endDrag();
  } catch (error) {
    pauseGestures();
    report("Se interrumpió el reconocimiento. " + errorMessage(error));
  }
}

async function activateGestures() {
  if (!camera.active || active) return;
  const request = ++generation;
  report("Cargando el reconocimiento de manos…");
  try {
    if (!tracker) {
      loading ??= createTracker().finally(() => {
        loading = undefined;
      });
      tracker = await loading;
    }
    if (request !== generation || !camera.active) return;
    resetGesture();
    lastFrame = -Infinity;
    lastVideoTime = -1;
    fpsSince = performance.now();
    frames = 0;
    active = true;
    animation = requestAnimationFrame(frame);
    report("Reconocimiento activo.");
    updateStatus();
  } catch (error) {
    if (request === generation)
      report("No se pudo cargar MediaPipe. " + errorMessage(error));
  }
}

button("start").onclick = () => void startCamera();
button("stop").onclick = () => stopCamera();
button("visibility").onclick = () => {
  visible = !visible;
  camera.setPreview(visible);
  updateStatus();
};
button("gestures").onclick = () => {
  if (active) {
    pauseGestures();
    report("Gestos en pausa.");
  } else if (loading) {
    pauseGestures();
    report("Activación cancelada.");
  } else {
    void activateGestures();
  }
};
button("calibrate").onclick = () => {
  if (!currentHand) return;
  const tip = currentHand[8];
  calibration = { x: 1 - tip.x, y: tip.y, size: palmSize(currentHand) };
  resetGesture();
  report("Posición y distancia calibradas para esta sesión.");
};
select("devices").onchange = () => {
  preferredDevice = select("devices").value;
  if (camera.active) void startCamera();
};
select("side").onchange = resetGesture;
navigator.mediaDevices?.addEventListener(
  "devicechange",
  () => void listDevices(),
);
window.addEventListener("focus", () => void listDevices());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void listDevices();
});
void listDevices();

input("videos").onchange = () => {
  const files = Array.from(input("videos").files ?? []);
  if (!files.length) return;
  const index = playlist.length;
  playlist.push(...files);
  select("playlist").append(...files.map((file) => new Option(file.name)));
  select("playlist").disabled = false;
  loadVideo(index);
  input("videos").value = "";
};
select("playlist").onchange = () => loadVideo(select("playlist").selectedIndex);
player.onended = () => {
  const next = select("playlist").selectedIndex + 1;
  if (next >= playlist.length) return;
  loadVideo(next);
  void player.play().catch((error) => report(errorMessage(error)));
};
player.onerror = () => report("El navegador no pudo reproducir ese archivo.");
button("back").onclick = () => video.seek(-jump());
button("forward").onclick = () => video.seek(jump());
button("mute").onclick = () => video.mute();
select("speed").onchange = () => {
  player.playbackRate = Number(select("speed").value);
};
button("fullscreen").onclick = () => {
  const native = player as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
  };
  if (player.requestFullscreen)
    void player
      .requestFullscreen()
      .catch((error) => report(errorMessage(error)));
  else if (native.webkitEnterFullscreen) {
    try {
      native.webkitEnterFullscreen();
    } catch (error) {
      report(errorMessage(error));
    }
  } else report("Pantalla completa no disponible en este navegador.");
};

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function showMode(next: typeof mode) {
  if (mode === next) return;
  mode = next;
  resetGesture();
  element("video-panel").hidden = next !== "video";
  element("editor-panel").hidden = next !== "editor";
  button("tab-video").setAttribute("aria-pressed", String(next === "video"));
  button("tab-editor").setAttribute("aria-pressed", String(next === "editor"));
  if (next !== "editor" || editor) return;
  const controls = element("editor-controls");
  controls.inert = true;
  try {
    editorLoading ??= import("../../packages/3d-editor").then(
      ({ Editor }) => new Editor(element("scene")),
    );
    editor = await editorLoading;
    controls.inert = false;
  } catch {
    editorLoading = undefined;
    report(
      "No se pudo abrir el editor. Comprueba que el navegador admite WebGL 2.",
    );
  }
}

button("tab-video").onclick = () => void showMode("video");
button("tab-editor").onclick = () => void showMode("editor");
for (const shape of ["cube", "sphere", "cylinder"] as const) {
  button(shape).onclick = () => editor?.add(shape);
}
input("color").onchange = () => editor?.color(input("color").value);
button("rotate").onclick = () => editor?.rotate(Math.PI / 8);
button("smaller").onclick = () => editor?.scale(0.85);
button("larger").onclick = () => editor?.scale(1.15);
button("duplicate").onclick = () => editor?.duplicate();
button("delete").onclick = () =>
  editor?.delete(() => window.confirm("¿Eliminar el objeto seleccionado?"));
button("undo").onclick = () => editor?.undo();
button("redo").onclick = () => editor?.redo();
button("save").onclick = () => {
  if (editor)
    download(
      new Blob([editor.save()], { type: "application/json" }),
      "stark-scene.json",
    );
};
input("load").onchange = async () => {
  const file = input("load").files?.[0];
  input("load").value = "";
  if (!file) return;
  try {
    if (file.size > 1_000_000)
      throw new Error("El archivo de escena supera 1 MB.");
    editor?.load(await file.text());
    report("Escena cargada.");
  } catch (error) {
    report(errorMessage(error));
  }
};
button("export").onclick = async () => {
  try {
    if (editor) download(await editor.export(), "stark-scene.glb");
  } catch (error) {
    report(errorMessage(error));
  }
};

window.addEventListener("pagehide", (event) => {
  stopCamera();
  if (!event.persisted) {
    tracker?.close();
    void loading?.then((pending) => pending.close()).catch(() => {});
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }
});
updateStatus();
