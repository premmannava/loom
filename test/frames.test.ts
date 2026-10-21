/**
 * The frame loop with animation on, driven by a fake requestAnimationFrame.
 * render() turns animation off, so these build the engine directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coreComponents } from "../src/components";
import { Loom } from "../src/engine";
import { FakeCanvas } from "../src/testing";

let queue: FrameRequestCallback[] = [];
const g = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
  queue = [];
  g.requestAnimationFrame = (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; };
  g.cancelAnimationFrame = () => {};
});
afterEach(() => {
  vi.useRealTimers();
  delete g.requestAnimationFrame;
  delete g.cancelAnimationFrame;
});

/** Run the frames requested so far, as the browser would on its next tick. */
function runFrames(): void {
  const now = queue;
  queue = [];
  for (const cb of now) cb(performance.now());
}

function setup(spec: string) {
  const canvas = new FakeCanvas();
  const loom = new Loom(canvas as unknown as HTMLCanvasElement, { components: coreComponents, width: 400, animate: true });
  loom.setSpec(spec);
  return { canvas, loom };
}

describe("frame loop", () => {
  it("finishes fading a new element in without anything else changing", () => {
    const { canvas } = setup(`button "Book"\n`);
    runFrames();
    const firstLabel = canvas.takeDrawOps().find((d) => d.op === "fillText");
    expect(firstLabel?.globalAlpha).toBeLessThan(0.2);
    // Nothing else happens: the fade alone must keep asking for frames until it's done.
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(16);
      runFrames();
    }
    const last = canvas.takeDrawOps().filter((d) => d.op === "fillText").at(-1);
    expect(last?.globalAlpha).toBe(1);
  });

  it("stops asking for frames once nothing is animating", () => {
    setup(`text "Still"\n`);
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(16);
      runFrames();
    }
    expect(queue).toHaveLength(0);
  });
});
