import { distance, palmSize, type Point } from "../../packages/gesture-engine";

import type { ScrollDirection } from "./scroll";

export type PointerFrame = {
  x?: number;
  y?: number;
  down: boolean;
  scroll?: ScrollDirection;
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

  reset(): PointerFrame {
    this.position = undefined;
    this.pinch = undefined;
    this.down = false;
    return { down: false };
  }

  update(hand: Point[] | undefined, time: number): PointerFrame {
    const size = hand ? palmSize(hand) : 0;
    if (!hand || size < 0.025) return this.reset();
    const fingertip = screenPosition(hand[8]);
    const ratio = distance(hand[4], hand[8]) / size;
    if (ratio >= 0.42 || (!this.down && ratio > 0.29)) {
      const released = this.down;
      this.pinch = undefined;
      this.down = false;
      if (!released) this.move(fingertip);
    } else {
      const palm = screenPosition(hand[9]);
      this.pinch ??= { time, origin: this.position ?? fingertip, palm };
      const { time: started, origin, palm: initialPalm } = this.pinch;
      if (!this.down && time - started >= 105) {
        // Keep the cursor where the pinch began. Movement after this frame drags it.
        this.down = true;
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
    this.position = this.position
      ? {
          x: this.position.x + (target.x - this.position.x) * 0.32,
          y: this.position.y + (target.y - this.position.y) * 0.32,
        }
      : target;
  }
}
