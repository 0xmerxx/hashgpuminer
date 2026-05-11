function shortHex(value) {
  const text = String(value);
  return text.length <= 18 ? text : `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function hashRate(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 H/s";
  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s"];
  let n = value;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${units[unit]}`;
}

function uint256Hex(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

module.exports = {
  hashRate,
  shortHex,
  uint256Hex
};
