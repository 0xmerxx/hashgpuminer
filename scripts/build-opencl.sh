#!/usr/bin/env sh
set -eu

mkdir -p bin

echo "Building hash256-opencl (optimized)..."

# Detect NVIDIA CUDA include path for better compatibility
CUDA_INC=""
for p in /usr/local/cuda/include /usr/cuda/include /opt/cuda/include; do
  if [ -d "$p" ]; then
    CUDA_INC="-I$p"
    break
  fi
done

cc native/hash256_opencl.c \
  -O3 \
  -march=native \
  -funroll-loops \
  -ffast-math \
  $CUDA_INC \
  -o bin/hash256-opencl \
  -lOpenCL

echo "Built bin/hash256-opencl"
echo ""
echo "GPU count check:"
clinfo -l 2>/dev/null | grep -i device || echo "(install clinfo for GPU count: apt-get install clinfo)"
