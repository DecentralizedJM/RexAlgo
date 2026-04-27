import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    browse_and_session: {
      executor: "ramping-vus",
      stages: [
        { duration: "2m", target: 100 },
        { duration: "5m", target: 500 },
        { duration: "2m", target: 500 },
        { duration: "2m", target: 0 },
      ],
      exec: "browse",
    },
    webhook_abuse_smoke: {
      executor: "constant-arrival-rate",
      rate: 20,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: "unsignedWebhookProbe",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    "http_req_duration{type:read}": ["p(95)<750"],
    "http_req_duration{type:health}": ["p(95)<300"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3000";

export function browse() {
  const health = http.get(`${BASE_URL}/api/health`, { tags: { type: "health" } });
  check(health, { "health ok": (r) => r.status === 200 });

  const listings = http.get(`${BASE_URL}/api/strategies`, {
    tags: { type: "read" },
  });
  check(listings, { "strategies ok": (r) => r.status === 200 });

  sleep(Math.random() * 2);
}

export function unsignedWebhookProbe() {
  const res = http.post(
    `${BASE_URL}/api/webhooks/strategy/probe`,
    JSON.stringify({ idempotency_key: `probe-${__VU}-${__ITER}` }),
    { headers: { "Content-Type": "application/json" }, tags: { type: "abuse" } }
  );
  check(res, {
    "unsigned webhook rejected": (r) =>
      r.status === 401 || r.status === 403 || r.status === 404 || r.status === 429,
  });
}
