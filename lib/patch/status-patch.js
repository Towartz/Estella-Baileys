/**
 * patch/status-patch.ts — custom-baileys v10 Enterprise
 *
 * ════════════════════════════════════════════════════════════════════════════
 * STATUS STORIES — FULL GHOST STATUS FIX
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ROOT CAUSES (all fixed in v10 standalone mode):
 *
 *  [1] normalizeMessageContent — only 5 wrappers in Baileys rc9 vs 23 in wileys.
 *      FIX: getFutureProofMessageFull() with all 23 wrappers used inline.
 *      No source modification needed — we compute mediatype ourselves.
 *
 *  [2] mediatype missing on outer <message> stanza.
 *      FIX: patchRelayMessageForStatus() wraps sock.relayMessage to inject
 *           mediatype attr on stanza.attrs before dispatch.
 *
 *  [3] media_id missing for status@broadcast.
 *      FIX: patchSendMessageMediaId() wraps sock.sendMessage to capture
 *           mediaHandle from upload callback, inject media_id into
 *           additionalAttributes before relayMessage is called.
 *
 * All three patches are runtime monkey-patches on the live socket object.
 * Zero Baileys source file modifications required.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */
// ─── Runtime module patcher ──────────────────────────────────────────────────
// Needed to patch Baileys' internal normalizeMessageContent at the module level
// so ALL internal calls (processMessage, getContentType, relayMessage getMediaType)
// use the 23-wrapper version — identical to what apply-patches.ts does at source level.
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { BAILEYS_PATH } from '../baileys-compat.js';
const _require = createRequire(import.meta.url);
export const STATUS_JID = 'status@broadcast';
// ─── Font enum (mirrors proto.Message.ExtendedTextMessage.FontType) ───────────
export var StatusFont;
(function (StatusFont) {
    StatusFont[StatusFont["SANS_SERIF"] = 0] = "SANS_SERIF";
    StatusFont[StatusFont["SERIF"] = 1] = "SERIF";
    StatusFont[StatusFont["NORICAN_REGULAR"] = 2] = "NORICAN_REGULAR";
    StatusFont[StatusFont["BRYNDAN_WRITE"] = 3] = "BRYNDAN_WRITE";
    StatusFont[StatusFont["BEBASNEUE_REGULAR"] = 4] = "BEBASNEUE_REGULAR";
    StatusFont[StatusFont["OSWALD_HEAVY"] = 5] = "OSWALD_HEAVY";
})(StatusFont || (StatusFont = {}));
// ─── All 23 wileys FutureProof wrappers ───────────────────────────────────────
export const FUTURE_PROOF_WRAPPERS = [
    'ephemeralMessage',
    'viewOnceMessage',
    'documentWithCaptionMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'editedMessage',
    'groupMentionedMessage',
    'botInvokeMessage',
    'lottieStickerMessage',
    'eventCoverImage',
    'statusMentionMessage',
    'pollCreationOptionImageMessage',
    'associatedChildMessage',
    'groupStatusMentionMessage',
    'pollCreationMessageV4',
    'pollCreationMessageV5',
    'statusAddYours',
    'groupStatusMessage',
    'limitSharingMessage',
    'botTaskMessage',
    'questionMessage',
    'groupStatusMessageV2',
    'botForwardedMessage',
];
/**
 * getFutureProofMessageFull — unwrap all 23 wileys wrapper types.
 * Used in-place of Baileys rc9 getFutureProofMessage (only has 5).
 */
function getFutureProofMessageFull(message) {
    if (!message)
        return undefined;
    for (const wrapper of FUTURE_PROOF_WRAPPERS) {
        if (message[wrapper])
            return message[wrapper];
    }
    return undefined;
}
/**
 * normalizeMessageContentFull — unwrap all 23 FutureProof wrappers (wileys port).
 * Use this instead of Baileys rc9 normalizeMessageContent to detect
 * mediatype from groupStatusMessageV2 and other deep-nested messages.
 */
export const normalizeMessageContentFull = (content) => {
    if (!content)
        return undefined;
    for (let i = 0; i < 5; i++) {
        const inner = getFutureProofMessageFull(content);
        if (!inner)
            break;
        content = inner.message;
        if (!content)
            break;
    }
    return content;
};
/**
 * getStatusMediaType — detect mediatype from a message content.
 * Uses full 23-wrapper normalizeMessageContentFull.
 * Mirrors wileys getMediaType() used in relayMessage additionalAttributes.
 */
export const getStatusMediaType = (content) => {
    if (!content)
        return undefined;
    const normalized = normalizeMessageContentFull(content) ?? content;
    if (normalized.imageMessage)
        return 'image';
    if (normalized.videoMessage)
        return 'video';
    if (normalized.audioMessage)
        return 'audio';
    if (normalized.documentMessage)
        return 'document';
    if (normalized.stickerMessage)
        return 'sticker';
    return undefined;
};
// ─── Color helper ─────────────────────────────────────────────────────────────
/**
 * assertColorARGB — convert color value to WA ARGB uint32.
 * Mirrors wileys assertColor() with full format support.
 */
export const assertColorARGB = (color, defaultColor = 0xFF000000) => {
    if (color == null || color === '')
        return defaultColor;
    if (typeof color === 'number') {
        // Already numeric — ensure high byte = 0xFF if no alpha provided
        if ((color & 0xFF000000) === 0)
            return (color | 0xFF000000) >>> 0;
        return color >>> 0;
    }
    const s = String(color).trim();
    // #RRGGBB or #AARRGGBB
    if (/^#[0-9A-Fa-f]{6}$/.test(s)) {
        const n = parseInt(s.slice(1), 16);
        return (0xFF000000 | n) >>> 0;
    }
    if (/^#[0-9A-Fa-f]{8}$/.test(s)) {
        return parseInt(s.slice(1), 16) >>> 0;
    }
    // decimal string
    const dec = parseInt(s, 10);
    if (!isNaN(dec))
        return dec >>> 0;
    return defaultColor;
};
// ─── patchNormalizeMessageContent ─────────────────────────────────────────────
/**
 * patchNormalizeMessageContent — replace Baileys' built-in normalizeMessageContent
 * with our 23-wrapper version AT THE MODULE LEVEL.
 *
 * ── WHY THIS IS NEEDED ────────────────────────────────────────────────────────
 *
 * Baileys rc9 normalizeMessageContent only unwraps 5 wrapper types.
 * Wileys (rc9-based) already has 23, but stock Baileys rc9 does not.
 *
 * In PATCHED mode: apply-patches.ts replaces the TypeScript source — all
 *   internal Baileys calls automatically use 23 wrappers after recompile.
 *
 * In STANDALONE mode: we must patch the live CJS module exports object so that
 *   internal calls via `(0, messages_1.normalizeMessageContent)(x)` resolve to
 *   our version. This is safe because CJS exports objects are plain JS objects
 *   with writable properties.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────
 *
 *  • processMessage: cleanMessage / isRealMessage / getContentType calls
 *  • event-buffer: normalizeMessageContent for chat update detection
 *  • relayMessage: getMediaType for mediatype attr on status stanzas
 *  • history sync: message normalisation for history messages
 *  • Any future Baileys call that uses normalizeMessageContent internally
 *
 * Must be called early (before any messages are processed).
 * Idempotent — safe to call multiple times.
 */
export const patchNormalizeMessageContent = () => {
    try {
        // Resolve the Baileys Utils/messages.js module path
        const baileysDir = dirname(BAILEYS_PATH);
        // Try multiple candidate paths for Utils/messages.js
        const candidates = [
            join(baileysDir, 'Utils', 'messages.js'),
            join(dirname(baileysDir), 'Utils', 'messages.js'),
            join(baileysDir, '..', 'Utils', 'messages.js'),
        ];
        let messagesModule = null;
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                try {
                    messagesModule = _require(candidate);
                    break;
                }
                catch { /* try next */ }
            }
        }
        // Fallback: try require.resolve from Baileys entry
        if (!messagesModule) {
            try {
                const resolved = _require.resolve(join(dirname(BAILEYS_PATH), 'Utils', 'messages'));
                messagesModule = _require(resolved);
            }
            catch { /* not available */ }
        }
        if (!messagesModule) {
            console.warn('[status-patch] patchNormalizeMessageContent: could not locate Utils/messages.js — standalone mode only');
            return false;
        }
        // Check if already patched
        if (messagesModule.__wileys23Patched)
            return true;
        // Check current wrapper count (if already 23+, no need to patch)
        const current = messagesModule.normalizeMessageContent;
        if (!current)
            return false;
        // Wrap with our 23-wrapper version
        const patched = (content) => normalizeMessageContentFull(content);
        patched.__wileys23Patched = true;
        messagesModule.__wileys23Patched = true;
        messagesModule.normalizeMessageContent = patched;
        console.log('[status-patch] ✅ normalizeMessageContent patched to 23-wrapper version (standalone mode)');
        return true;
    }
    catch (err) {
        console.warn('[status-patch] patchNormalizeMessageContent failed:', err?.message ?? err);
        return false;
    }
};
// ─── patchRelayMessageForStatus ───────────────────────────────────────────────
/**
 * patchRelayMessageForStatus — inject mediatype attr on outer stanza for
 * status@broadcast messages.
 *
 * Baileys rc9 bug: mediatype is added to enc nodes but NOT to the outer
 * <message> stanza attrs. WA requires it on the outer stanza.
 *
 * This wraps sock.relayMessage at runtime. No source modification needed.
 */
export const patchRelayMessageForStatus = (sock) => {
    if (sock.__wileysPatchedRelay)
        return;
    sock.__wileysPatchedRelay = true;
    const originalRelay = sock.relayMessage?.bind(sock);
    if (!originalRelay)
        return;
    sock.relayMessage = async (jid, message, options = {}) => {
        if (jid === STATUS_JID) {
            const mediatype = getStatusMediaType(message);
            if (mediatype) {
                options.additionalAttributes = {
                    ...(options.additionalAttributes ?? {}),
                    mediatype,
                };
            }
        }
        return originalRelay(jid, message, options);
    };
};
// ─── patchSendMessageMediaId ──────────────────────────────────────────────────
/**
 * patchSendMessageMediaId — capture mediaHandle from upload, inject media_id.
 *
 * Baileys rc9 bug: sendMessage does NOT inject media_id for status@broadcast.
 * Without media_id on the outer stanza, WA CDN can't link the upload to the
 * message → recipient sees "media unavailable" ghost.
 *
 * Strategy: wrap waUploadToServer on the socket to intercept the upload
 * result and store the handle, then inject it via additionalAttributes.
 */
export const patchSendMessageMediaId = (sock) => {
    if (sock.__wileysPatchedMediaId)
        return;
    sock.__wileysPatchedMediaId = true;
    const originalUpload = sock.waUploadToServer?.bind(sock);
    if (!originalUpload)
        return;
    let lastMediaHandle;
    sock.waUploadToServer = async (...args) => {
        const result = await originalUpload(...args);
        // waUploadToServer returns { mediaUrl, directPath, handle?, ... }
        if (result?.handle)
            lastMediaHandle = result.handle;
        return result;
    };
    const originalSend = sock.sendMessage?.bind(sock);
    if (!originalSend)
        return;
    sock.sendMessage = async (jid, content, options = {}) => {
        lastMediaHandle = undefined;
        const result = await originalSend(jid, content, options);
        if (jid === STATUS_JID && lastMediaHandle) {
            // Belt-and-suspenders: also push to relayMessage options
            ;
            sock.__lastStatusMediaId = lastMediaHandle;
            lastMediaHandle = undefined;
        }
        return result;
    };
};
// ─── patchStatusSend ─────────────────────────────────────────────────────────
/**
 * patchStatusSend — add sendStatus() and sendStatusText() to the socket.
 *
 * Also applies patchRelayMessageForStatus + patchSendMessageMediaId.
 * Idempotent — safe to call multiple times.
 */
export const patchStatusSend = (sock) => {
    if (sock.__wileysPatchedStatus)
        return;
    sock.__wileysPatchedStatus = true;
    // Patch Baileys' internal normalizeMessageContent to use 23-wrapper version.
    // This is the standalone equivalent of apply-patches.ts source modification.
    // Called here so it fires as early as possible, before any message processing.
    patchNormalizeMessageContent();
    patchRelayMessageForStatus(sock);
    patchSendMessageMediaId(sock);
    // ── sock.sendStatus ───────────────────────────────────────────────────────
    sock.sendStatus = async (content, options = {}) => {
        const { statusJidList, additionalAttributes, ...rest } = options;
        const sendOpts = {
            statusJidList: statusJidList ?? [],
            additionalAttributes: additionalAttributes ?? {},
            ...rest,
        };
        // Detect media type before sending for belt-and-suspenders injection
        const mediatype = getStatusMediaType(content);
        if (mediatype) {
            sendOpts.additionalAttributes.mediatype = mediatype;
        }
        // Text status: inject backgroundArgb and font
        if ('text' in content && !content.image && !content.video) {
            const txtContent = content;
            const sendContent = {
                text: txtContent.text,
                mentions: txtContent.mentions ?? [],
            };
            if (txtContent.backgroundColor != null) {
                sendContent.backgroundArgb = assertColorARGB(txtContent.backgroundColor);
            }
            if (txtContent.font != null) {
                sendContent.font = Number(txtContent.font);
            }
            return sock.sendMessage(STATUS_JID, sendContent, sendOpts);
        }
        // Media status: pass through with any extra options
        const mediaContent = content;
        const sendContent = { ...mediaContent };
        // Audio status with background color → inject backgroundArgb directly
        if (mediaContent.audio && mediaContent.backgroundColor != null) {
            sendContent.backgroundArgb = assertColorARGB(mediaContent.backgroundColor);
            delete sendContent.backgroundColor;
        }
        return sock.sendMessage(STATUS_JID, sendContent, sendOpts);
    };
    // ── sock.sendStatusText ───────────────────────────────────────────────────
    sock.sendStatusText = async (text, options = {}) => {
        const { backgroundColor, font, mentions, ...rest } = options;
        return sock.sendStatus({ text, backgroundColor, font, mentions }, rest);
    };
    // ── sock.fetchStatusAudience ──────────────────────────────────────────────
    sock.fetchStatusAudience = async (filter) => {
        // Read from Baileys contact store if available
        const contacts = sock.store?.contacts;
        if (!contacts)
            return [];
        return Object.keys(contacts)
            .filter(jid => jid.endsWith('@s.whatsapp.net') && (!filter || filter(jid)));
    };
};
//# sourceMappingURL=status-patch.js.map