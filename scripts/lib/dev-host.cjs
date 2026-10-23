// Development may listen on loopback or a private Tailscale (100.64.0.0/10)
// IPv4 address, never on a public interface. Shared by setup and the launcher.
const { isIP } = require("node:net");

function isPrivateDevHost(host) {
    const octets = host.split(".").map(Number);
    return (
        isIP(host) === 4 &&
        (host === "127.0.0.1" ||
            (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127))
    );
}

exports.isPrivateDevHost = isPrivateDevHost;
