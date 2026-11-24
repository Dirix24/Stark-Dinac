import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function openInput(workerPath) {
  const process = spawn("python3", ["-u", workerPath], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines = createInterface({ input: process.stdout });
  let pending;

  function fail() {
    pending?.reject(new Error("Se cerró la conexión X11."));
    pending = undefined;
  }

  process.on("error", fail);
  process.stdin.on("error", fail);
  process.on("exit", fail);
  lines.on("line", (line) => {
    pending?.resolve(line);
    pending = undefined;
  });

  async function response(write) {
    const line = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending = undefined;
        process.kill();
        reject(new Error("X11 no respondió."));
      }, 1000);
      pending = {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      write?.();
    });
    return line;
  }

  try {
    if ((await response()) !== "ready")
      throw new Error("XTest no está disponible.");
  } catch (error) {
    process.stdin.end();
    throw error;
  }

  return {
    async send(events) {
      if (process.exitCode !== null || process.stdin.destroyed)
        throw new Error("Se cerró la conexión X11.");
      const answer = await response(() =>
        process.stdin.write(JSON.stringify(events) + "\n"),
      );
      if (answer !== "ok") throw new Error("X11 no confirmó los eventos.");
    },
    close() {
      process.stdin.end();
    },
  };
}
