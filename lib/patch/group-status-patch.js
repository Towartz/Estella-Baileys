/**
 * patch/group-status-patch.ts
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GROUP STATUS V2 — STANDALONE MODE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * GroupStatusV2 is a COMPLETELY DIFFERENT feature from Status Stories.
 * They must NEVER share the same code path:
 *
 *   Status Stories  → sock.sendMessage('status@broadcast', content, { statusJidList })
 *   GroupStatusV2   → sock.sendMessage(groupJid, { groupStatusMessageV2: { message: ... } })
 *
 * ── PROTOCOL ─────────────────────────────────────────────────────────────────
 *
 * GroupStatusV2 wraps ANY media/text message inside a FutureProofMessage:
 *
 *   proto.Message = {
 *     groupStatusMessageV2: {          ← FutureProofMessage
 *       message: {                     ← actual content
 *         imageMessage: { ... },       ← or videoMessage, audioMessage, etc.
 *       }
 *     }
 *   }
 *
 * The destination JID is the GROUP JID (@g.us), NOT status@broadcast.
 * relayMessage encrypts it as a group message (skmsg), NOT as status.
 *
 * ── WHY GHOST HAPPENS ─────────────────────────────────────────────────────────
 *
 * Baileys rc9 relayMessage getMediaType() checks `message.imageMessage` directly.
 * But GroupStatusV2 wraps the content inside groupStatusMessageV2.message.
 * Without 23-wrapper normalizeMessageContent, getMediaType() returns undefined
 * → no mediatype attr on outer stanza → WA server drops the message → ghost.
 *
 * FIX (standalone): patchNormalizeMessageContent() in status-patch.ts replaces
 * Baileys' internal normalizeMessageContent with the 23-wrapper version.
 * This makes relayMessage's getMediaType() correctly unwrap groupStatusMessageV2
 * and return the right mediatype.
 *
 * ── ADDITIONAL FIX ──────────────────────────────────────────────────────────
 *
 * Baileys rc9 sendMessage does NOT set media_id for group messages
 * (only does it when the upload path sets mediaHandle, which works for
 * regular media but needs verification for GroupStatusV2 wrapped content).
 *
 * Our patchGroupStatusSend wraps sendMessage to ensure:
 *   1. groupStatusMessageV2 content never routes to status@broadcast
 *   2. The wrapper proto is correctly built from any content shape
 *   3. media_id is captured and injected for wrapped media content
 *   4. The 23-wrapper normalizeMessageContent is applied before relay
 *
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createRequire } from 'module';
import { BAILEYS_PATH } from '../baileys-compat.js';
import { generateWAMessageContent, generateWAMessageFromContent, } from '../baileys-compat.js';
import { normalizeMessageContentFull, getStatusMediaType, FUTURE_PROOF_WRAPPERS, buildStatusTextMessage, } from './status-patch.js';
const _require = createRequire(import.meta.url);
// ─── Proto builder ────────────────────────────────────────────────────────────
/**
 * buildGroupStatusV2Message — wrap any content inside groupStatusMessageV2.
 *
 * Input content is the INNER message (imageMessage, videoMessage, etc.)
 * already prepared by generateWAMessage/generateWAMessageContent.
 * We wrap it in the FutureProofMessage shell.
 */
function buildGroupStatusV2Wrapper(innerMessage) {
    return {
        groupStatusMessageV2: {
            message: innerMessage,
        },
    };
}
function normalizeGroupStatusV2Content(content) {
    if (!content || typeof content !== 'object') {
        return content;
    }
    const next = { ...content };
    if ('audio' in next && next.mimetype == null) {
        next.mimetype = 'audio/ogg; codecs=opus';
    }
    return next;
}
function sanitizeGroupStatusOptions(options = {}) {
    const hasStatusJidList = Object.prototype.hasOwnProperty.call(options, 'statusJidList');
    const hasBroadcast = Object.prototype.hasOwnProperty.call(options, 'broadcast');
    const { statusJidList, broadcast, ...rest } = options;
    if (hasStatusJidList) {
        throw new Error('[group-status-patch] GroupStatusV2 does not accept statusJidList. ' +
            'Use sendStatus(..., { statusJidList }) for status stories, or sendGroupStatusV2(groupJid, content) for group status.');
    }
    if (hasBroadcast) {
        throw new Error(`[group-status-patch] GroupStatusV2 does not accept broadcast=${String(broadcast)}. ` +
            'Group status is always sent only to the target @g.us chat.');
    }
    return rest;
}
/**
 * isGroupStatusV2Content — check if content is a raw GroupStatusV2 payload.
 * Handles both direct FutureProofMessage and unwrapped media/text content.
 */
export function isGroupStatusV2Content(content) {
    if (!content || typeof content !== 'object')
        return false;
    const c = content;
    return (
    // Direct proto wrapper
    'groupStatusMessageV2' in c ||
        // SDK-style flag
        c.__groupStatusV2 === true);
}
// ─── Core patch ───────────────────────────────────────────────────────────────
/**
 * patchGroupStatusSend — add sendGroupStatusV2() to the socket and ensure
 * GroupStatusV2 messages never accidentally route to status@broadcast.
 *
 * Also patches relayMessage to inject mediatype for @g.us GroupStatusV2 messages
 * (since patchRelayMessageForStatus only does this for status@broadcast).
 *
 * Idempotent — safe to call multiple times.
 */
export const patchGroupStatusSend = (sock) => {
    if (sock.__groupStatusV2Patched)
        return;
    sock.__groupStatusV2Patched = true;
    // ── Patch relayMessage to inject mediatype for GroupStatusV2 group messages ─
    // patchRelayMessageForStatus handles status@broadcast.
    // GroupStatusV2 goes to groupJid (@g.us) — we need mediatype there too.
    const origRelay = sock.relayMessage?.bind(sock);
    if (origRelay) {
        const prevRelay = sock.relayMessage;
        sock.relayMessage = async (jid, message, options = {}) => {
            // Only intercept group JIDs with groupStatusMessageV2 content
            if (typeof jid === 'string' &&
                jid.endsWith('@g.us') &&
                message?.groupStatusMessageV2) {
                const mediatype = getStatusMediaType(message);
                if (mediatype) {
                    options = {
                        ...options,
                        additionalAttributes: {
                            ...(options.additionalAttributes ?? {}),
                            mediatype,
                        },
                    };
                }
            }
            return prevRelay(jid, message, options);
        };
    }
    // ── sock.sendGroupStatusV2 ────────────────────────────────────────────────
    /**
     * Send a GroupStatusV2 to a WhatsApp group.
     *
     * This is SEPARATE from sendStatus (which sends to status@broadcast).
     * GroupStatusV2 appears as a group story ring on the group chat.
     *
     * Content types supported:
     *   { image: Buffer | { url } , caption? }
     *   { video: Buffer | { url }, caption?, gifPlayback? }
     *   { audio: Buffer | { url }, ptt? }
     *   { document: Buffer | { url }, fileName?, caption? }
     *   { sticker: Buffer | { url } }
     *   { text: string, mentions? }
     *
     * @example
     * await sock.sendGroupStatusV2(
     *   '6281234567890-1234567890@g.us',
     *   { image: { url: './photo.jpg' }, caption: 'Group story!' },
     * )
     */
    sock.sendGroupStatusV2 = async (groupJid, content, options = {}) => {
        if (!groupJid || !groupJid.endsWith('@g.us')) {
            throw new Error(`[sendGroupStatusV2] groupJid must be a @g.us JID, got: ${groupJid}`);
        }
        // Build the inner message content (what goes inside groupStatusMessageV2.message)
        const sanitizedOptions = sanitizeGroupStatusOptions(options);
        const userJid = sock.user?.id;
        if (!userJid) {
            throw new Error('[sendGroupStatusV2] sock.user.id is not available');
        }
        const { quoted, additionalAttributes, additionalNodes, useCachedGroupMetadata, ...messageOptions } = sanitizedOptions;
        const { innerContent, mediaHandle, } = await buildInnerContent(sock, groupJid, content);
        const fullMsg = generateWAMessageFromContent(groupJid, buildGroupStatusV2Wrapper(innerContent), {
            userJid,
            timestamp: new Date(),
            ...(quoted ? { quoted: quoted } : {}),
            ...messageOptions,
        });
        await sock.relayMessage(groupJid, fullMsg.message, {
            messageId: fullMsg.key.id,
            ...(useCachedGroupMetadata !== undefined ? { useCachedGroupMetadata } : {}),
            ...(additionalNodes ? { additionalNodes } : {}),
            additionalAttributes: {
                ...additionalAttributes,
                ...(mediaHandle ? { media_id: mediaHandle } : {}),
            },
        });
        if (sock.ev?.emit) {
            process.nextTick(() => {
                sock.ev.emit('messages.upsert', {
                    messages: [fullMsg],
                    type: 'append',
                });
            });
        }
        return fullMsg;
    };
    sock.sendGroupStatusV2Text = async (groupJid, text, options = {}) => {
        const trimmedText = typeof text === 'string' ? text.trim() : '';
        if (!trimmedText) {
            throw new Error('[sendGroupStatusV2Text] text must be a non-empty string');
        }
        const { backgroundColor, font, mentions, ...sendOptions } = options;
        return sock.sendGroupStatusV2(groupJid, {
            text: trimmedText,
            ...(backgroundColor !== undefined ? { backgroundColor } : {}),
            ...(font !== undefined ? { font } : {}),
            ...(mentions?.length ? { mentions } : {}),
        }, sendOptions);
    };
    // ── sendMessage interceptor for groupStatusMessageV2 ─────────────────────
    // Guards against GroupStatusV2 accidentally routing to status@broadcast.
    // Also handles the __groupStatusV2 marker from sendGroupStatusV2.
    const origSend = sock.sendMessage?.bind(sock);
    if (origSend) {
        const prevSend = sock.sendMessage;
        sock.sendMessage = async (jid, content, options = {}) => {
            // If someone tries to send groupStatusMessageV2 to status@broadcast — block it
            if (jid === 'status@broadcast' &&
                (content?.groupStatusMessageV2 || content?.__groupStatusV2)) {
                console.error('[group-status-patch] ❌ Blocked: groupStatusMessageV2 cannot be sent to ' +
                    'status@broadcast. Use sendGroupStatusV2(groupJid, content) instead.');
                throw new Error('GroupStatusV2 must be sent to a @g.us group JID, not status@broadcast. ' +
                    'Use sock.sendGroupStatusV2(groupJid, content) instead of sendStatus().');
            }
            if (content?.groupStatusMessageV2 && !jid.endsWith('@g.us')) {
                throw new Error(`GroupStatusV2 must be sent only to @g.us group JIDs, got: ${jid}`);
            }
            if (content?.__groupStatusV2) {
                const inner = content?.groupStatusMessageV2?.message;
                if (jid.endsWith('@g.us') && inner) {
                    return sock.sendGroupStatusV2(jid, inner, options);
                }
                const { __groupStatusV2, ...cleanContent } = content;
                return prevSend(jid, cleanContent, sanitizeGroupStatusOptions(options));
            }
            if (content?.groupStatusMessageV2 && jid.endsWith('@g.us')) {
                const inner = content.groupStatusMessageV2?.message;
                if (inner) {
                    return sock.sendGroupStatusV2(jid, inner, options);
                }
                return prevSend(jid, content, sanitizeGroupStatusOptions(options));
            }
            return prevSend(jid, content, options);
        };
    }
    console.log('[group-status-patch v10] sendGroupStatusV2() ✓  (separated from status@broadcast)');
    console.log('[group-status-patch v10] relayMessage wrap    ✓  (mediatype for @g.us groupStatusMessageV2)');
};
// ─── Inner content builder ────────────────────────────────────────────────────
/**
 * buildInnerContent — convert SDK content to the inner proto message.
 *
 * The inner message inside groupStatusMessageV2.message follows the same
 * structure as a regular message proto (imageMessage, videoMessage, etc.).
 * This function strips the SDK-level wrapper and returns the raw content
 * that Baileys' generateWAMessage will handle.
 */
async function buildInnerContent(sock, groupJid, content) {
    const normalizedContent = normalizeGroupStatusV2Content(content);
    // Already a fully-formed inner message (has imageMessage, videoMessage etc.)
    if ('imageMessage' in normalizedContent ||
        'videoMessage' in normalizedContent ||
        'audioMessage' in normalizedContent ||
        'documentMessage' in normalizedContent ||
        'stickerMessage' in normalizedContent ||
        'conversation' in normalizedContent ||
        'extendedTextMessage' in normalizedContent) {
        return { innerContent: normalizedContent };
    }
    const userJid = sock.user?.id;
    if (!userJid) {
        throw new Error('[sendGroupStatusV2] sock.user.id is not available');
    }
    let mediaHandle;
    const contentOptions = {
        jid: groupJid,
        userJid,
        logger: sock.logger,
        upload: async (rs, opts = {}) => {
            const uploadResult = await sock.waUploadToServer(rs, opts);
            mediaHandle = uploadResult?.handle;
            return uploadResult;
        },
    };
    if (typeof sock.profilePictureUrl === 'function') {
        contentOptions.getProfilePicUrl = sock.profilePictureUrl.bind(sock);
    }
    if (sock.mediaCache) {
        contentOptions.mediaCache = sock.mediaCache;
    }
    if (sock.options) {
        contentOptions.options = sock.options;
    }
    if ('backgroundColor' in normalizedContent && normalizedContent.backgroundColor != null) {
        contentOptions.backgroundColor = normalizedContent.backgroundColor;
    }
    if ('font' in normalizedContent && normalizedContent.font != null) {
        contentOptions.font = Number(normalizedContent.font);
    }
    const innerContent = await generateWAMessageContent(normalizedContent, contentOptions);
    return {
        innerContent: innerContent,
        mediaHandle,
    };
}
// ─── Diagnostics helper ───────────────────────────────────────────────────────
/**
 * assertGroupStatusV2Ready — check that all required patches are applied.
 * Call after patchStatusSend() and patchGroupStatusSend() to verify setup.
 */
export const assertGroupStatusV2Ready = (sock) => {
    const issues = [];
    const warnings = [];
    if (!sock.__groupStatusV2Patched) {
        issues.push('patchGroupStatusSend() not applied — sendGroupStatusV2 unavailable');
    }
    if (!sock.__statusSendPatchedV9 && !sock.__wileysPatchedStatus) {
        warnings.push('patchStatusSend() not applied — mediatype may be missing on group status stanza');
    }
    if (typeof sock.sendGroupStatusV2 !== 'function') {
        issues.push('sock.sendGroupStatusV2 is not a function');
    }
    if (typeof sock.relayMessage !== 'function') {
        issues.push('sock.relayMessage is not available');
    }
    return { ok: issues.length === 0, issues, warnings };
};
//# sourceMappingURL=group-status-patch.js.map