import { HyperCore } from "../dist/index.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

let calls = 0;
let closes = 0;
let settled = 0;
const transport = {
  protocols: ["rest"],
  async execute(request) {
    calls++;
    if (request.url.endsWith("/fail")) throw new Error("mock failure");
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode('{"ok":true}'),
    };
  },
  async close() { closes++; },
};
const core = new HyperCore({
  customTransport: transport,
  plugins: [{
    name: "settlement-smoke",
    onRequest(_request, _plugin, context) {
      context.onSettled(() => { settled++; });
    },
    onError() {
      return { protocol: "rest", ok: true, status: 200, headers: {}, data: { recovered: true } };
    },
  }],
});
const response = await core.rest.get("https://example.test/ok");
check(response.data.ok === true, "JSON parsing failed");
const recovered = await core.rest.get("https://example.test/fail");
check(recovered.data.recovered === true, "Recovery failed");
check(calls === 2 && settled === 2, "Settlement must run once per call");
await Promise.all([core.destroy(), core.destroy()]);
check(closes === 1, "Transport must close once");
let rejected = false;
try { await core.rest.get("https://example.test/after-destroy"); } catch { rejected = true; }
check(rejected && calls === 2, "Shutdown admission failed");
console.log("Core built-package smoke: parsing, recovery, settlement and shutdown OK");
