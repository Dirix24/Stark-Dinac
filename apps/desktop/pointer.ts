import { distance, palmSize, type Point } from "../../packages/gesture-engine";

import type { ScrollDirection } from "./scroll";

export type PointerFrame = {
  x?: number;
  y?: number;
  down: boolean;
  scroll?: ScrollDirection;
  action?: "double" | "context";
  selection?: "ctrl" | "shift";
  resize?: { id: number; scale: number; offset?: Position };
};
type Position = { x: number; y: number };

function mapRange(value: number, low: number, high: number) {
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

function screenPosition(point: Point) {
  return {
    x: mapRange(1 - point.x, 0.19, 0.81),
    y: mapRange(point.y, 0.16, 0.84),
  };
}

export class GesturePointer {
  private position?: Position;
  private pinch?: { time: number; origin: Position; palm: Position };
  private down = false;
  private fist = false;

  reset(): PointerFrame {
    this.position = undefined;
    this.pinch = undefined;
    this.down = this.fist = false;
    return { down: false };
  }

  update(hand: Point[] | undefined, time: number, grip = false): PointerFrame {
    const size = hand ? palmSize(hand) : 0;
    if (!hand || size < 0.025) return this.reset();
    const fingertip = screenPosition(hand[8]);
    const ratio = distance(hand[4], hand[8]) / size;
    const holding = grip || (!this.fist && ratio <= (this.down ? 0.42 : 0.29));
    if (!holding) {
      const released = this.down;
      this.pinch = undefined;
      this.down = this.fist = false;
      if (!released) this.move(fingertip);
    } else {
      const palm = screenPosition(hand[9]);
      this.pinch ??= { time, origin: this.position ?? fingertip, palm };
      const { time: started, origin, palm: initialPalm } = this.pinch;
      if (!this.down && time - started >= (grip ? 150 : 70)) {
        // Keep the cursor where the pinch began. Movement after this frame drags it.
        this.down = true;
        this.fist = grip;
        this.pinch.palm = palm;
      } else if (this.down) {
        this.move({
          x: mapRange(origin.x + palm.x - initialPalm.x, 0, 1),
          y: mapRange(origin.y + palm.y - initialPalm.y, 0, 1),
        });
      } else {
        this.position = origin;
      }
    }
    return { ...this.position, down: this.down };
  }

  private move(target: Position) {
    if (!this.position) {
      this.position = target;
      return;
    }
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    const weight = Math.min(0.9, 0.34 + Math.hypot(dx, dy) * 9);
    this.position = {
      x: this.position.x + dx * weight,
      y: this.position.y + dy * weight,
    };
  }
}
