export interface Playback {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  pause(): void;
  play(): Promise<void>;
}
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export class VideoEngine {
  constructor(private video: Playback) {}

  toggle() {
    if (this.video.paused) return this.video.play();
    this.video.pause();
    return Promise.resolve();
  }

  seek(seconds: number) {
    if (Number.isFinite(this.video.duration)) {
      this.video.currentTime = clamp(
        this.video.currentTime + seconds,
        0,
        this.video.duration,
      );
    }
  }

  volume(delta: number) {
    this.video.volume = clamp(this.video.volume + delta, 0, 1);
  }

  mute() {
    this.video.muted = !this.video.muted;
  }
}
