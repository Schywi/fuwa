// k6 load test — Fuwa observability pipeline stress
// Usage: k6 run --env SCENARIO=ramp infra/k6/fuwa-stress.js

import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://openresty:8080";
const SCENARIO = __ENV.SCENARIO || "ramp";

export const requestsSent = new Counter("fuwa_requests_sent");

export const options = {
  scenarios: {
    ramp: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "1m",  target: 50 },
        { duration: "30s", target: 100 },
        { duration: "1m",  target: 100 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
      exec: "hitFuwa",
      startTime: "0s",
    },
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 5 },
        { duration: "5s",  target: 200 },
        { duration: "5s",  target: 200 },
        { duration: "10s", target: 5 },
        { duration: "5s",  target: 200 },
        { duration: "5s",  target: 200 },
        { duration: "10s", target: 0 },
      ],
      gracefulRampDown: "5s",
      exec: "hitFuwa",
      startTime: "0s",
    },
    soak: {
      executor: "constant-vus",
      vus: 30,
      duration: "10m",
      exec: "hitFuwa",
      startTime: "0s",
    },
    edges: {
      executor: "per-vu-iterations",
      vus: 20,
      iterations: 50,
      maxDuration: "2m",
      exec: "hitEdges",
      startTime: "0s",
    },
  },
  thresholds: {
    "http_req_duration{name:fuwa}": ["p(95) < 500"],
    "http_req_failed{name:fuwa}": ["rate < 0.05"],
  },
};

if (SCENARIO !== "all") {
  options.scenarios = { [SCENARIO]: options.scenarios[SCENARIO] };
}

// ── Normal traffic: GET / with loadtest tag ─────────────────────────
export function hitFuwa() {
  const path = "/?_src=k6_" + SCENARIO;
  const res = http.get(BASE_URL + path, { tags: { name: "fuwa" } });
  requestsSent.add(1);

  if (res.status !== 200) {
    console.warn(`non-200: ${res.status} ${path}`);
  }
}

// ── Edge cases: errors, large bodies, slow paths ────────────────────
export function hitEdges() {
  const routes = [
    { method: "GET",  path: "/",                        expect: 200 },
    { method: "GET",  path: "/nonexistent-page",         expect: 404 },
    { method: "POST", path: "/",      body: "x".repeat(50000), expect: 200 },
    { method: "GET",  path: "/switch/fuwa-gomen",       expect: 200 },
    { method: "GET",  path: "/p/nonexistent-preview",   expect: 404 },
  ];

  const r = routes[Math.floor(Math.random() * routes.length)];
  const fullPath = r.path + "?_src=k6_edges";

  const res = http.request(r.method, BASE_URL + fullPath,
    r.body || null,
    { tags: { name: "fuwa" } }
  );
  requestsSent.add(1);

  if (res.status !== r.expect) {
    console.warn(`edge: ${r.method} ${fullPath} → ${res.status} (expected ${r.expect})`);
  }
}
