import { INTERCEPT_LOG_PREFIX } from "./constants";
import type { HttpMethod, Path } from "./types";

/**
 * Information about a registered handler for error messages.
 */
export type RegisteredHandlerInfo = {
  method: HttpMethod;
  path: Path;
};

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Find the closest matching handler based on method and path.
 */
function findClosestMatch(
  requestMethod: string,
  requestPath: string,
  handlers: RegisteredHandlerInfo[],
): string | null {
  if (handlers.length === 0) return null;

  let bestMatch: RegisteredHandlerInfo | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const handler of handlers) {
    // Prefer same method
    const methodMatch = handler.method === requestMethod ? 0 : 1;
    const pathDistance = levenshteinDistance(
      requestPath.toLowerCase(),
      String(handler.path).toLowerCase(),
    );
    const score = methodMatch * 100 + pathDistance;

    if (score < bestScore) {
      bestScore = score;
      bestMatch = handler;
    }
  }

  // Only suggest if reasonably close (e.g., within 5 edits or same method)
  if (bestMatch && (bestScore < 105 || bestMatch.method === requestMethod)) {
    return `${bestMatch.method} ${bestMatch.path}`;
  }

  return null;
}

export function logUnhandled(
  kind: "warn" | "error",
  req: Request,
  url: URL,
  registeredHandlers: RegisteredHandlerInfo[] = [],
) {
  const baseLines =
    kind === "warn"
      ? [
          `${INTERCEPT_LOG_PREFIX} 🚧 Unhandled request`,
          `   → ${req.method} ${url.toString()}`,
          "",
          "No intercept handler matched this request.",
        ]
      : [
          `${INTERCEPT_LOG_PREFIX} ❌ Unhandled request (error mode)`,
          `   → ${req.method} ${url.toString()}`,
          "",
          "No intercept handler matched this request.",
          "The request was blocked with a 501 response.",
        ];

  // Add registered handlers section if any exist
  if (registeredHandlers.length > 0) {
    baseLines.push("", "Registered handlers:");
    for (const handler of registeredHandlers) {
      baseLines.push(`  ${handler.method} ${handler.path}`);
    }

    // Try to suggest a close match
    const suggestion = findClosestMatch(
      req.method,
      url.pathname,
      registeredHandlers,
    );
    if (suggestion) {
      baseLines.push("", `Did you mean: ${suggestion}?`);
    }
  } else {
    baseLines.push(
      "",
      "Tip: add one with:",
      `   intercept.${req.method.toLowerCase()}('${url.pathname}').resolve(...)`,
    );
  }

  const message = baseLines.join("\n");

  if (kind === "warn") {
    console.warn(message);
  } else {
    // In "error" mode we only log. Adapters decide how to surface the failure
    // (e.g., return 501 Response in fetch adapter, or throw axios-like error).
    console.error(message);
  }
}
