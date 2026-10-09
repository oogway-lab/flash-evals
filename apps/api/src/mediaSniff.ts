/**
 * Magic-byte checks for uploaded media. The declared MIME type comes from the
 * browser, so before accepting a direct upload we read the object's first
 * bytes and confirm they look like the declared format.
 */

/** Bytes needed to recognise every supported format. */
export const MEDIA_SNIFF_BYTES = 16;

type Sniffer = (bytes: Uint8Array) => boolean;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

const isPng: Sniffer = (b) => startsWith(b, PNG);
const isJpeg: Sniffer = (b) => startsWith(b, [0xff, 0xd8, 0xff]);
const isGif: Sniffer = (b) =>
    startsWithAscii(b, "GIF87a") || startsWithAscii(b, "GIF89a");
const isWebp: Sniffer = (b) =>
    startsWithAscii(b, "RIFF") && asciiAt(b, 8, "WEBP");
const isWav: Sniffer = (b) =>
    startsWithAscii(b, "RIFF") && asciiAt(b, 8, "WAVE");
const isWebm: Sniffer = (b) => startsWith(b, EBML);
const isOgg: Sniffer = (b) => startsWithAscii(b, "OggS");
const isFlac: Sniffer = (b) => startsWithAscii(b, "fLaC");
const isIsoMedia: Sniffer = (b) => asciiAt(b, 4, "ftyp");
// ID3v2 tags may precede MP3, AAC (ADTS), and FLAC streams.
const hasId3: Sniffer = (b) => startsWithAscii(b, "ID3");
// MPEG audio frame sync: 11 set bits, layer bits not "reserved" (00).
const isMpegFrame: Sniffer = (b) =>
    b.length >= 2 &&
    b[0] === 0xff &&
    (b[1]! & 0xe0) === 0xe0 &&
    (b[1]! & 0x06) !== 0;
// AAC ADTS: 12-bit sync, layer bits always 00.
const isAdts: Sniffer = (b) =>
    b.length >= 2 && b[0] === 0xff && (b[1]! & 0xf6) === 0xf0;
const isAdif: Sniffer = (b) => startsWithAscii(b, "ADIF");

const SNIFFERS: Record<string, Sniffer[]> = {
    "image/png": [isPng],
    "image/jpeg": [isJpeg],
    "image/gif": [isGif],
    "image/webp": [isWebp],
    "audio/mpeg": [hasId3, isMpegFrame],
    "audio/mp3": [hasId3, isMpegFrame],
    "audio/mp4": [isIsoMedia],
    "audio/aac": [isAdts, isAdif, hasId3, isIsoMedia],
    "audio/wav": [isWav],
    "audio/x-wav": [isWav],
    "audio/webm": [isWebm],
    "audio/ogg": [isOgg],
    "audio/flac": [isFlac, hasId3],
};

/**
 * True when `bytes` (the start of a file) match `mimeType`'s signature.
 * Unknown MIME types return false so callers fail closed.
 */
export function mediaBytesMatchType(
    bytes: Uint8Array,
    mimeType: string,
): boolean {
    const sniffers = SNIFFERS[mimeType.toLowerCase()];
    if (!sniffers) return false;
    return sniffers.some((sniff) => sniff(bytes));
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
    return (
        bytes.length >= prefix.length &&
        prefix.every((value, index) => bytes[index] === value)
    );
}

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
    return asciiAt(bytes, 0, text);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
    if (bytes.length < offset + text.length) return false;
    for (let index = 0; index < text.length; index += 1) {
        if (bytes[offset + index] !== text.charCodeAt(index)) return false;
    }
    return true;
}
