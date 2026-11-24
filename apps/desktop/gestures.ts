import {
  classify,
  distance,
  palmSize,
  type Point,
} from "../../packages/gesture-engine";
import { GesturePointer, type PointerFrame } from "./pointer";
import { scrollDirection, type ScrollDirection } from "./scroll";

export type Side = "Left" | "Right";
export type Hand = { side?: Side; points: Point[] };
type Center = Pick<Point, "x" | "y">;
type ResizeMode = "single" | "dual";
type Resize = {
  mode: ResizeMode;
  start: number;
  baseline: number;
  scale: number;
  id: number;
  center?: Center;
  offset?: Center;
};

const press = 0.29;
const release = 0.42;
const hold = 130;

function pinched(hand: Hand, finger: 8 | 12 | 16 | 20, threshold: number) {
  return (
    distance(hand.points[4], hand.points[finger]) <
    palmSize(hand.points) * threshold
  );
}

function shortcut(hand: Hand): PointerFrame["action"] {
  if (pinched(hand, 8, release) || pinched(hand, 12, release)) return;
  const ring = distance(hand.points[4], hand.points[16]);
  const pinky = distance(hand.points[4], hand.points[20]);
  if (Math.min(ring, pinky) < palmSize(hand.points) * 0.25) {
    return ring <= pinky ? "context" : "double";
  }
}

export class DesktopGestures {
  private pointer = new GesturePointer();
  private primary?: Hand;
  private resize?: Resize;
  private resizeId = 0;
  private waitForRelease = false;
  private scroll?: { direction: ScrollDirection; start: number };
  private click?: {
    action: NonNullable<PointerFrame["action"]>;
    start: number;
  };
  private clickFired = false;

  reset() {
    this.resize = this.primary = this.scroll = undefined;
    this.waitForRelease = this.clickFired = false;
    this.click = undefined;
    return this.pointer.reset();
  }

  update(detected: Hand[], time: number): PointerFrame {
    const hands = detected.filter(({ points }) => palmSize(points) >= 0.025);
    const previous = this.primary;
    const primary = previous
      ? (hands.find(({ side }) => side && side === previous.side) ??
        hands.find(
          ({ points }) => distance(points[9], previous.points[9]) < 0.15,
        ))
      : hands[0];
    if (!primary && previous) {
      this.reset();
      this.waitForRelease = hands.length > 0;
      return { down: false };
    }
    if (!primary) return this.reset();
    this.primary = primary;
    if (this.waitForRelease) {
      this.waitForRelease = hands.some(
        (hand) => pinched(hand, 8, release) || pinched(hand, 12, release),
      );
      return { down: false };
    }

    const threshold = this.resize ? release : press;
    const other = hands.find((hand) => hand !== primary);
    let mode: ResizeMode | undefined;
    let measure = 0;
    let center: Center | undefined;
    if (
      other &&
      pinched(primary, 8, threshold) &&
      pinched(other, 8, threshold)
    ) {
      const a = primary.points[9];
      const b = other.points[9];
      measure = Math.hypot(a.x - b.x, a.y - b.y);
      if (measure >= (this.resize ? 0.04 : 0.1)) {
        mode = "dual";
        center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    } else if (
      !pinched(primary, 8, release) &&
      pinched(primary, 12, threshold)
    ) {
      mode = "single";
      measure = primary.points[9].y;
    }

    if (this.resize && this.resize.mode !== mode) {
      this.resize = undefined;
      this.waitForRelease = true;
      return this.pointer.reset();
    }
    if (!mode) {
      const action = shortcut(primary);
      if (action || this.clickFired) {
        this.scroll = undefined;
        if (!action) {
          this.click = undefined;
          this.clickFired = false;
        } else if (!this.clickFired) {
          if (this.click?.action !== action)
            this.click = { action, start: time };
          this.clickFired = time - this.click.start >= 80;
          if (this.clickFired) return { ...this.pointer.reset(), action };
        }
        return this.pointer.reset();
      }
      this.click = undefined;
      const direction = scrollDirection(primary.points);
      if (direction) {
        if (this.scroll?.direction !== direction)
          this.scroll = { direction, start: time };
        this.pointer.reset();
        return time - this.scroll.start >= 170
          ? { down: false, scroll: direction }
          : { down: false };
      }
      this.scroll = undefined;
      const grip = classify(primary.points) === "fist";
      const frame = this.pointer.update(primary.points, time, grip);
      if (frame.down && !grip && other) {
        const selected = shortcut(other);
        if (selected)
          frame.selection = selected === "context" ? "ctrl" : "shift";
      }
      return frame;
    }
    this.scroll = this.click = undefined;
    this.clickFired = false;

    const resize = (this.resize ??= {
      id: ++this.resizeId,
      mode,
      start: time,
      baseline: measure,
      scale: 1,
      center,
    });
    this.pointer.reset();
    if (time - resize.start < hold) {
      resize.baseline = measure;
      resize.center = center;
      return { down: false };
    }
    const factor =
      mode === "dual"
        ? measure / resize.baseline
        : Math.exp((resize.baseline - measure) * 3.5);
    resize.scale +=
      (Math.max(0.35, Math.min(2.8, factor)) - resize.scale) * 0.3;
    if (center && resize.center) {
      const dx = (resize.center.x - center.x) * 1.5;
      const dy = (center.y - resize.center.y) * 1.5;
      const offset = resize.offset ?? { x: 0, y: 0 };
      resize.offset = {
        x: offset.x + ((Math.abs(dx) > 0.018 ? dx : 0) - offset.x) * 0.3,
        y: offset.y + ((Math.abs(dy) > 0.018 ? dy : 0) - offset.y) * 0.3,
      };
    }
    return {
      down: false,
      resize: { id: resize.id, scale: resize.scale, offset: resize.offset },
    };
  }
}
