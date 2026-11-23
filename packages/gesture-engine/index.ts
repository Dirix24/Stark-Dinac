export interface Point {
  x: number;
  y: number;
  z: number;
}

export type Pose = "pinch" | "fist" | "palm" | "neutral";
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function palmSize(points: Point[]): number {
  return points.length === 21 ? distance(points[0], points[9]) : 0;
}

export function classify(points: Point[], sensitivity = 0.38): Pose {
  const size = palmSize(points);
  if (size < 0.025) return "neutral";
  const extended = [8, 12, 16, 20].filter(
    (tip) =>
      distance(points[tip], points[0]) >
      1.17 * distance(points[tip - 2], points[0]),
  ).length;
  if (extended === 0 && distance(points[4], points[5]) < size * 0.65)
    return "fist";
  if (distance(points[4], points[8]) < size * sensitivity) return "pinch";
  return extended === 4 ? "palm" : "neutral";
}

export class GestureGate {
  private candidate: Pose = "neutral";
  private since = 0;
  private active = false;
  private armed = false;

  reset() {
    this.candidate = "neutral";
    this.active = this.armed = false;
  }

  update(
    pose: Pose,
    time: number,
    hold: number,
  ): "start" | "hold" | "end" | "cancel" | undefined {
    if (pose !== this.candidate) {
      const wasActive = this.active;
      this.candidate = pose;
      this.since = time;
      this.active = false;
      if (wasActive) return pose === "neutral" ? "end" : "cancel";
    }
    if (pose === "neutral") {
      if (time - this.since >= 120) this.armed = true;
      return;
    }
    if (this.active) return "hold";
    if (this.armed && time - this.since >= hold) {
      this.active = true;
      this.armed = false;
      return "start";
    }
  }
}
