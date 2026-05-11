require("dotenv").config();

const { ethers } = require("ethers");
const { CpuMiner } = require("./lib/cpu-miner");
const { OpenClMiner } = require("./lib/opencl-miner");
const { ABI, CONTRACT_ADDRESS, readOptions } = require("./lib/config");
const { hashRate, shortHex } = require("./lib/format");

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

function requireEnv() {
  if (!RPC_URL || !PRIVATE_KEY) {
    console.error("Isi RPC_URL dan PRIVATE_KEY di file .env dulu.");
    console.error("Contoh: cp .env.example .env lalu edit PRIVATE_KEY.");
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

  console.log("Wallet:", wallet.address);
  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("Backend:", options.backend);

  while (true) {
    const state = await contract.miningState();
    const difficulty = BigInt(state.difficulty.toString());
    const challenge = await contract.getChallenge(wallet.address);

    console.log("");
    console.log("Era:", state.era.toString());
    console.log("Reward:", ethers.formatUnits(state.reward, 18), "HASH");
    console.log("Difficulty:", difficulty.toString());
    console.log("Epoch:", state.epoch.toString());
    console.log("Challenge:", challenge);

    const solution = await findSolution({ challenge, difficulty, options });

    console.log("");
    console.log("FOUND via", solution.backend);
    console.log("Nonce:", solution.nonce);
    console.log("Hash:", solution.hash);

    await submitSolution({ contract, nonce: BigInt(solution.nonce), options });

    if (!options.keepMining) break;
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
        console.log("OpenCL:", gpu.binary);
        return await gpu.search({ challenge, difficulty });
      } catch (err) {
        if (options.backend === "opencl") throw err;
        console.error("OpenCL gagal, fallback ke CPU:", err.message);
      }
    } else if (options.backend === "opencl") {
      throw new Error(`OpenCL miner belum ada. Jalankan npm run build:opencl atau set OPENCL_MINER_BIN.`);
    }
  }

  const cpu = new CpuMiner({
    workers: options.workers,
    batchSize: options.batchSize,
    onProgress
  });

  console.log(`CPU workers: ${options.workers}`);
  return cpu.search({ challenge, difficulty });
}

async function submitSolution({ contract, nonce, options }) {
  try {
    const gas = await estimateGas(contract, nonce);
    const fee = await feeOptions(contract.runner.provider, options.priorityFeeGwei);
    const tx = await contract.mine(nonce, { gasLimit: gas, ...fee });
    console.log("TX sent:", tx.hash);

    const receipt = await tx.wait();
    console.log("Success block:", receipt.blockNumber);
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
  } catch {
    // Legacy fallback below.
  }

  return {
    maxPriorityFeePerGas: priority,
    maxFeePerGas: ethers.parseUnits("10", "gwei") + priority
  };
}

function progressPrinter() {
  let last = 0;
  return ({ backend, hashes, hashrate }) => {
    const now = Date.now();
    if (now - last < 2000) return;
    last = now;
    process.stdout.write(`\r${backend} ${hashRate(hashrate)} | ${shortHex(hashes.toString())} hashes`);
  };
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
