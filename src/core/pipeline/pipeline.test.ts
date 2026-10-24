import { describe, expect, it } from "vitest";
import { encodeProject } from "../pattern";
import type { BeadColor } from "../pattern";
import { PipelineError } from "./errors";
import { generatePattern } from "./generate";
import type { GenerateInput } from "./generate";
import { createMessageGate, progressPercent } from "./protocol";
import { createWorkerRuntime } from "./worker-runtime";
import type { WorkerResponse } from "./protocol";

const PALETTE: BeadColor[] = [
  { code: "S01", name: "White", hex: "#EAEEF3", manufacturer: "Artkal", series: "S Midi 5mm" },
  { code: "S04", name: "Orange", hex: "#EB6027", manufacturer: "Artkal", series: "S Midi 5mm" },
  { code: "S05", name: "Tall Poppy", hex: "#CB3531", manufacturer: "Artkal", series: "S Midi 5mm" },
  { code: "S79", name: "Black", hex: "#1A1A1A", manufacturer: "Artkal", series: "S Midi 5mm" },
];

function fillGrid(
  width: number,
  height: number,
  painter: (x: number, y: number) => [number, number, number, number],
) {
  const rgb = new Uint8ClampedArray(width * height * 3);
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = painter(x, y);
      const index = y * width + x;
      rgb[index * 3] = r;
      rgb[index * 3 + 1] = g;
      rgb[index * 3 + 2] = b;
      alpha[index] = a;
    }
  }
  return { rgb, alpha };
}

function baseInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  const { rgb, alpha } = fillGrid(4, 2, (x, y) => {
    if (x === 0 && y === 0) return [234, 238, 243, 255];
    if (x === 3 && y === 1) return [26, 26, 26, 255];
    return [203, 53, 49, 255];
  });
  const input: GenerateInput = {
    rgb,
    alpha,
    width: 4,
    height: 2,
    palette: PALETTE,
    paletteId: "artkal-s-midi-5mm",
    paletteVersion: "test",
    maxColors: 4,
    mode: "photo",
    dithering: "none",
    colorMetric: "ciede2000",
    transparentPolicy: "empty",
    ditherStrength: 1,
    source: { originalWidth: 8, originalHeight: 4, aspectRatio: 2 },
    title: "fixture",
    id: "pattern-test",
    now: "2026-10-24T00:00:00.000Z",
  };
  return { ...input, ...overrides };
}

describe("generatePattern", () => {
  it("emits a valid BeadPattern whose cells are identical across two runs", () => {
    const first = generatePattern(baseInput());
    const second = generatePattern(baseInput());
    expect(Array.from(first.pattern.cells)).toEqual(Array.from(second.pattern.cells));
    expect(first.pattern.schemaVersion).toBe("1.0");
    expect(first.pattern.paletteId).toBe("artkal-s-midi-5mm");
    expect(first.pattern.paletteVersion).toBe("test");
    expect(first.pattern.settings.maxColors).toBe(4);
    expect(first.stats.beadCount).toBe(8);
    expect(first.diagnostic.nonEmptyCells).toBe(8);
  });

  it("keeps empty cells as -1 under empty transparency policy", () => {
    const { rgb, alpha } = fillGrid(2, 1, (x) => (x === 0 ? [203, 53, 49, 255] : [0, 0, 0, 0]));
    const result = generatePattern(baseInput({ rgb, alpha, width: 2, height: 1 }));
    expect(result.pattern.cells[1]).toBe(-1);
    expect(result.stats.beadCount).toBe(1);
  });

  it("reports real stage progress from cell counts, not a timer", () => {
    const progress: Array<{ stage: string; done: number; total: number }> = [];
    generatePattern(baseInput(), {
      onProgress: (item) => progress.push({ ...item }),
    });
    expect(
      progress.some((item) => item.stage === "sample" && item.done === 8 && item.total === 8),
    ).toBe(true);
    expect(
      progress.some((item) => item.stage === "match" && item.done === 8 && item.total === 8),
    ).toBe(true);
    expect(progress.every((item) => item.total > 0 && item.done <= item.total)).toBe(true);
  });

  it("throws E_CANCELLED at a checkpoint and does not return a pattern", () => {
    let ticks = 0;
    try {
      generatePattern(baseInput(), {
        onProgress: () => {
          ticks += 1;
        },
        shouldCancel: () => ticks >= 1,
      });
      throw new Error("expected cancel");
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineError);
      expect((error as PipelineError).code).toBe("E_CANCELLED");
    }
  });

  it("rejects anime + floyd-steinberg instead of silently disabling dither", () => {
    expect(() =>
      generatePattern(baseInput({ mode: "anime", dithering: "floyd-steinberg" })),
    ).toThrow(/forbids dithering/);
  });
});

describe("worker protocol via mock postMessage", () => {
  function run(requests: unknown[]): WorkerResponse[] {
    const inbox: WorkerResponse[] = [];
    const runtime = createWorkerRuntime((message) => {
      inbox.push(message);
    });
    for (const request of requests) {
      runtime.handle(request);
    }
    return inbox;
  }

  it("covers the done path", () => {
    const inbox = run([{ type: "generate", taskId: 1, payload: baseInput() }]);
    const done = inbox.find((item) => item.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.taskId).toBe(1);
      expect(done.pattern.cells.length).toBe(8);
    }
  });

  it("covers the error path", () => {
    const inbox = run([{ type: "generate", taskId: 2, payload: baseInput({ palette: [] }) }]);
    const error = inbox.find((item) => item.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type === "error") {
      expect(error.taskId).toBe(2);
      expect(error.code).toBe("E_INVALID_SETTINGS");
    }
  });

  it("covers the cancel path", () => {
    const inbox = run([
      { type: "cancel", taskId: 3 },
      { type: "generate", taskId: 3, payload: baseInput() },
    ]);
    const error = inbox.find((item) => item.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type === "error") {
      expect(error.code).toBe("E_CANCELLED");
    }
  });
});

describe("taskId race gate", () => {
  it("keeps state from B after A is cancelled and B is started", () => {
    const gate = createMessageGate();
    const taskA = gate.nextTaskId();
    const runtimeInbox: WorkerResponse[] = [];
    const runtime = createWorkerRuntime((message) => runtimeInbox.push(message));

    runtime.handle({ type: "cancel", taskId: taskA });
    runtime.handle({ type: "generate", taskId: taskA, payload: baseInput({ id: "A" }) });
    gate.nextTaskId();

    const taskB = gate.nextTaskId();
    expect(taskB).toBeGreaterThan(taskA);
    expect(gate.accept({ taskId: taskA, type: "done" })).toBeNull();

    runtime.handle({
      type: "generate",
      taskId: taskB,
      payload: baseInput({ id: "B", title: "from-B" }),
    });
    const doneB = runtimeInbox.find((item) => item.type === "done" && item.taskId === taskB);
    const landed = gate.accept(doneB ?? { taskId: -1 });
    expect(landed).not.toBeNull();
    if (doneB?.type === "done") {
      expect(doneB.pattern.id).toBe("B");
      expect(doneB.pattern.title).toBe("from-B");
    }
  });

  it("computes percent from done/total", () => {
    expect(progressPercent(3, 8)).toBe(37);
    expect(progressPercent(8, 8)).toBe(100);
    expect(progressPercent(0, 0)).toBe(0);
  });
});

describe("encode snapshot after generate", () => {
  it("round-trips cells through encodeProject", () => {
    const result = generatePattern(baseInput());
    const json = encodeProject(result.pattern);
    expect(json.cells).toEqual(Array.from(result.pattern.cells));
  });
});
