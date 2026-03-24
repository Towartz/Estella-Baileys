/**
 * patch/wileys-utils.ts — custom-baileys v10 Enterprise
 *
 * ════════════════════════════════════════════════════════════════════════════
 * FULL PORT — wileys@latest utilities absent from Baileys v7 rc9
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Every export here is a faithful port of the equivalent wileys function,
 * updated for Baileys v7 rc9 type signatures.
 *
 * Sections:
 *  A. JID constants & helpers (re-exported from utils/jid.ts)
 *  B. getSenderLidFull
 *  C. extractMessageContent  (template + wrapped message unwrap)
 *  D. isRealMessage
 *  E. shouldIncrementChatUnread
 *  F. getChatId
 *  G. cleanMessage
 *  H. fetchLatestWileysVersion
 *  I. Event stream (captureEventStream / readAndEmitEventStream)
 *  J. makeInMemoryStore      (LID-aware, ring-buffered, file-serializable)
 *  K. ALL_WA_PATCH_NAMES
 *  L. normalizeMessageContentFull  (all 23 wrapper types from wileys@latest)
 *  M. getUSyncToken / Privacy helpers
 */
import { EventEmitter } from 'events';
import { createReadStream, writeFile, writeFileSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { jidDecode, jidEncode, jidNormalizedUser, areJidsSameUser, isJidBroadcast, isJidStatusBroadcast, normalizeMessageContent, getContentType, } from '../baileys-compat.js';
// ── A. JID constants & helpers ────────────────────────────────────────────────
// Re-exported from utils/jid.ts — single authoritative source.
export { isJidUser, isJidLid, isJidLegacyUser, isJidGroup, isJidBroadcast as isJidBroadcastUtil, isJidStatusBroadcast as isJidStatusBroadcastUtil, isJidNewsletter, isJidBot, isJidUserLike, parseJid, normalizeJid, normalizeJidUser, lidToJid, jidToLid, getBotJid, phoneToBotJid, resolveJidSync, areJidsSameUserFull, encodeJid, toJid, } from '../utils/jid.js';
import { isJidBot as _isJidBot } from '../utils/jid.js';
/** Meta AI canonical JID (first BOT_MAP entry) */
export const META_AI_JID = '13135550002@c.us';
/** Official WhatsApp Business account JID */
export const OFFICIAL_BIZ_JID = '16505361212@c.us';
const BOT_PHONE_RE = /^1313555\d{4}$|^131655500\d{2}$/;
/**
 * isJidMetaAi — true if jid is a Meta AI @bot address.
 * (Alias kept for wileys API compatibility.)
 */
export const isJidMetaAi = (jid) => typeof jid === 'string' && jid.endsWith('@bot');
/**
 * isJidBot — true if jid is a WA business bot phone (matches Meta AI range).
 * Different from utils/jid.ts isJidBot which checks @bot suffix.
 */
export const isJidBotPhone = (jid) => {
    if (!jid || !jid.endsWith('@c.us'))
        return false;
    return BOT_PHONE_RE.test(jid.split('@')[0]);
};
// ── B. getSenderLidFull ───────────────────────────────────────────────────────
/**
 * getSenderLidFull — derive { jid, lid } from a message.
 * Correct wileys implementation: re-encodes user part to @lid form
 * for the canonical LID identifier. jid = raw sender, lid = @lid form.
 */
export const getSenderLidFull = (message) => {
    const sender = message.key?.participant ?? message.key?.remoteJid ?? '';
    const decoded = jidDecode(sender);
    const user = decoded?.user ?? '';
    return { jid: sender, lid: jidEncode(user, 'lid') };
};
// ── C. extractMessageContent ──────────────────────────────────────────────────
/**
 * extractMessageContent — go beyond normalizeMessageContent.
 *
 * Also handles template messages (buttonsMessage, hydratedFourRowTemplate,
 * hydratedTemplate, fourRowTemplate) to extract the real displayable content.
 *
 * Port of wileys Utils/messages.js extractMessageContent().
 */
export const extractMessageContent = (content) => {
    const fromTemplate = (msg) => {
        if (msg.imageMessage)
            return { imageMessage: msg.imageMessage };
        if (msg.documentMessage)
            return { documentMessage: msg.documentMessage };
        if (msg.videoMessage)
            return { videoMessage: msg.videoMessage };
        if (msg.locationMessage)
            return { locationMessage: msg.locationMessage };
        return {
            conversation: 'contentText' in msg
                ? msg.contentText
                : ('hydratedContentText' in msg ? msg.hydratedContentText : ''),
        };
    };
    let c = normalizeMessageContent(content);
    if (!c)
        return c;
    if (c.buttonsMessage)
        return fromTemplate(c.buttonsMessage);
    if (c.templateMessage?.hydratedFourRowTemplate)
        return fromTemplate(c.templateMessage.hydratedFourRowTemplate);
    if (c.templateMessage?.hydratedTemplate)
        return fromTemplate(c.templateMessage.hydratedTemplate);
    if (c.templateMessage?.fourRowTemplate)
        return fromTemplate(c.templateMessage.fourRowTemplate);
    return c;
};
// ── D. Message filtering ──────────────────────────────────────────────────────
// Stub types that count as "real" messages (proto numeric values)
const REAL_STUB = new Set([3, 4, 38, 39]); // CALL_MISSED_*
const REAL_STUB_ME = new Set([7]); // GROUP_PARTICIPANT_ADD
/**
 * isRealMessage — true if this message should be shown to the user.
 * Excludes protocol messages, reactions, poll updates, and most stubs.
 * Port of wileys Utils/process-message.js isRealMessage().
 */
export const isRealMessage = (message, meId) => {
    const m = message;
    const content = normalizeMessageContent(m?.message);
    const hasCtnt = Boolean(content && getContentType(content));
    const stubType = m?.messageStubType;
    const stubOk = (stubType !== undefined && REAL_STUB.has(stubType)) ||
        (stubType !== undefined && REAL_STUB_ME.has(stubType) &&
            m?.messageStubParameters?.some(p => areJidsSameUser(meId, p)));
    return Boolean((!!content || stubOk) &&
        hasCtnt &&
        !content?.protocolMessage &&
        !content?.reactionMessage &&
        !content?.pollUpdateMessage);
};
// ── E. shouldIncrementChatUnread ──────────────────────────────────────────────
/** True if this message should increment the unread counter. */
export const shouldIncrementChatUnread = (message) => {
    const m = message;
    if (!m?.key && !(m?.messageStubType))
        return false;
    return !m?.key?.fromMe && !(m?.messageStubType);
};
// ── F. getChatId ──────────────────────────────────────────────────────────────
/**
 * getChatId — get the effective chat ID from a message.
 *
 * For non-status broadcasts received from others, the chat is the sender.
 * Port of wileys Utils/process-message.js getChatId().
 */
export const getChatId = (message) => {
    const m = message;
    const key = m?.key;
    if (!key)
        return '';
    const remoteJid = (key.remoteJid ?? '');
    // Status broadcast received from others — chat is the contact
    if (isJidStatusBroadcast(remoteJid) &&
        !key.fromMe &&
        key.participant) {
        return jidNormalizedUser(key.participant);
    }
    return jidNormalizedUser(remoteJid);
};
// ── G. cleanMessage ───────────────────────────────────────────────────────────
/**
 * cleanMessage — strip internal / non-serializable fields from a message.
 *
 * Removes fields Baileys adds at runtime that should not be stored or sent.
 * Port of wileys Utils/process-message.js cleanMessage().
 */
export const cleanMessage = (message) => {
    const m = message;
    if (!m)
        return m;
    const cleaned = { ...m };
    delete cleaned.messageStubType;
    delete cleaned.messageStubParameters;
    delete cleaned.status;
    delete cleaned.userReceipt;
    const key = m.key;
    if (key) {
        cleaned.key = { ...key };
        // Normalise key fields that should not be persisted raw
        if (typeof cleaned.key.remoteJid === 'string') {
            cleaned.key.remoteJid =
                jidNormalizedUser(cleaned.key.remoteJid);
        }
    }
    return cleaned;
};
// ── H. fetchLatestWileysVersion ───────────────────────────────────────────────
const FALLBACK_VERSION = [0, 5, 1];
/**
 * fetchLatestWileysVersion — fetch current wileys version from npm registry.
 * Falls back to bundled version on network error.
 */
export const fetchLatestWileysVersion = async (opts = {}) => {
    try {
        const res = await fetch('https://registry.npmjs.org/wileys', {
            ...opts,
            headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
        });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const vstr = data?.['dist-tags']?.latest
            ?? data?.version
            ?? '0.5.1';
        const [maj = 0, min = 5, pat = 1] = vstr.split('.').map(Number);
        return { version: [maj, min, pat], isLatest: true };
    }
    catch (error) {
        return { version: [...FALLBACK_VERSION], isLatest: false, error };
    }
};
// ── I. Event stream ───────────────────────────────────────────────────────────
/**
 * captureEventStream — record all socket events to a JSONL file.
 * Useful for debugging, replay testing, and audit trails.
 * Each line: { ts: number, event: string, data: unknown }
 */
export const captureEventStream = (ev, filename) => {
    const origEmit = ev.emit.bind(ev);
    let pending = Promise.resolve();
    ev.emit = (...args) => {
        const line = JSON.stringify({ ts: Date.now(), event: args[0], data: args[1] }) + '\n';
        const result = origEmit(...args);
        pending = pending.then(() => new Promise(r => writeFile(filename, line, { flag: 'a' }, () => r())));
        return result;
    };
    // Returns a stop function that restores original emit
    return () => { ev.emit = origEmit; };
};
/**
 * readAndEmitEventStream — replay a captured JSONL event file.
 * Returns an EventEmitter that fires the recorded events and a Promise
 * that resolves when replay is complete.
 */
export const readAndEmitEventStream = (filename, delayIntervalMs = 0) => {
    const ev = new EventEmitter();
    const task = (async () => {
        const rl = createInterface({ input: createReadStream(filename), crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.trim())
                continue;
            try {
                const { event, data } = JSON.parse(line);
                ev.emit(event, data);
                if (delayIntervalMs > 0)
                    await new Promise(r => setTimeout(r, delayIntervalMs));
            }
            catch { /* skip malformed lines */ }
        }
    })();
    return { ev, task };
};
/** Maximum messages kept per chat (ring buffer to avoid unbounded growth). */
const STORE_MAX_MSGS_PER_CHAT = 200;
/**
 * makeInMemoryStore — lightweight event-driven store.
 *
 * Tracks chats, messages, and contacts from socket events.
 * LID-aware: contacts indexed by both id and lid for fast @lid lookups.
 * Stores up to STORE_MAX_MSGS_PER_CHAT (200) messages per chat.
 */
export const makeInMemoryStore = () => {
    const chats = new Map();
    const messages = new Map();
    const contacts = new Map();
    const upsertMsgs = (msgs, prepend) => {
        for (const msg of msgs) {
            const m = msg;
            const jid = m.key?.remoteJid;
            if (!jid)
                continue;
            const arr = messages.get(jid) ?? [];
            const idx = arr.findIndex(x => x.key?.id ===
                (m.key?.id));
            if (idx >= 0) {
                arr[idx] = { ...arr[idx], ...m };
            }
            else {
                prepend ? arr.unshift(m) : arr.push(m);
            }
            if (arr.length > STORE_MAX_MSGS_PER_CHAT)
                arr.splice(STORE_MAX_MSGS_PER_CHAT);
            messages.set(jid, arr);
        }
    };
    const upsertChat = (c) => {
        const chat = c;
        if (chat.id)
            chats.set(chat.id, { ...(chats.get(chat.id) ?? {}), ...chat });
    };
    const upsertContact = (c) => {
        const ct = c;
        if (ct.id)
            contacts.set(ct.id, { ...(contacts.get(ct.id) ?? {}), ...ct });
        if (ct.lid)
            contacts.set(ct.lid, { ...(contacts.get(ct.lid) ?? {}), ...ct });
    };
    const bind = (ev) => {
        // Chats
        ev.on('chats.set', (d) => (d.chats ?? []).forEach(upsertChat));
        ev.on('chats.upsert', (d) => d.forEach(upsertChat));
        ev.on('chats.update', (d) => d.forEach(upsertChat));
        ev.on('chats.delete', (ids) => ids.forEach(id => chats.delete(id)));
        // Contacts
        ev.on('contacts.upsert', (d) => d.forEach(upsertContact));
        ev.on('contacts.update', (d) => d.forEach(upsertContact));
        // Messages
        ev.on('messages.upsert', (d) => upsertMsgs(d.messages ?? [], true));
        ev.on('messages.update', (d) => {
            for (const upd of d) {
                const jid = upd.key?.remoteJid;
                if (!jid)
                    continue;
                const arr = messages.get(jid) ?? [];
                const idx = arr.findIndex(x => x.key?.id ===
                    (upd.key?.id));
                if (idx >= 0)
                    arr[idx] = {
                        ...arr[idx],
                        ...(upd.update ?? {})
                    };
                messages.set(jid, arr);
            }
        });
        ev.on('messages.delete', (d) => {
            const { keys: delKeys } = d;
            for (const k of delKeys ?? []) {
                if (!k.remoteJid)
                    continue;
                const arr = messages.get(k.remoteJid) ?? [];
                messages.set(k.remoteJid, arr.filter(x => x.key?.id !== k.id));
            }
        });
        ev.on('messaging-history.set', (d) => {
            const { chats: hc, contacts: hco, messages: hm } = d;
            (hc ?? []).forEach(upsertChat);
            (hco ?? []).forEach(upsertContact);
            upsertMsgs(hm ?? [], false);
        });
    };
    const toFile = (path) => writeFileSync(path, JSON.stringify({
        chats: [...chats.entries()],
        messages: [...messages.entries()],
        contacts: [...contacts.entries()],
    }, null, 2));
    const fromFile = (path) => {
        try {
            const d = JSON.parse(readFileSync(path, 'utf8'));
            for (const [k, v] of d.chats ?? [])
                chats.set(k, v);
            for (const [k, v] of d.messages ?? [])
                messages.set(k, v);
            for (const [k, v] of d.contacts ?? [])
                contacts.set(k, v);
        }
        catch { /* file absent or corrupt — start fresh */ }
    };
    const getMessages = (jid, limit = 50) => {
        const arr = messages.get(jid) ?? [];
        return limit > 0 ? arr.slice(0, limit) : arr;
    };
    const getContact = (jid) => contacts.get(jid) ?? contacts.get(jid.replace('@s.whatsapp.net', '@c.us'));
    return { chats, messages, contacts, bind, toFile, fromFile, getMessages, getContact };
};
// ── K. ALL_WA_PATCH_NAMES ─────────────────────────────────────────────────────
/**
 * ALL_WA_PATCH_NAMES — app-state patch categories.
 * Port of wileys Types/Chat.js. Used by resyncAppState().
 */
export const ALL_WA_PATCH_NAMES = [
    'critical_block',
    'critical_unblock_low',
    'regular_high',
    'regular_low',
    'regular',
];
// ── L. normalizeMessageContentFull ───────────────────────────────────────────
/**
 * normalizeMessageContentFull — complete wileys@latest port.
 *
 * Unwraps ALL 23 wrapper message types from wileys@latest.
 * This is the fix for ghost status in groupStatusMessageV2 and all other
 * wrapper types that Baileys v7 rc9 getFutureProofMessage misses.
 *
 * ROOT CAUSE of ghost status in Baileys v7 rc9:
 *   rc9 getFutureProofMessage only unwraps 5 wrapper types.
 *   Wileys unwraps 23. Missing: groupStatusMessageV2, groupStatusMessage,
 *   editedMessage, botInvokeMessage, statusMentionMessage, + 13 more.
 *   normalizeMessageContent() is called by relayMessage's getMediaType() to
 *   detect mediatype for the stanza. If groupStatusMessageV2 isn't unwrapped,
 *   getMediaType() → undefined → no mediatype attr → ghost status.
 *
 * NOTE: This function is ADDITIVE to normalizeMessageContent — it does NOT
 * replace it. Internal Baileys code still uses the original. Use this
 * function in your own code for complete unwrapping.
 */
export const normalizeMessageContentFull = (content) => {
    if (!content)
        return undefined;
    let msg = content;
    for (let i = 0; i < 5; i++) {
        const inner = getFutureProofFull(msg);
        if (!inner)
            break;
        const next = inner.message;
        if (!next)
            break;
        msg = next;
    }
    return msg;
};
function getFutureProofFull(message) {
    return (message.ephemeralMessage ||
        message.viewOnceMessage ||
        message.documentWithCaptionMessage ||
        message.viewOnceMessageV2 ||
        message.viewOnceMessageV2Extension ||
        message.editedMessage ||
        message.groupMentionedMessage ||
        message.botInvokeMessage ||
        message.lottieStickerMessage ||
        message.eventCoverImage ||
        message.statusMentionMessage ||
        message.pollCreationOptionImageMessage ||
        message.associatedChildMessage ||
        message.groupStatusMentionMessage ||
        message.pollCreationMessageV4 ||
        message.pollCreationMessageV5 ||
        message.statusAddYours ||
        message.groupStatusMessage ||
        message.limitSharingMessage ||
        message.botTaskMessage ||
        message.questionMessage ||
        message.groupStatusMessageV2 ||
        message.botForwardedMessage ||
        undefined);
}
// ── M. Privacy / USyncToken helpers ──────────────────────────────────────────
/**
 * getPrivacyValue — extract a privacy setting value from a Baileys
 * fetchPrivacySettings() result object.
 * Returns the raw string value or undefined.
 */
export const getPrivacyValue = (settings, key) => {
    const s = settings;
    return s?.[key];
};
/**
 * buildReceiptType — determine the correct receipt type string to send
 * based on the user's privacy settings (matching wileys behavior).
 */
export const buildReceiptType = (privacySettings) => {
    const val = getPrivacyValue(privacySettings, 'readreceipts');
    return val === 'all' ? 'read' : 'read-self';
};
//# sourceMappingURL=wileys-utils.js.map