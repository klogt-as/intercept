import { INTERCEPT_LOG_PREFIX } from "./constants";

export function logUnhandled(kind: "warn" | "error", req: Request, url: URL) {
  const lines =
    kind === "warn"
      ? [
          `🚧 ${INTERCEPT_LOG_PREFIX} Unhandled request`,
          `   → ${req.method} ${url.pathname}${url.search}`,
          "",
          "No intercept handler matched this request.",
          "Tip: add one with:",
          `   intercept.${req.method.toLowerCase()}('${
            url.pathname
          }').resolve(...)`,
        ]
      : [
          `❌ ${INTERCEPT_LOG_PREFIX} Unhandled request (error mode)`,
          `   → ${req.method} ${url.pathname}${url.search}`,
          "",
          "No intercept handler matched this request.",
          "The request was blocked with a 501 response.",
          "Tip: add one with:",
          `   intercept.${req.method.toLowerCase()}('${
            url.pathname
          }').resolve(...)`,
        ];
  (kind === "warn" ? console.warn : console.error)(lines.join("\n"));
}
