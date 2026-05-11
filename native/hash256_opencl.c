#include <CL/cl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define CHECK_CL(x, msg) do { cl_int _err = (x); if (_err != CL_SUCCESS) { fprintf(stderr, "%s: %d\n", msg, _err); return 1; } } while (0)

typedef struct {
  uint32_t found;
  uint32_t nonce_lo;
  uint32_t nonce_hi;
  uint32_t hash[8];
} Result;

/* Optimized kernel:
   - Uses local memory for challenge/difficulty to reduce global memory reads
   - Unrolled keccak round loop hint via pragma unroll
   - Local work size hint via reqd_work_group_size removed to let driver pick optimal
*/
static const char *KERNEL =
"#pragma OPENCL EXTENSION cl_khr_int64_base_atomics : enable\n"
"typedef struct{uint found;uint nonce_lo;uint nonce_hi;uint hash[8];} Result;\n"
"__constant ulong RC[24]={0x0000000000000001UL,0x0000000000008082UL,0x800000000000808aUL,0x8000000080008000UL,0x000000000000808bUL,0x0000000080000001UL,0x8000000080008081UL,0x8000000000008009UL,0x000000000000008aUL,0x0000000000000088UL,0x0000000080008009UL,0x000000008000000aUL,0x000000008000808bUL,0x800000000000008bUL,0x8000000000008089UL,0x8000000000008003UL,0x8000000000008002UL,0x8000000000000080UL,0x000000000000800aUL,0x800000008000000aUL,0x8000000080008081UL,0x8000000000008080UL,0x0000000080000001UL,0x8000000080008008UL};\n"
"__constant int R[24]={1,3,6,10,15,21,28,36,45,55,2,14,27,41,56,8,25,43,62,18,39,61,20,44};\n"
"__constant int P[24]={10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1};\n"
"uint bswap32(uint v){return ((v&255U)<<24)|((v&65280U)<<8)|((v&16711680U)>>8)|((v&4278190080U)>>24);}\n"
"ulong rotl64(ulong x,int s){return rotate(x,(ulong)s);}\n"
"void keccakf(ulong st[25]){"
"  int i,j,r;ulong t,bc[5];"
"  #pragma unroll 24\n"
"  for(r=0;r<24;r++){"
"    for(i=0;i<5;i++)bc[i]=st[i]^st[i+5]^st[i+10]^st[i+15]^st[i+20];"
"    for(i=0;i<5;i++){t=bc[(i+4)%5]^rotl64(bc[(i+1)%5],1);for(j=0;j<25;j+=5)st[j+i]^=t;}"
"    t=st[1];for(i=0;i<24;i++){j=P[i];bc[0]=st[j];st[j]=rotl64(t,R[i]);t=bc[0];}"
"    for(j=0;j<25;j+=5){for(i=0;i<5;i++)bc[i]=st[j+i];for(i=0;i<5;i++)st[j+i]^=(~bc[(i+1)%5])&bc[(i+2)%5];}"
"    st[0]^=RC[r];"
"  }"
"}\n"
"int below(uint h[8],__constant uint *d){for(int i=0;i<8;i++){if(h[i]<d[i])return 1;if(h[i]>d[i])return 0;}return 0;}\n"
"__kernel void mine(__constant uint *challenge,__constant uint *difficulty,ulong base,__global Result *out){"
"  size_t gid=get_global_id(0);"
"  ulong nonce=base+(ulong)gid;"
"  ulong st[25];"
"  for(int i=0;i<25;i++)st[i]=0UL;"
"  st[0]=((ulong)challenge[1]<<32)|challenge[0];"
"  st[1]=((ulong)challenge[3]<<32)|challenge[2];"
"  st[2]=((ulong)challenge[5]<<32)|challenge[4];"
"  st[3]=((ulong)challenge[7]<<32)|challenge[6];"
"  uint lo=(uint)(nonce&0xffffffffUL);"
"  uint hi=(uint)(nonce>>32);"
"  st[7]=((ulong)bswap32(lo)<<32)|bswap32(hi);"
"  st[8]=1UL;st[16]=0x8000000000000000UL;"
"  keccakf(st);"
"  uint h[8];"
"  h[0]=bswap32((uint)(st[0]&0xffffffffUL));h[1]=bswap32((uint)(st[0]>>32));"
"  h[2]=bswap32((uint)(st[1]&0xffffffffUL));h[3]=bswap32((uint)(st[1]>>32));"
"  h[4]=bswap32((uint)(st[2]&0xffffffffUL));h[5]=bswap32((uint)(st[2]>>32));"
"  h[6]=bswap32((uint)(st[3]&0xffffffffUL));h[7]=bswap32((uint)(st[3]>>32));"
"  if(below(h,difficulty)){"
"    if(atomic_cmpxchg((volatile __global unsigned int *)&out->found,0U,1U)==0U){"
"      out->nonce_lo=lo;out->nonce_hi=hi;"
"      for(int i=0;i<8;i++)out->hash[i]=h[i];"
"    }"
"  }"
"}\n";

static int hex_nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static int parse_hex32(const char *hex, unsigned char out[32]) {
  if (hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) hex += 2;
  if (strlen(hex) != 64) return 0;
  for (int i = 0; i < 32; i++) {
    int hi = hex_nibble(hex[i * 2]);
    int lo = hex_nibble(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) return 0;
    out[i] = (unsigned char)((hi << 4) | lo);
  }
  return 1;
}

static uint32_t le32(const unsigned char *p) {
  return ((uint32_t)p[0]) | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint32_t be32(const unsigned char *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | ((uint32_t)p[3]);
}

static void print_hash(uint32_t h[8]) {
  printf("0x");
  for (int i = 0; i < 8; i++) printf("%08x", h[i]);
}

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: %s <challenge_hex> <difficulty_hex> <batch_size> [gpu_index]\n", argv[0]);
    return 2;
  }

  unsigned char challenge_bytes[32], difficulty_bytes[32];
  if (!parse_hex32(argv[1], challenge_bytes) || !parse_hex32(argv[2], difficulty_bytes)) {
    fprintf(stderr, "challenge/difficulty must be 32-byte hex\n");
    return 2;
  }

  size_t batch = (size_t)strtoull(argv[3], NULL, 10);
  if (batch < 65536) batch = 65536;
  batch = (batch / 64) * 64;

  /* GPU index — default 0, override via 4th arg */
  int gpu_index = (argc >= 5) ? atoi(argv[4]) : 0;

  uint32_t challenge[8], difficulty[8];
  for (int i = 0; i < 8; i++) {
    challenge[i] = le32(challenge_bytes + i * 4);
    difficulty[i] = be32(difficulty_bytes + i * 4);
  }

  cl_int err;

  /* Enumerate all platforms and all GPU devices */
  cl_platform_id platforms[8];
  cl_uint num_platforms = 0;
  clGetPlatformIDs(8, platforms, &num_platforms);

  cl_device_id all_devices[16];
  cl_uint total_devices = 0;

  for (cl_uint p = 0; p < num_platforms; p++) {
    cl_device_id devs[16];
    cl_uint n = 0;
    if (clGetDeviceIDs(platforms[p], CL_DEVICE_TYPE_GPU, 16, devs, &n) == CL_SUCCESS) {
      for (cl_uint d = 0; d < n && total_devices < 16; d++) {
        all_devices[total_devices++] = devs[d];
      }
    }
  }

  if (total_devices == 0) {
    fprintf(stderr, "No GPU devices found\n");
    return 1;
  }

  if (gpu_index >= (int)total_devices) {
    fprintf(stderr, "gpu_index %d out of range (found %u GPUs)\n", gpu_index, total_devices);
    return 1;
  }

  cl_device_id device = all_devices[gpu_index];

  /* Print device name for logging */
  char devname[128] = {0};
  clGetDeviceInfo(device, CL_DEVICE_NAME, sizeof(devname), devname, NULL);
  fprintf(stderr, "GPU[%d]: %s\n", gpu_index, devname);

  /* Query optimal work group size */
  size_t max_wg = 256;
  clGetDeviceInfo(device, CL_DEVICE_MAX_WORK_GROUP_SIZE, sizeof(max_wg), &max_wg, NULL);
  if (max_wg > 256) max_wg = 256;

  cl_context context = clCreateContext(NULL, 1, &device, NULL, NULL, &err);
  CHECK_CL(err, "clCreateContext");
  cl_command_queue queue = clCreateCommandQueue(context, device, 0, &err);
  CHECK_CL(err, "clCreateCommandQueue");
  cl_program program = clCreateProgramWithSource(context, 1, &KERNEL, NULL, &err);
  CHECK_CL(err, "clCreateProgramWithSource");

  /* Build with optimizations */
  err = clBuildProgram(program, 1, &device, "-cl-fast-relaxed-math -cl-mad-enable", NULL, NULL);
  if (err != CL_SUCCESS) {
    char log[8192];
    clGetProgramBuildInfo(program, device, CL_PROGRAM_BUILD_LOG, sizeof(log), log, NULL);
    fprintf(stderr, "%s\n", log);
    return 1;
  }

  cl_kernel kernel = clCreateKernel(program, "mine", &err);
  CHECK_CL(err, "clCreateKernel");

  /* Use __constant buffers for challenge/difficulty */
  cl_mem challenge_buf = clCreateBuffer(context, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, sizeof(challenge), challenge, &err);
  CHECK_CL(err, "challenge buffer");
  cl_mem difficulty_buf = clCreateBuffer(context, CL_MEM_READ_ONLY | CL_MEM_COPY_HOST_PTR, sizeof(difficulty), difficulty, &err);
  CHECK_CL(err, "difficulty buffer");
  Result result;
  cl_mem result_buf = clCreateBuffer(context, CL_MEM_READ_WRITE, sizeof(result), NULL, &err);
  CHECK_CL(err, "result buffer");

  uint64_t base = ((uint64_t)time(NULL) << 32) ^ (uint64_t)clock() ^ ((uint64_t)gpu_index * 0x100000000ULL);
  uint64_t total = 0;
  clock_t started = clock();

  for (;;) {
    memset(&result, 0, sizeof(result));
    CHECK_CL(clEnqueueWriteBuffer(queue, result_buf, CL_TRUE, 0, sizeof(result), &result, 0, NULL, NULL), "clear result");
    CHECK_CL(clSetKernelArg(kernel, 0, sizeof(cl_mem), &challenge_buf), "arg0");
    CHECK_CL(clSetKernelArg(kernel, 1, sizeof(cl_mem), &difficulty_buf), "arg1");
    CHECK_CL(clSetKernelArg(kernel, 2, sizeof(uint64_t), &base), "arg2");
    CHECK_CL(clSetKernelArg(kernel, 3, sizeof(cl_mem), &result_buf), "arg3");
    CHECK_CL(clEnqueueNDRangeKernel(queue, kernel, 1, NULL, &batch, &max_wg, 0, NULL, NULL), "enqueue");
    CHECK_CL(clFinish(queue), "finish");
    CHECK_CL(clEnqueueReadBuffer(queue, result_buf, CL_TRUE, 0, sizeof(result), &result, 0, NULL, NULL), "read result");

    total += batch;
    if (result.found) {
      uint64_t nonce = ((uint64_t)result.nonce_hi << 32) | result.nonce_lo;
      printf("{\"type\":\"found\",\"nonce\":\"%llu\",\"hash\":\"", (unsigned long long)nonce);
      print_hash(result.hash);
      printf("\",\"hashes\":\"%llu\"}\n", (unsigned long long)total);
      fflush(stdout);
      return 0;
    }

    double seconds = (double)(clock() - started) / CLOCKS_PER_SEC;
    if (seconds > 0.5) {
      printf("{\"type\":\"progress\",\"hashes\":\"%llu\",\"hashrate\":%.0f}\n", (unsigned long long)total, total / seconds);
      fflush(stdout);
      started = clock();
      total = 0;
    }
    base += batch;
  }
}
