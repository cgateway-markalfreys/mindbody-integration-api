import { sign } from "../src/utils/signing";

const [, , productId, qtyArg] = process.argv;

if (!productId) {
  console.error("Usage: ts-node scripts/link-builder.ts <productId> [qty]");
  process.exit(1);
}

const qty = Number(qtyArg ?? 1);
const sig = sign({ productId, qty });
const url = `/store/buy?productId=${encodeURIComponent(productId)}&qty=${qty}&sig=${sig}`;

console.log(url);
