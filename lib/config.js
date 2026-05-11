const CONTRACT_ADDRESS = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";

const ABI = [
  "function getChallenge(address miner) view returns (bytes32)",
  "function miningState() view returns (uint256 era,uint256 reward,uint256 difficulty,uint256 minted,uint256 remaining,uint256 epoch,uint256 epochBlocksLeft_)",
  "function mine(uint256 nonce)"
];

function readOptions(argv = process.argv.slice(2), env = process.env) {
  const options = {
    backend: env.MINER_BACKEND || "auto",
    workers: Number(env.CPU_WORKERS || Math.max(1, (require("os").cpus().length || 2) - 1)),
    batchSize: BigInt(env.CPU_BATCH_SIZE || "50000"),
    // Default GPU batch size increased for better throughput
    gpuBatchSize: BigInt(env.GPU_BATCH_SIZE || "268435456"),
    gpuBinary: env.OPENCL_MINER_BIN || "",
    priorityFeeGwei: env.PRIORITY_FEE_GWEI || "2",
    keepMining: env.KEEP_MINING !== "false"
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--backend" && next) { options.backend = next; i++; }
    else if (arg === "--workers" && next) { options.workers = Number(next); i++; }
    else if (arg === "--cpu-batch" && next) { options.batchSize = BigInt(next); i++; }
    else if (arg === "--gpu-batch" && next) { options.gpuBatchSize = BigInt(next); i++; }
    else if (arg === "--gpu-bin" && next) { options.gpuBinary = next; i++; }
    else if (arg === "--once") { options.keepMining = false; }
  }

  if (!["auto", "cpu", "opencl"].includes(options.backend)) {
    throw new Error("backend harus salah satu: auto, cpu, opencl");
  }

  options.workers = Number.isFinite(options.workers)
    ? Math.max(1, Math.min(64, Math.floor(options.workers)))
    : 1;

  return options;
}

module.exports = { ABI, CONTRACT_ADDRESS, readOptions };
