import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * A team-saved provider base URL must point at a public HTTPS host. Checked
 * when it is saved (API) and again right before it is used (API and worker),
 * since DNS can change after the save (rebinding) and point provider calls,
 * with the team's key, at a private address.
 */

const NON_PUBLIC_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x00000000, 0x00ffffff],
    [0x0a000000, 0x0affffff],
    [0x64400000, 0x647fffff],
    [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff],
    [0xac100000, 0xac1fffff],
    [0xc0000000, 0xc00000ff],
    [0xc0000200, 0xc00002ff],
    [0xc0586300, 0xc05863ff],
    [0xc0a80000, 0xc0a8ffff],
    [0xc6120000, 0xc613ffff],
    [0xc6336400, 0xc63364ff],
    [0xcb007100, 0xcb0071ff],
    [0xe0000000, 0xffffffff],
];

export type ProviderHostResolver = (
    hostname: string,
) => Promise<readonly string[]>;

/**
 * Why a base URL is refused: "invalid" (malformed or not public) or
 * "lookup" (its hostname could not be resolved, which may pass).
 */
export class ProviderBaseUrlError extends Error {
    constructor(
        message: string,
        readonly kind: "invalid" | "lookup",
    ) {
        super(message);
        this.name = "ProviderBaseUrlError";
    }
}

/**
 * The trimmed base URL, or null when empty. Throws ProviderBaseUrlError
 * unless it is an HTTPS URL without credentials or a fragment whose host is
 * public and resolves only to public addresses.
 */
export async function checkPublicProviderBaseUrl(
    baseUrl: string | undefined,
    resolveHost: ProviderHostResolver,
): Promise<string | null> {
    const normalized = baseUrl?.trim();
    if (!normalized) return null;

    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new ProviderBaseUrlError(
            "baseUrl must be a valid absolute HTTPS URL",
            "invalid",
        );
    }
    if (
        parsed.protocol !== "https:" ||
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.hash !== "" ||
        isPrivateHost(parsed.hostname)
    ) {
        throw new ProviderBaseUrlError(
            "baseUrl must be a public HTTPS URL without credentials or a fragment",
            "invalid",
        );
    }
    if (isIP(unbracketedHostname(parsed.hostname)) === 0) {
        let addresses: readonly string[];
        try {
            addresses = await resolveHost(parsed.hostname);
        } catch {
            throw new ProviderBaseUrlError(
                "baseUrl hostname could not be resolved",
                "lookup",
            );
        }
        if (addresses.length === 0 || addresses.some(isPrivateHost)) {
            throw new ProviderBaseUrlError(
                "baseUrl hostname must resolve only to public addresses",
                "invalid",
            );
        }
    }
    return normalized;
}

function isPrivateHost(rawHostname: string): boolean {
    const hostname = unbracketedHostname(rawHostname);
    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local")
    )
        return true;

    const ipVersion = isIP(hostname);
    if (ipVersion === 4) return isNonPublicIpv4(hostname);
    if (ipVersion === 6) return isNonPublicIpv6(hostname);
    return false;
}

function isNonPublicIpv4(hostname: string): boolean {
    const address = hostname
        .split(".")
        .reduce((value, octet) => value * 256 + Number(octet), 0);
    return NON_PUBLIC_IPV4_RANGES.some(
        ([start, end]) => address >= start && address <= end,
    );
}

function isNonPublicIpv6(hostname: string): boolean {
    const mappedIpv4 = ipv4FromMappedIpv6(hostname);
    if (mappedIpv4) return isNonPublicIpv4(mappedIpv4);
    return (
        hostname === "::" ||
        hostname === "::1" ||
        /^f[cd]/.test(hostname) ||
        /^(?:fe[89ab])/.test(hostname) ||
        /^ff/.test(hostname) ||
        /^2001:db8(?::|$)/.test(hostname)
    );
}

function unbracketedHostname(hostname: string): string {
    return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function ipv4FromMappedIpv6(hostname: string): string | undefined {
    const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(hostname);
    if (!match) return undefined;
    const high = Number.parseInt(match[1]!, 16);
    const low = Number.parseInt(match[2]!, 16);
    return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".");
}

export async function resolveHostAddresses(
    hostname: string,
): Promise<string[]> {
    return (await lookup(hostname, { all: true, verbatim: true })).map(
        ({ address }) => address,
    );
}
