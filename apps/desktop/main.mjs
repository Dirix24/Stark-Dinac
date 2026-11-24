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
import { openInput } from "./x11-input.mjs";

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
let modifier;
let input;
let inputLoading;
let pendingAction;
const clickActions = new Map([
  ["context", [3, 1]],
  ["double", [1, 2]],
]);
let busy = false;
let pending;
let heartbeat;
let armGeneration = 0;
let width;
let height;
let resizeTarget;
let lastScrollAt = -Infinity;
let lastScroll;
const wheelButtons = new Map([
  ["up", "4"],
  ["down", "5"],
  ["left", "6"],
  ["right", "7"],
]);

function native(...args) {
  return execute("xdotool", args, { timeout: 1000 });
}

function disable(reason) {
  armGeneration++;
  enabled = false;
  pending = { down: false };
  pendingAction = undefined;
  void flush();
  if (reason && window && !window.isDestroyed()) {
    window.webContents.send("desktop:paused", reason);
  }
}

async function resizeWindow({ id, scale, offset }, generation) {
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
      const initialX = Number(geometry.match(/^X=(-?\d+)$/m)?.[1]);
      const initialY = Number(geometry.match(/^Y=(-?\d+)$/m)?.[1]);
      resizeTarget = {
        id,
        target,
        initialWidth,
        initialHeight,
        initialX,
        initialY,
        width: initialWidth,
        height: initialHeight,
        x: initialX,
        y: initialY,
      };
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
  const args = [];
  if (newWidth !== resizeTarget.width || newHeight !== resizeTarget.height) {
    args.push("windowsize", target, String(newWidth), String(newHeight));
  }
  let newX = resizeTarget.x;
  let newY = resizeTarget.y;
  if (
    offset &&
    Number.isFinite(resizeTarget.initialX) &&
    Number.isFinite(resizeTarget.initialY)
  ) {
    newX = Math.max(
      40 - newWidth,
      Math.min(
        width - 40,
        Math.round(resizeTarget.initialX + offset.x * width),
      ),
    );
    newY = Math.max(
      0,
      Math.min(
        height - 40,
        Math.round(resizeTarget.initialY + offset.y * height),
      ),
    );
    if (newX !== resizeTarget.x || newY !== resizeTarget.y) {
      args.push("windowmove", target, String(newX), String(newY));
    }
  }
  if (!args.length) return;
  try {
    await native(...args);
    Object.assign(resizeTarget, {
      width: newWidth,
      height: newHeight,
      x: newX,
      y: newY,
    });
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
  const { x, y, down, resize, scroll, selection } = pending;
  const action = pendingAction;
  pendingAction = undefined;
  const generation = armGeneration;
  pending = undefined;
  try {
    const events = [];
    if (!down && pressed) {
      events.push(["button", 1, false]);
      if (modifier) events.push(["key", modifier, false]);
      modifier = undefined;
    }
    if (x !== undefined) events.push(["move", x, y]);
    if (down && !pressed) {
      modifier = selection;
      if (modifier) events.push(["key", modifier, true]);
      events.push(["button", 1, true]);
    }
    if (action && enabled && generation === armGeneration) {
      events.push(["click", ...clickActions.get(action)]);
    }
    if (scroll && enabled && generation === armGeneration) {
      const now = performance.now();
      if (scroll !== lastScroll || now - lastScrollAt >= 135) {
        events.push(["click", Number(wheelButtons.get(scroll)), 1]);
        lastScrollAt = now;
      }
    }
    lastScroll = scroll;
    if (events.length) await input.send(events);
    pressed = down;
    if (resize && enabled && generation === armGeneration) {
      await resizeWindow(resize, generation);
    } else {
      resizeTarget = undefined;
    }
  } catch {
    // Ending the helper's input releases any synthetic buttons and modifiers.
    input?.close();
    input = undefined;
    pressed = false;
    modifier = undefined;
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
  try {
    if (!input) {
      inputLoading ??= openInput(path.join(__dirname, "x11-input.py")).finally(
        () => {
          inputLoading = undefined;
        },
      );
      input = await inputLoading;
    }
  } catch {
    return "No se pudo iniciar XTest. Comprueba que estén instalados python3 y libxtst6.";
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
  const { x, y, down, resize, scroll, action, selection } = frame;
  if (clickActions.has(action)) pendingAction = action;
  if (wheelButtons.has(scroll)) {
    pending = { down: false, scroll };
    void flush();
    return;
  }
  if (
    resize &&
    Number.isSafeInteger(resize.id) &&
    resize.id > 0 &&
    Number.isFinite(resize.scale) &&
    resize.scale >= 0.35 &&
    resize.scale <= 2.8
  ) {
    const offset = resize.offset;
    const validOffset =
      offset &&
      [offset.x, offset.y].every(
        (value) => Number.isFinite(value) && Math.abs(value) <= 1.5,
      );
    pending = {
      down: false,
      resize: {
        id: resize.id,
        scale: resize.scale,
        offset: validOffset ? { x: offset.x, y: offset.y } : undefined,
      },
    };
    void flush();
    return;
  }
  const position = [x, y].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  pending = position
    ? {
        x: Math.round(x * (width - 1)),
        y: Math.round(y * (height - 1)),
        down,
        selection:
          selection === "ctrl" || selection === "shift" ? selection : undefined,
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
  } else {
    input?.close();
  }
});
