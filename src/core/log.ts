import { INTERCEPT_LOG_PREFIX } from "./constants";

export function logUnhandled(kind: "warn" | "error", req: Request, url: URL) {
  const lines =
    kind === "warn"
      ? [
          `${INTERCEPT_LOG_PREFIX} 🚧 Unhandled request`,
          `   → ${req.method} ${url.toString()}`,
          "",
          "No intercept handler matched this request.",
          "Tip: add one with:",
          `   intercept.${req.method.toLowerCase()}('${url.pathname}').resolve(...)`,
        ]
      : [
          `${INTERCEPT_LOG_PREFIX} ❌ Unhandled request (error mode)`,
          `   → ${req.method} ${url.toString()}`,
          "",
          "No intercept handler matched this request.",
          "The request was blocked with a 501 response.",
          "Tip: add one with:",
          `   intercept.${req.method.toLowerCase()}('${url.pathname}').resolve(...)`,
        ];

  const message = lines.join("\n");

  if (kind === "warn") {
    console.warn(message);
  } else {
    // In "error" mode we only log. Adapters decide how to surface the failure
    // (e.g., return 501 Response in fetch adapter, or throw axios-like error).
    console.error(message);
  }
}
