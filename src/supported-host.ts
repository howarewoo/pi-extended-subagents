import { VERSION } from "@earendil-works/pi-coding-agent";

const MINIMUM_PI_VERSION = "1.5.2";
const minimum = MINIMUM_PI_VERSION.split(".").map(BigInt);

/** Gate execution, not registration: root diagnostics and cleanup must remain usable. */
export function requireSupportedHost(): void {
  // Only stable SemVer, with optional build metadata (which has no precedence).
  const stable =
    typeof VERSION === "string"
      ? /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
          VERSION,
        )
      : null;
  if (stable && stable[0] === VERSION) {
    // BigInt keeps numeric comparison exact without a version-component size limit.
    const difference = stable
      .slice(1, 4)
      .map((part, index) => BigInt(part) - minimum[index]!)
      .find((part) => part !== 0n);
    if (difference === undefined || difference > 0n) return;
  }
  throw new Error(
    `Delegated execution requires supported stable Pi >=${MINIMUM_PI_VERSION}; detected ${VERSION || "unknown"}. Install stable Pi ${MINIMUM_PI_VERSION} or newer and restart Pi after draining active tasks.`,
  );
}
