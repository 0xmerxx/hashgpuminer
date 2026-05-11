const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

class OpenClMiner {
  constructor({ binary, batchSize, onProgress }) {
    this.binary = binary || defaultBinary();
    this.batchSize = batchSize;
    this.onProgress = onProgress;
    this.children = [];
  }

  available() {
    return fs.existsSync(this.binary);
  }

  /** Detect how many GPUs are available via clinfo */
  detectGpuCount() {
    try {
      const out = execSync("clinfo -l 2>/dev/null || clinfo 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      // Count lines containing "Device" under GPU platforms
      const matches = out.match(/Device\s+#?\d+/gi);
      const count = matches ? matches.length : 1;
      return Math.max(1, count);
    } catch {
      return 1;
    }
  }

  search({ challenge, difficulty }) {
    if (!this.available()) {
      throw new Error(`OpenCL miner belum dibuild: ${this.binary}`);
    }

    const gpuCount = this.detectGpuCount();
    console.log(`\nDetected ${gpuCount} GPU(s) — spawning ${gpuCount} miner process(es)`);

    return new Promise((resolve, reject) => {
      let solved = false;
      let totalHashrate = 0;
      const hashrates = new Array(gpuCount).fill(0);

      for (let gpuIdx = 0; gpuIdx < gpuCount; gpuIdx++) {
        const args = [
          challenge,
          difficultyHex(difficulty),
          this.batchSize.toString(),
          gpuIdx.toString()
        ];

        const child = spawn(this.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
        this.children.push(child);

        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
          // Print GPU name line immediately
          const lines = chunk.toString().split(/\r?\n/);
          for (const l of lines) {
            if (l.startsWith("GPU[")) process.stderr.write(l + "\n");
          }
        });

        child.stdout.on("data", (chunk) => {
          if (solved) return;
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (!line.trim()) continue;
            let message;
            try { message = JSON.parse(line); } catch { continue; }

            if (message.type === "progress" && this.onProgress) {
              hashrates[gpuIdx] = Number(message.hashrate);
              totalHashrate = hashrates.reduce((a, b) => a + b, 0);
              this.onProgress({
                backend: `opencl[${gpuCount}x GPU]`,
                hashes: BigInt(message.hashes),
                hashrate: totalHashrate
              });
            } else if (message.type === "found" && !solved) {
              solved = true;
              this.stop();
              resolve({
                backend: `opencl[GPU${gpuIdx}]`,
                nonce: message.nonce,
                hash: message.hash,
                hashes: message.hashes
              });
            }
          }
        });

        child.on("error", (err) => { if (!solved) reject(err); });
        child.on("close", (code) => {
          if (!solved && code !== 0) {
            // Only reject if all children are dead
            const aliveCount = this.children.filter(c => !c.killed && c.exitCode === null).length;
            if (aliveCount === 0) {
              reject(new Error(stderr.trim() || `OpenCL miner exit ${code}`));
            }
          }
        });
      }
    });
  }

  stop() {
    for (const child of this.children) {
      try { child.kill(); } catch {}
    }
    this.children = [];
  }
}

function defaultBinary() {
  const exe = process.platform === "win32" ? "hash256-opencl.exe" : "hash256-opencl";
  return path.join(__dirname, "..", "bin", exe);
}

function difficultyHex(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

module.exports = { OpenClMiner };
