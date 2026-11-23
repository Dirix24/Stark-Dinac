import assert from "node:assert/strict";
import { test } from "node:test";
import { Camera, cameraError } from "../packages/camera-engine";
import { classify, GestureGate, type Point } from "../packages/gesture-engine";
import { VideoEngine } from "../packages/video-engine";

function createMedia(start: () => Promise<MediaStream>) {
  return { getUserMedia: start } as unknown as MediaDevices;
}

function fixture() {
  const track = Object.assign(new EventTarget(), {
    readyState: "live",
    stop() {
      this.readyState = "ended";
    },
    getSettings: () => ({ deviceId: "cam-1" }),
  });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const video = {
    srcObject: null,
    play: async () => {},
  } as unknown as HTMLVideoElement;
  const preview = { hidden: false } as HTMLElement;
  return { track, stream, video, preview };
}

test("camera starts only when requested, hides the preview and releases the stream", async () => {
  const { track, stream, video, preview } = fixture();
  let requests = 0;
  const camera = new Camera(
    video,
    preview,
    () => {},
    createMedia(async () => {
      requests++;
      return stream;
    }),
  );
  assert.equal(requests, 0);
  assert.equal(await camera.start(), true);
  assert.equal(camera.deviceId, "cam-1");
  camera.setPreview(false);
  assert.equal(preview.hidden, true);
  assert.equal(camera.active, true);
  assert.equal(video.srcObject, stream);
  camera.setPreview(true);
  assert.equal(preview.hidden, false);
  camera.stop();
  assert.equal(track.readyState, "ended");
  assert.equal(video.srcObject, null);
  assert.equal(camera.active, false);
});

test("stopping while permission is pending releases late tracks", async () => {
  const { track, stream, video, preview } = fixture();
  let grant!: (stream: MediaStream) => void;
  const camera = new Camera(
    video,
    preview,
    () => {},
    createMedia(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    ),
  );
  const pending = camera.start();
  camera.stop();
  grant(stream);
  assert.equal(await pending, false);
  assert.equal(track.readyState, "ended");
  assert.equal(video.srcObject, null);
});

test("denied permission and missing cameras report distinct states", async () => {
  const { video, preview } = fixture();
  const denied = new DOMException("Denied", "NotAllowedError");
  const camera = new Camera(
    video,
    preview,
    () => {},
    createMedia(async () => {
      throw denied;
    }),
  );
  await assert.rejects(camera.start(), { name: "NotAllowedError" });
  assert.match(cameraError(denied), /denegado/);
  assert.match(
    cameraError(new DOMException("", "NotFoundError")),
    /no se encontró/i,
  );
  assert.equal(camera.active, false);
});

test("loss of the input track clears the active preview", async () => {
  const { track, stream, video, preview } = fixture();
  let ended = 0;
  const camera = new Camera(
    video,
    preview,
    () => {
      ended++;
    },
    createMedia(async () => stream),
  );
  await camera.start();
  track.dispatchEvent(new Event("ended"));
  assert.equal(ended, 1);
  assert.equal(video.srcObject, null);
});

function landmarks(pose: "palm" | "pinch" | "fist"): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
  points[0].y = 0.8;
  points[9].y = 0.6;
  for (const tip of [8, 12, 16, 20]) {
    points[tip - 2].y = 0.5;
    points[tip].y = pose === "fist" ? 0.56 : 0.37;
  }
  points[4].y = pose === "palm" ? 0.6 : pose === "pinch" ? 0.37 : 0.57;
  return points;
}

test("landmark classification covers palm, pinch, fist and no hand", () => {
  for (const pose of ["palm", "pinch", "fist"] as const)
    assert.equal(classify(landmarks(pose)), pose);
  assert.equal(classify([]), "neutral");
});

test("gating requires a neutral pose and sustained hold, then emits a single start", () => {
  const gate = new GestureGate();
  assert.equal(gate.update("pinch", 0, 300), undefined);
  assert.equal(gate.update("pinch", 450, 300), undefined);
  gate.update("neutral", 500, 300);
  gate.update("neutral", 630, 300);
  gate.update("pinch", 700, 300);
  assert.equal(gate.update("pinch", 999, 300), undefined);
  assert.equal(gate.update("pinch", 1000, 300), "start");
  assert.equal(gate.update("pinch", 1650, 300), "hold");
  assert.equal(gate.update("palm", 1700, 300), "cancel");
  assert.equal(gate.update("palm", 2100, 300), undefined);
  gate.reset();
  assert.equal(gate.update("pinch", 2500, 300), undefined);
});

test("video toggles playback and clamps time and volume", async () => {
  const video = {
    duration: 20,
    currentTime: 10,
    paused: true,
    muted: false,
    volume: 0.8,
    playbackRate: 1,
    async play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
  };
  const engine = new VideoEngine(video);
  await engine.toggle();
  assert.equal(video.paused, false);
  await engine.toggle();
  assert.equal(video.paused, true);
  engine.seek(30);
  assert.equal(video.currentTime, 20);
  engine.seek(-30);
  assert.equal(video.currentTime, 0);
  engine.volume(0.4);
  assert.equal(video.volume, 1);
  engine.mute();
  assert.equal(video.muted, true);
});
