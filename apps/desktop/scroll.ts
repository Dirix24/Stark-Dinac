import { distance, palmSize, type Point } from "../../packages/gesture-engine";

export type ScrollDirection = "up" | "down" | "left" | "right";

function extended(hand: Point[], base: number, size: number) {
  const first = hand[base];
  const joint = hand[base + 1];
  const lastJoint = hand[base + 2];
  const tip = hand[base + 3];
  const reach = distance(first, tip);
  const length =
    distance(first, joint) +
    distance(joint, lastJoint) +
    distance(lastJoint, tip);
  return reach > size * 0.43 && reach >= length * 0.83;
}

function pointingDirection(
  base: Point,
  tip: Point,
  size: number,
): ScrollDirection | undefined {
  const x = base.x - tip.x;
  const y = tip.y - base.y;
  if (Math.abs(y) >= size * 0.35 && Math.abs(y) >= Math.abs(x) * 1.25) {
    return y < 0 ? "up" : "down";
  }
  if (Math.abs(x) >= size * 0.35 && Math.abs(x) >= Math.abs(y) * 1.25) {
    return x < 0 ? "left" : "right";
  }
}

export function scrollDirection(hand: Point[]): ScrollDirection | undefined {
  const size = palmSize(hand);
  if (
    size < 0.025 ||
    !extended(hand, 5, size) ||
    !extended(hand, 9, size) ||
    extended(hand, 13, size) ||
    extended(hand, 17, size) ||
    distance(hand[4], hand[8]) < size * 0.42 ||
    distance(hand[4], hand[12]) < size * 0.42
  ) {
    return;
  }

  const direction = pointingDirection(hand[5], hand[8], size);
  if (direction === pointingDirection(hand[9], hand[12], size))
    return direction;
}
