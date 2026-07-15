import assert from "node:assert/strict";
import { getLocal, getLocalSafe, setLocal, removeLocal } from "../modules/storageLocal.js";

const state = new Map();
let lastErrorMessage = "";
let hangNextGet = false;

globalThis.chrome = {
  runtime: {
    get lastError() {
      return lastErrorMessage ? { message: lastErrorMessage } : null;
    },
  },
  storage: {
    local: {
      get(keys, callback) {
        if (hangNextGet) {
          hangNextGet = false;
          return;
        }
        const list = Array.isArray(keys) ? keys : [keys];
        callback(Object.fromEntries(list.filter(Boolean).map((key) => [key, state.get(key)])));
      },
      set(values, callback) {
        Object.entries(values || {}).forEach(([key, value]) => state.set(key, value));
        callback?.();
      },
      remove(keys, callback) {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((key) => state.delete(key));
        callback?.();
      },
    },
  },
};

await setLocal({ savedResults: [{ id: 1 }], activeShopId: "shop-1" });
assert.deepEqual((await getLocal(["savedResults"])).savedResults, [{ id: 1 }], "registered get/set should work");
assert.equal((await getLocal("activeShopId")).activeShopId, "shop-1", "string key reads should work");

await removeLocal("activeShopId");
assert.equal((await getLocal("activeShopId")).activeShopId, undefined, "registered remove should work");

await assert.rejects(
  () => setLocal({ totallyUnknownKey: true }),
  /Unregistered chrome\.storage\.local set key/,
  "writes to unregistered keys should fail fast",
);
await assert.rejects(
  () => getLocal(["totallyUnknownKey"]),
  /Unregistered chrome\.storage\.local get key/,
  "reads from unregistered keys should fail fast",
);

lastErrorMessage = "quota exceeded";
await assert.rejects(
  () => getLocal(["savedResults"], { retries: 0 }),
  /quota exceeded/,
  "chrome.runtime.lastError should reject storage reads",
);
lastErrorMessage = "";

hangNextGet = true;
const fallback = await getLocalSafe(["savedResults"], { savedResults: [] }, { timeoutMs: 20, retries: 0 });
assert.deepEqual(fallback, { savedResults: [] }, "safe get should return fallback on timeout");

console.log("storage-local-smoke: ok");
