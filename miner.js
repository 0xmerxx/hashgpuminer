require("dotenv").config();

const { ethers } = require("ethers");
const { CpuMiner } = require("./lib/cpu-miner");
const { OpenClMiner } = require("./lib/opencl-miner");
const { ABI, CONTRACT_ADDRESS, readOptions } = require("./lib/config");
const { hashRate, shortHex } = require("./lib/format");

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

let totalMints = 0;
let sessionStart = Date.now();
let peakHashrate = 0;

function requireEnv() {
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Isi RPC_URL dan PRIVATE_KEY di file .env dulu.");
    process.exit(1);
  }
  if (!PRIVATE_KEY.startsWith("0x")) {
    console.error("PRIVATE_KEY harus diawali 0x.");
    process.exit(1);
  }
}

async function main() {
  requireEnv();
  const options = readOptions();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  console.log("==========================================");
  console.log("  HASH256 GPU Miner - Multi-GPU Optimized");
  console.log("==========================================");
  console.log("Wallet  :", wallet.address);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("Backend :", options.backend);
  console.log("GPU Batch:", options.gpuBatchSize.toString());
  console.log("==========================================\n");

  let retryDelay = 3000;

  while (true) {
    try {
      const state = await contract.miningState();
      const difficulty = BigInt(state.difficulty.toString());
      const challenge = await contract.getChallenge(wallet.address);

      console.log("\n[" + new Date().toISOString() + "]");
      console.log("Era      :", state.era.toString());
      console.log("Reward   :", ethers.formatUnits(state.reward, 18), "HASH");
      console.log("Difficulty:", difficulty.toString());
      console.log("Epoch    :", state.epoch.toString());
      console.log("Challenge:", challenge);
      console.log("Mints    :", totalMints, "| Peak:", hashRate(peakHashrate));

      const solution = await findSolution({ challenge, difficulty, options });

      totalMints++;
      console.log("\n FOUND via " + solution.backend);
      console.log("Nonce  :", solution.nonce);
      console.log("Hash   :", solution.hash);

      await submitSolution({ contract, nonce: BigInt(solution.nonce), options });

      retryDelay = 3000;
      if (!options.keepMining) break;

    } catch (err) {
      console.error("\n[ERROR] " + (err.shortMessage || err.message));
      console.error("Retry dalam " + (retryDelay / 1000) + "s...");
      await sleep(retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
    }
  }
}

async function findSolution({ challenge, difficulty, options }) {
  const onProgress = progressPrinter();

  if (options.backend === "opencl" || options.backend === "auto") {
    const gpu = new OpenClMiner({
      binary: options.gpuBinary,
      batchSize: options.gpuBatchSize,
      onProgress
    });

    if (gpu.available()) {
      try {
        return await gpu.search({ challenge, difficulty });
      } catch (err) {
        if (options.backend === "opencl") throw err;
        console.error("\nOpenCL gagal, fallback ke CPU:", err.message);
      }
    } else if (options.backend === "opencl") {
      throw new Error("OpenCL miner belum ada. Jalankan: bash scripts/build-opencl.sh");
    }
  }

  const cpu = new CpuMiner({
    workers: options.workers,
    batchSize: options.batchSize,
    onProgress
  });

  console.log("CPU workers: " + options.workers);
  return cpu.search({ challenge, difficulty });
}

async function submitSolution({ contract, nonce, options }) {
  try {
    const gas = await estimateGas(contract, nonce);
    const fee = await feeOptions(contract.runner.provider, options.priorityFeeGwei);
    const tx = await contract.mine(nonce, { gasLimit: gas, ...fee });
    console.log("TX sent  :", tx.hash);
    const receipt = await tx.wait();
    console.log(" Block  :", receipt.blockNumber);
  } catch (err) {
    console.error("TX failed:", err.shortMessage || err.message);
  }
}

async function estimateGas(contract, nonce) {
  try {
    const estimate = await contract.mine.estimateGas(nonce);
    const padded = (estimate * 3n) / 2n;
    if (padded < 200000n) return 200000n;
    if (padded > 450000n) return 450000n;
    return padded;
  } catch {
    return 300000n;
  }
}

async function feeOptions(provider, priorityFeeGwei) {
  const priority = ethers.parseUnits(priorityFeeGwei, "gwei");
  try {
    const block = await provider.getBlock("latest");
    if (block?.baseFeePerGas) {
      return {
        maxPriorityFeePerGas: priority,
        maxFeePerGas: block.baseFeePerGas * 3n + priority
      };
    }
  } catch {}
  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas: ethers.parseUnits("10", "gwei") + priority
  };
}

function progressPrinter() {
  let last = 0;
  return ({ backend, hashes, hashrate }) => {
    if (hashrate > peakHashrate) peakHashrate = hashrate;
    const now = Date.now();
    if (now - last < 2000) return;
    last = now;
    const uptime = Math.floor((now - sessionStart) / 1000);
    const uptimeStr = uptime < 60 ? uptime + "s" : uptime < 3600 ? Math.floor(uptime/60) + "m" : Math.floor(uptime/3600) + "h";
    process.stdout.write("\r" + backend + " " + hashRate(hashrate) + " | " + shortHex(hashes.toString()) + " hashes | uptime " + uptimeStr + " | mints " + totalMints + "  ");
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
