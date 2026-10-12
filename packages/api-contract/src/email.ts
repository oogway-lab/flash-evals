const EMAIL_LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const EMAIL_DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeEmailAddress(email: string): string {
    return email.trim().toLowerCase();
}

export function isValidEmailAddress(email: string): boolean {
    const normalized = normalizeEmailAddress(email);
    if (normalized.length > 254) return false;

    const parts = normalized.split("@");
    if (parts.length !== 2) return false;
    const [localPart, domain] = parts;
    if (
        !localPart ||
        localPart.length > 64 ||
        localPart.startsWith(".") ||
        localPart.endsWith(".") ||
        localPart.includes("..") ||
        !EMAIL_LOCAL_PART.test(localPart)
    ) {
        return false;
    }

    if (domain.length > 253) return false;
    const labels = domain.split(".");
    return (
        labels.length >= 2 &&
        labels.every((label) => EMAIL_DOMAIN_LABEL.test(label))
    );
}

export function isEmailAllowedForDomain(
    email: string,
    allowedDomain: string,
): boolean {
    const normalized = normalizeEmailAddress(email);
    const domain = allowedDomain.trim().toLowerCase().replace(/^@/, "");
    if (!domain || !isValidDomain(domain) || !isValidEmailAddress(normalized)) {
        return false;
    }
    return normalized.slice(normalized.lastIndexOf("@") + 1) === domain;
}

function isValidDomain(domain: string): boolean {
    if (domain.length > 253) return false;
    const labels = domain.split(".");
    return (
        labels.length >= 2 &&
        labels.every((label) => EMAIL_DOMAIN_LABEL.test(label))
    );
}
