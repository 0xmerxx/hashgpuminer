const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const binDir = path.join(root, "bin");
const src = path.join(root, "native", "hash256_opencl.c");
const exe = process.platform === "win32" ? "hash256-opencl.exe" : "hash256-opencl";
const out = path.join(binDir, exe);

fs.mkdirSync(binDir, { recursive: true });

const candidates = process.platform === "win32"
  ? [
      ["gcc", [src, "-O3", "-o", out, "-lOpenCL"]],
      ["cl", ["/O2", `/Fe:${out}`, src, "OpenCL.lib"]]
    ]
  : [
      ["cc", [src, "-O3", "-o", out, "-lOpenCL"]],
      ["gcc", [src, "-O3", "-o", out, "-lOpenCL"]]
    ];

let last;
for (const [cmd, args] of candidates) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" && cmd === "cl" });
  if (result.status === 0) {
    console.log(`Built ${out}`);
    process.exit(0);
  }
  last = result.error || new Error(`${cmd} exit ${result.status}`);
}

console.error("Gagal build OpenCL miner.");
console.error("Install compiler + OpenCL headers/runtime dulu.");
console.error("Ubuntu: sudo apt install -y build-essential ocl-icd-opencl-dev clinfo");
console.error("Windows: install MSYS2/MinGW atau Visual Studio Build Tools + OpenCL SDK.");
if (last) console.error(last.message);
process.exit(1);
