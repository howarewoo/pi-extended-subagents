import { VERSION } from "@earendil-works/pi-coding-agent";

const SUPPORTED_PI_VERSION = "1.5.2";

/** Gate execution, not registration: root diagnostics and cleanup must remain usable. */
export function requireSupportedHost(): void {
  if (VERSION !== SUPPORTED_PI_VERSION)
    throw new Error(
      `Delegated execution requires supported Pi ${SUPPORTED_PI_VERSION}; detected ${VERSION || "unknown"}. Install Pi ${SUPPORTED_PI_VERSION} and restart Pi after draining active tasks.`,
    );
}
