export function cameraError(error: unknown): string {
  switch ((error as DOMException | undefined)?.name) {
    case "NotAllowedError":
      return "Permiso de cámara denegado.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró la cámara seleccionada.";
    case "NotReadableError":
      return "La cámara está ocupada o no responde.";
    default:
      return error instanceof Error
        ? error.message
        : "No se pudo abrir la cámara.";
  }
}

export class Camera {
  private stream?: MediaStream;
  private request = 0;

  constructor(
    private video: HTMLVideoElement,
    private preview: HTMLElement,
    private onEnded: () => void,
    private media = navigator.mediaDevices,
  ) {}

  get active() {
    return (
      this.stream
        ?.getVideoTracks()
        .some((track) => track.readyState === "live") ?? false
    );
  }

  get deviceId() {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  setPreview(visible: boolean) {
    this.preview.hidden = !visible;
  }

  async devices() {
    if (!this.media?.enumerateDevices) return [];
    const devices = await this.media.enumerateDevices();
    const seen = new Set<string>();
    return devices.filter(({ deviceId, kind }) => {
      if (kind !== "videoinput" || !deviceId || seen.has(deviceId))
        return false;
      seen.add(deviceId);
      return true;
    });
  }

  async start(deviceId?: string): Promise<boolean> {
    if (!this.media?.getUserMedia)
      throw new Error("La cámara requiere HTTPS o localhost.");
    this.stop();
    const request = this.request;
    const stream = await this.media.getUserMedia({
      video: deviceId
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 640 },
            height: { ideal: 480 },
          }
        : {
            facingMode: { ideal: "user" },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
      audio: false,
    });
    if (request !== this.request) {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    stream.getVideoTracks().forEach((track) =>
      track.addEventListener(
        "ended",
        () => {
          if (stream !== this.stream) return;
          this.stop();
          this.onEnded();
        },
        { once: true },
      ),
    );
    try {
      await this.video.play();
      return stream === this.stream;
    } catch (error) {
      if (stream !== this.stream) return false;
      this.stop();
      throw error;
    }
  }

  stop() {
    this.request++;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.video.srcObject = null;
  }
}
