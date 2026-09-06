// Self-check for the shared extractor-call queue. Run: npm run extractor-queue:check
import { strict as assert } from "node:assert";
import { serialize } from "../src/lib/extractorQueue";

async function main() {
  // Sequential: call B must not start until call A's promise settles.
  const order: string[] = [];
  const a = serialize(async () => {
    order.push("a-start");
    await new Promise((r) => setTimeout(r, 20));
    order.push("a-end");
    return "a";
  });
  const b = serialize(async () => {
    order.push("b-start");
    return "b";
  });
  assert.deepEqual(await Promise.all([a, b]), ["a", "b"], "each call resolves its own value");
  assert.deepEqual(order, ["a-start", "a-end", "b-start"], "b must not start until a settles");

  // A rejection must not break the chain for calls queued after it.
  const rejected = serialize(() => Promise.reject(new Error("boom")));
  const after = serialize(async () => "after");
  await assert.rejects(rejected, /boom/, "the failing call's own promise still rejects");
  assert.equal(await after, "after", "a later call still runs after a rejection");
}

main().then(() => console.log("extractor-queue-check: all assertions passed"));
