import { classify, type Point } from "../../packages/gesture-engine";
import type { Hand } from "./gestures";

function spacing(a: Point, b: Point, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

function palmCenter(points: Point[]): Point {
  return {
    x: (points[0].x + points[9].x) / 2,
    y: (points[0].y + points[9].y) / 2,
    z: 0,
  };
}

export class ClapToggle {
  private separatedAt?: number;
  private lastClap = -Infinity;

  reset() {
    this.separatedAt = undefined;
    this.lastClap = -Infinity;
  }

  update(hands: Hand[], time: number, aspect: number): boolean {
    if (
      hands.length !== 2 ||
      hands.some(({ points }) => classify(points) !== "palm")
    ) {
      this.separatedAt = undefined;
      return false;
    }
    const [{ points: left }, { points: right }] = hands;
    const scale =
      (spacing(left[0], left[9], aspect) +
        spacing(right[0], right[9], aspect)) /
      2;
    if (scale < 0.025) return false;
    const distance =
      spacing(palmCenter(left), palmCenter(right), aspect) / scale;
    if (distance >= 2.15) {
      this.separatedAt = time;
    } else if (distance <= 0.92) {
      const ready =
        this.separatedAt !== undefined &&
        time - this.separatedAt <= 520 &&
        time - this.lastClap >= 420;
      this.separatedAt = undefined;
      if (ready) {
        this.lastClap = time;
        return true;
      }
    }
    return false;
  }
}
