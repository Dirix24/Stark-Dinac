import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  screen,
} from "electron";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execute = promisify(execFile);
const rendererRoot = path.join(__dirname, "../../dist-desktop");
const entryUrl = "stark://desktop/index.html";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "stark",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("Stark Dinac");
const shortcut = "CommandOrControl+Shift+F8";
let window;
let enabled = false;
let pressed = false;
let busy = false;
let pending;
let heartbeat;
let armGeneration = 0;
let width;
let height;
let resizeTarget;

function native(...args) {
  return execute("xdotool", args, { timeout: 1000 });
}

function disable(reason) {
  armGeneration++;
  enabled = false;
  pending = { down: false };
  void flush();
  if (reason && window && !window.isDestroyed()) {
    window.webContents.send("desktop:paused", reason);
  }
}

async function resizeWindow({ id, scale }, generation) {
  if (resizeTarget?.id !== id) {
    resizeTarget = { id };
    try {
      const { stdout: active } = await native("getactivewindow");
      const target = active.trim();
      if (!/^\d+$/.test(target) || target === "0") throw new Error();
      const { stdout: geometry } = await native(
        "getwindowgeometry",
        "--shell",
        target,
      );
      const initialWidth = Number(geometry.match(/^WIDTH=(\d+)$/m)?.[1]);
      const initialHeight = Number(geometry.match(/^HEIGHT=(\d+)$/m)?.[1]);
      if (!(initialWidth > 0 && initialHeight > 0)) throw new Error();
      resizeTarget = { id, target, initialWidth, initialHeight };
    } catch {
      if (enabled && generation === armGeneration) {
        window?.webContents.send(
          "desktop:resize-error",
          "Selecciona una ventana y vuelve a intentar el gesto.",
        );
      }
    }
  }

  const { target, initialWidth, initialHeight } = resizeTarget;
  if (!target || !enabled || generation !== armGeneration) return;
  const adjusted = Math.min(
    width / initialWidth,
    height / initialHeight,
    Math.max(
      scale,
      Math.min(240, initialWidth) / initialWidth,
      Math.min(150, initialHeight) / initialHeight,
    ),
  );
  const newWidth = Math.round(initialWidth * adjusted);
  const newHeight = Math.round(initialHeight * adjusted);
  if (newWidth === resizeTarget.width && newHeight === resizeTarget.height)
    return;
  try {
    await native("windowsize", target, String(newWidth), String(newHeight));
    Object.assign(resizeTarget, { width: newWidth, height: newHeight });
  } catch {
    resizeTarget = { id };
    if (enabled && generation === armGeneration) {
      window?.webContents.send(
        "desktop:resize-error",
        "La ventana se cerró o no pudo cambiar de tamaño.",
      );
    }
  }
}

async function flush() {
  if (busy || !pending) return;
  busy = true;
  const { x, y, down, resize } = pending;
  const generation = armGeneration;
  pending = undefined;
  try {
    const args = [];
    if (!down && pressed) args.push("mouseup", "1");
    if (x !== undefined) args.push("mousemove", x, y);
    if (down && !pressed) args.push("mousedown", "1");
    if (args.length) await native(...args);
    pressed = down;
    if (resize && enabled && generation === armGeneration) {
      await resizeWindow(resize, generation);
    } else {
      resizeTarget = undefined;
    }
  } catch {
    // Release even if xdotool failed after it had already sent a button event.
    enabled = false;
    pending = undefined;
    try {
      await native("mouseup", "1");
    } catch {
      // The display can already be gone during shutdown.
    }
    pressed = false;
    disable("El escritorio dejó de aceptar el control del puntero.");
  } finally {
    busy = false;
    if (pending) void flush();
  }
}

function trusted(event) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame?.url === entryUrl &&
    event.senderFrame.parent === null
  );
}

ipcMain.handle("desktop:arm", async (event) => {
  if (!trusted(event)) return "Ventana de control desconocida.";
  if (
    process.platform !== "linux" ||
    process.env.XDG_SESSION_TYPE === "wayland"
  ) {
    return "El control del escritorio está disponible en una sesión Linux X11.";
  }
  if (!globalShortcut.isRegistered(shortcut)) {
    return "No se pudo registrar Ctrl + Mayús + F8 para pausar el control.";
  }
  const generation = ++armGeneration;
  try {
    const { stdout } = await native("getdisplaygeometry");
    [width, height] = stdout.trim().split(/\s+/).map(Number);
    if (!(width > 0 && height > 0)) throw new Error("Tamaño inválido.");
  } catch (error) {
    return error.code === "ENOENT"
      ? "Instala xdotool para controlar el puntero (sudo apt install xdotool)."
      : "No se pudo conectar con el escritorio X11.";
  }
  if (generation !== armGeneration || !trusted(event))
    return "La activación se canceló.";
  heartbeat = Date.now();
  enabled = true;
  return "";
});

ipcMain.on("desktop:pause", (event) => {
  if (trusted(event)) disable();
});

ipcMain.on("desktop:pointer", (event, frame) => {
  if (!enabled || !trusted(event) || !frame || typeof frame.down !== "boolean")
    return;
  heartbeat = Date.now();
  const { x, y, down, resize } = frame;
  if (
    resize &&
    Number.isSafeInteger(resize.id) &&
    resize.id > 0 &&
    Number.isFinite(resize.scale) &&
    resize.scale >= 0.35 &&
    resize.scale <= 2.8
  ) {
    pending = { down: false, resize: { id: resize.id, scale: resize.scale } };
    void flush();
    return;
  }
  const position = [x, y].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  pending = position
    ? {
        x: String(Math.round(x * (width - 1))),
        y: String(Math.round(y * (height - 1))),
        down,
      }
    : { down: false };
  void flush();
});

const watchdog = setInterval(() => {
  if (enabled && Date.now() - heartbeat > 1200) {
    disable("Control en pausa porque se interrumpió el seguimiento.");
  }
}, 250);
watchdog.unref();

app.whenReady().then(() => {
  protocol.handle("stark", (request) => {
    const url = new URL(request.url);
    if (url.host !== "desktop") return new Response(null, { status: 404 });
    let file;
    try {
      file = path.resolve(rendererRoot, "." + decodeURIComponent(url.pathname));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!file.startsWith(rendererRoot + path.sep)) {
      return new Response(null, { status: 404 });
    }
    return net.fetch(pathToFileURL(file).href);
  });
  screen.on("display-metrics-changed", () => {
    if (enabled)
      disable("Cambió la pantalla. Activa el control para recalibrar.");
  });
  globalShortcut.register(shortcut, () => disable("Control en pausa."));
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(760, workArea.width);
  const height = Math.min(790, workArea.height - 40);
  window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(560, width),
    minHeight: Math.min(620, height),
    title: "Stark Dinac",
    icon: path.join(__dirname, "logo.png"),
    backgroundColor: "#17131c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("render-process-gone", () => disable());
  contents.session.setPermissionCheckHandler(
    (requester, permission, _origin, details) =>
      requester === contents &&
      permission === "media" &&
      details.mediaType === "video",
  );
  contents.session.setPermissionRequestHandler(
    (requester, permission, decide, details) =>
      decide(
        requester === contents &&
          permission === "media" &&
          details.mediaTypes?.length === 1 &&
          details.mediaTypes[0] === "video",
      ),
  );
  window.on("closed", () => {
    window = undefined;
    disable();
  });
  void window.loadURL(entryUrl);
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", (event) => {
  globalShortcut.unregisterAll();
  disable();
  if (busy || pressed) {
    event.preventDefault();
    const wait = setInterval(() => {
      if (busy || pressed) return;
      clearInterval(wait);
      app.quit();
    }, 30);
  }
});
