// Electron loads sandboxed preload scripts as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("starkDesktop", {
  arm: () => ipcRenderer.invoke("desktop:arm"),
  pause: () => ipcRenderer.send("desktop:pause"),
  pointer: (frame) => ipcRenderer.send("desktop:pointer", frame),
  onResizeError: (listener) => {
    ipcRenderer.on("desktop:resize-error", (_event, message) =>
      listener(message),
    );
  },
  onPaused: (listener) => {
    ipcRenderer.on("desktop:paused", (_event, message) => listener(message));
  },
});
