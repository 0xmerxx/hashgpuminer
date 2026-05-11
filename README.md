# Another Method https://github.com/mrfunntastiic/hash-miner

# HASH256 CLI Miner

CLI miner untuk HASH256 dari `https://hash256.org/mine`.

Miner ini mengambil challenge dari kontrak, mencari nonce untuk
`keccak256(abi.encodePacked(challenge, nonce)) < difficulty`, lalu submit
`mine(nonce)` ke Ethereum mainnet. Secara default miner akan mencoba GPU
OpenCL kalau binary tersedia, lalu fallback ke CPU worker threads.

## Peringatan

- Mining memakai Ethereum mainnet dan butuh ETH untuk gas.
- Jangan pakai private key wallet utama. Buat wallet khusus mining.
- Jangan commit file `.env`.
- Verifikasi kontrak sendiri:
  `https://etherscan.io/address/0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc`.

## Install Cepat

```bash
git clone https://github.com/mrfunntastiic/hash256-mine
cd hash256-mine
npm install
cp .env.example .env
nano .env
```

Isi minimal:

```env
RPC_URL=https://ethereum-rpc.publicnode.com
PRIVATE_KEY=0xPRIVATE_KEY_WALLET_KAMU
MINER_BACKEND=auto
PRIORITY_FEE_GWEI=2
```

Jalankan cek kontrak:

```bash
npm run check
```

Jalankan miner:

```bash
npm start
```

## Mode CPU

CPU mode tidak perlu driver GPU:

```bash
npm run start:cpu
```

Opsional:

```env
CPU_WORKERS=8
CPU_BATCH_SIZE=50000
```

## Mode GPU OpenCL

GPU mode memakai OpenCL native binary, bukan native npm addon. Ini sengaja
dibuat agar instalasi lebih stabil.

### Ubuntu / Debian

Install dependency umum:

```bash
sudo apt update
sudo apt install -y build-essential ocl-icd-opencl-dev clinfo
```

Install runtime GPU:

- NVIDIA: install driver NVIDIA terbaru.
- AMD: install ROCm/OpenCL runtime yang cocok untuk GPU kamu.
- Intel: install Intel OpenCL runtime.

Cek OpenCL:

```bash
clinfo | head
```

Build miner GPU:

```bash
sh scripts/build-opencl.sh
```

Run GPU:

```bash
npm run start:gpu
```

### Windows

Install salah satu:

- MSYS2/MinGW + OpenCL SDK, atau
- Visual Studio Build Tools + OpenCL SDK dari vendor GPU.

Build:

```powershell
npm run build:opencl
```

Run:

```powershell
npm run start:gpu
```

Kalau binary GPU belum ada, `MINER_BACKEND=auto` akan fallback ke CPU. Kalau
ingin wajib GPU, pakai:

```env
MINER_BACKEND=opencl
```

## Opsi

```bash
node miner.js --backend auto
node miner.js --backend cpu --workers 8
node miner.js --backend opencl --gpu-batch 67108864
node miner.js --once
```

Environment yang berguna:

```env
MINER_BACKEND=auto
CPU_WORKERS=8
CPU_BATCH_SIZE=50000
GPU_BATCH_SIZE=67108864
OPENCL_MINER_BIN=./bin/hash256-opencl
PRIORITY_FEE_GWEI=2
KEEP_MINING=true
```

## Error Umum

### `OpenCL miner belum ada`

Build binary GPU dulu:

```bash
sh scripts/build-opencl.sh
```

atau di Windows:

```powershell
npm run build:opencl
```

### `clGetDeviceIDs(GPU)`

Driver OpenCL GPU belum terpasang atau GPU tidak terdeteksi. Jalankan:

```bash
clinfo
```

### `insufficient funds`

Wallet tidak punya ETH untuk gas.

### `execution reverted` atau `InsufficientWork`

Epoch/challenge berubah sebelum transaksi masuk, block-cap sudah penuh, atau
nonce kalah cepat dari miner lain. Jalankan ulang dan naikkan
`PRIORITY_FEE_GWEI` kalau perlu.

### `GenesisNotComplete`

Mining belum dibuka oleh kontrak. Tunggu sampai genesis selesai.
