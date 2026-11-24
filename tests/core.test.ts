import assert from "node:assert/strict";
import { test } from "node:test";
import { DesktopGestures, type Side } from "../apps/desktop/gestures";
import { GesturePointer } from "../apps/desktop/pointer";
import { scrollDirection } from "../apps/desktop/scroll";
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

test("camera discovery exposes only distinct selectable video inputs", async () => {
  const { video, preview } = fixture();
  const sources = [
    { kind: "videoinput", deviceId: "", label: "" },
    { kind: "audioinput", deviceId: "mic", label: "Microphone" },
    { kind: "videoinput", deviceId: "cam-1", label: "Integrated" },
    { kind: "videoinput", deviceId: "cam-1", label: "Integrated" },
    { kind: "videoinput", deviceId: "cam-2", label: "" },
  ];
  const media = {
    enumerateDevices: async () => sources,
  } as unknown as MediaDevices;
  const camera = new Camera(video, preview, () => {}, media);

  assert.deepEqual(await camera.devices(), [sources[2], sources[4]]);
  assert.equal(camera.active, false);
});

test("camera capture uses the requested device or lets the browser choose", async () => {
  const { video, preview } = fixture();
  const requests: MediaStreamConstraints[] = [];
  const media = {
    getUserMedia: async (constraints: MediaStreamConstraints) => {
      requests.push(constraints);
      return fixture().stream;
    },
  } as MediaDevices;
  const camera = new Camera(video, preview, () => {}, media);

  await camera.start("cam-2");
  await camera.start();
  assert.deepEqual((requests[0].video as MediaTrackConstraints).deviceId, {
    exact: "cam-2",
  });
  assert.equal(
    (requests[1].video as MediaTrackConstraints).deviceId,
    undefined,
  );
  assert.ok(requests.every(({ audio }) => audio === false));
  camera.stop();
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

test("desktop pointer holds still for a click and drags while the pinch is held", () => {
  const pointer = new GesturePointer();
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  hand[0].y = 0.7;
  hand[4].x = 0.65;
  const initial = pointer.update(hand, 0);
  assert.ok(initial.x !== undefined && Math.abs(initial.x - 0.5) < 1e-9);
  assert.equal(initial.y, 0.5);
  assert.equal(initial.down, false);

  hand[8].x = 0.62;
  assert.deepEqual(pointer.update(hand, 30), initial);
  assert.deepEqual(pointer.update(hand, 99), initial);
  assert.deepEqual(pointer.update(hand, 100), { ...initial, down: true });

  hand[9].x = 0.35;
  const dragged = pointer.update(hand, 170);
  assert.ok(dragged.x !== undefined && dragged.x > initial.x);
  assert.equal(dragged.down, true);

  hand[4].x = 0.45;
  assert.deepEqual(pointer.update(hand, 200), { ...dragged, down: false });
  assert.deepEqual(pointer.update(undefined, 230), { down: false });
});

function trackedHand(
  side: Side,
  x: number,
  y: number,
  pinch?: "index" | "middle",
) {
  const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  points[0].y += 0.2;
  points[4].x += 0.14;
  if (pinch === "index") points[8].x += 0.13;
  if (pinch === "middle") points[12].x += 0.13;
  return { side, points };
}

test("either hand can resize with the middle-finger pinch", () => {
  for (const side of ["Left", "Right"] as const) {
    const gestures = new DesktopGestures();
    const at = (y: number) => trackedHand(side, 0.4, y, "middle");
    assert.deepEqual(gestures.update([at(0.5)], 0), { down: false });
    const baseline = gestures.update([at(0.5)], 130);
    assert.equal(baseline.resize?.scale, 1);
    const larger = gestures.update([at(0.35)], 160);
    const smaller = gestures.update([at(0.75)], 190);
    assert.ok(larger.resize && larger.resize.scale > 1);
    assert.ok(smaller.resize && smaller.resize.scale < 1);
    assert.deepEqual(gestures.update([trackedHand(side, 0.4, 0.5)], 220), {
      down: false,
    });
  }
});

test("two hands move and resize in both directions without clicking when one hand releases", () => {
  const gestures = new DesktopGestures();
  const at = (left: number, right: number) => [
    trackedHand("Left", left, 0.5, "index"),
    trackedHand("Right", right, 0.5, "index"),
  ];
  assert.deepEqual(gestures.update(at(0.3, 0.6), 0), { down: false });
  assert.equal(gestures.update(at(0.3, 0.6).reverse(), 130).resize?.scale, 1);
  const translated = gestures.update(at(0.37, 0.67), 145);
  assert.ok(translated.resize?.offset && translated.resize.offset.x < 0);
  assert.ok(Math.abs((translated.resize?.scale ?? 0) - 1) < 1e-9);
  const larger = gestures.update(at(0.24, 0.67), 160);
  const smaller = gestures.update(at(0.37, 0.53), 190);
  assert.ok(larger.resize && larger.resize.scale > 1);
  assert.ok(smaller.resize && smaller.resize.scale < 1);
  assert.deepEqual(gestures.update(at(0.37, 0.53).slice(0, 1), 220), {
    down: false,
  });
  assert.deepEqual(gestures.update(at(0.37, 0.53).slice(0, 1), 400), {
    down: false,
  });
});

test("with both hands visible the pointer sticks to the current hand", () => {
  const gestures = new DesktopGestures();
  const left = trackedHand("Left", 0.3, 0.5);
  const right = trackedHand("Right", 0.6, 0.5);
  const first = gestures.update([left, right], 0);
  assert.deepEqual(gestures.update([right, left], 33), first);
  assert.deepEqual(gestures.update([right], 66), { down: false });
  gestures.update([right], 99);
  assert.ok(gestures.update([right], 132).x !== first.x);
});

test("context and double-click each fire once until the gesture is released", () => {
  for (const [finger, action] of [
    [16, "context"],
    [20, "double"],
  ] as const) {
    const gestures = new DesktopGestures();
    const hand = trackedHand("Right", 0.4, 0.5);
    hand.points[finger].x += 0.14;
    assert.deepEqual(gestures.update([hand], 0), { down: false });
    assert.deepEqual(gestures.update([hand], 79), { down: false });
    assert.deepEqual(gestures.update([hand], 80), { down: false, action });
    assert.deepEqual(gestures.update([hand], 200), { down: false });
    gestures.update([trackedHand("Right", 0.4, 0.5)], 220);
    gestures.update([hand], 300);
    assert.deepEqual(gestures.update([hand], 390), { down: false, action });
  }
});

test("the other hand can modify a selection click and the fist can grip and release", () => {
  for (const [finger, selection] of [
    [16, "ctrl"],
    [20, "shift"],
  ] as const) {
    const gestures = new DesktopGestures();
    const primary = trackedHand("Left", 0.4, 0.5, "index");
    const secondary = trackedHand("Right", 0.65, 0.5);
    secondary.points[finger].x += 0.14;
    gestures.update([primary, secondary], 0);
    const pressed = gestures.update([secondary, primary], 75);
    assert.equal(pressed.down, true);
    assert.equal(pressed.selection, selection);
    assert.equal(
      gestures.update([trackedHand("Left", 0.4, 0.5), secondary], 100).down,
      false,
    );
  }

  const gestures = new DesktopGestures();
  const fist = trackedHand("Right", 0.4, 0.5);
  fist.points[4].x = 0.44;
  gestures.update([trackedHand("Right", 0.4, 0.5)], 0);
  assert.equal(gestures.update([fist], 25).down, false);
  assert.equal(gestures.update([fist], 174).down, false);
  const gripped = gestures.update([fist], 175);
  fist.points[9].x -= 0.1;
  const dragged = gestures.update([fist], 205);
  assert.equal(gripped.down && dragged.down, true);
  assert.ok(
    dragged.x !== undefined && gripped.x !== undefined && dragged.x > gripped.x,
  );
  assert.equal(
    gestures.update([trackedHand("Right", 0.4, 0.5)], 240).down,
    false,
  );
});

function scrollHand(x: number, y: number, side: Side = "Right") {
  const hand = trackedHand(side, 0.5, 0.5);
  const reach = Math.hypot(x, y);
  hand.points[4].x = 0.5 - (y * 0.14) / reach;
  hand.points[4].y = 0.5 + (x * 0.14) / reach;
  for (const base of [5, 9]) {
    for (let joint = 1; joint <= 3; joint++) {
      hand.points[base + joint].x += (x * joint) / 3;
      hand.points[base + joint].y += (y * joint) / 3;
    }
  }
  return hand;
}

test("scroll recognizes both fingers pointing together in four directions", () => {
  assert.equal(scrollDirection(scrollHand(0, -0.18).points), "up");
  assert.equal(scrollDirection(scrollHand(0, 0.18).points), "down");
  assert.equal(scrollDirection(scrollHand(0.18, 0).points), "left");
  assert.equal(scrollDirection(scrollHand(-0.18, 0).points), "right");

  const hand = scrollHand(0, -0.18);
  hand.points[12].y = 0.68;
  assert.equal(scrollDirection(hand.points), undefined);
  const threeFingers = scrollHand(0, -0.18);
  for (let joint = 1; joint <= 3; joint++) {
    threeFingers.points[13 + joint].y -= joint * 0.06;
  }
  assert.equal(scrollDirection(threeFingers.points), undefined);
});

test("scroll starts after a hold with either hand, freezes the pointer and stops on release", () => {
  for (const side of ["Left", "Right"] as const) {
    const gestures = new DesktopGestures();
    const up = scrollHand(0, -0.18, side);
    const down = scrollHand(0, 0.18, side);
    assert.deepEqual(gestures.update([up], 0), { down: false });
    assert.deepEqual(gestures.update([up], 169), { down: false });
    assert.deepEqual(gestures.update([up], 170), { down: false, scroll: "up" });
    assert.deepEqual(gestures.update([up], 310), { down: false, scroll: "up" });
    assert.deepEqual(gestures.update([down], 350), { down: false });
    assert.deepEqual(gestures.update([down], 520), {
      down: false,
      scroll: "down",
    });
    assert.deepEqual(gestures.update([], 550), { down: false });
    assert.deepEqual(gestures.update([down], 570), { down: false });
  }
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
