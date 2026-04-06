/**
 * make-wa-socket.ts
 *
 * ════════════════════════════════════════════════════════════════════════════
 * createSocket() — PATCH-ONLY mode (standalone removed)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * BREAKING CHANGE from v10 alpha: standalone mode is removed.
 * apply-patches.ts MUST be run before using createSocket().
 *
 * Rationale:
 *   ‣ Standalone mode gave a false sense of safety — critical fixes like
 *     relayMessage media_id/mediatype and the normalizeMessageContent 23-wrapper
 *     fix REQUIRE source patching to operate correctly at the Baileys core.
 *   ‣ Direct v9 proved the patch-only model is more reliable and predictable.
 *   ‣ This prevents subtle bugs from "I forgot to patch" scenarios in CI/CD.
 *
 * PatchNotAppliedError is thrown at createSocket() call time if the sentinel
 * file (.wileys-v10-patched) is absent from the Baileys root. The sentinel
 * is written by apply-patches.ts.
 *
 * Patches auto-applied by createSocket() at runtime (not source-level):
 *   ✓ patchBaileys()             — LID ev.emit intercept + group cache wiring
 *     optional PN-first incoming fallback via preferPnForIncomingEvents
 *   ✓ initContactStore()         — @lid contact store from events
 *   ✓ injectInteractiveButtons() — sendButtons / sendListMessage / sendInteractive
 *   ✓ patchStatusSend()          — status@broadcast 23-wrapper + media patches
 *   ✓ patchGroupStatusSend()     — @g.us group status V2 send
 *
 * Source patches (applied by apply-patches.ts, verified at startup):
 *   ✓ messages-send.ts replacement  — media_id, album, biz/bot nodes
 *   ✓ normalizeMessageContent       — 23 wrappers replaces rc9's 5
 *   ✓ jid-utils.ts                  — lidToJid + getBotJid
 *   ✓ messages-recv.ts              — msg.key.id cast
 * ════════════════════════════════════════════════════════════════════════════
 */
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, getContentType, downloadMediaMessage, DisconnectReason, } from './baileys-compat.js';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import pino from 'pino';
import { lidToJid, getBotJid, normalizeJid, isJidLid as isLidUser, parseJid, jidToLid, resolveJidSync, areJidsSameUserFull, toJid, isJidBot, } from './utils/jid.js';
import { patchBaileys, resolveLidToPN, resolveLidFull, cacheGroupParticipants, resolveGroupParticipant, resolveGroupParticipantJid, warmupGroupParticipants, getTextFromMessage, normalizeMessageLid, fixHistorySyncParticipant, getSenderLid, getSenderPN, initContactStore, getLidContactJid, } from './patch/wileys-patch.js';
import { patchGroupStatusSend, assertGroupStatusV2Ready, isGroupStatusV2Content, } from './patch/group-status-patch.js';
import { StatusFont, assertColorARGB, getStatusMediaType, FUTURE_PROOF_WRAPPERS, STATUS_JID, patchStatusSend, patchRelayMessageForStatus, patchSendMessageMediaId, normalizeMessageContentFull, patchNormalizeMessageContent, } from './patch/status-patch.js';
import { injectInteractiveButtons, getInteractiveResponse, InteractiveValidationError, validateAndNormalizeButtons, validateAndNormalizeSections, validateAuthoringButtons, btn, } from './patch/interactive-buttons.js';
import { META_AI_JID, OFFICIAL_BIZ_JID, isJidMetaAi as _isJidMetaAi, isJidBotPhone, toJid as _toJidUtils, getSenderLidFull, extractMessageContent, isRealMessage, shouldIncrementChatUnread, getChatId, cleanMessage, fetchLatestWileysVersion, captureEventStream, readAndEmitEventStream, makeInMemoryStore, ALL_WA_PATCH_NAMES, normalizeMessageContentFull as normalizeFullUtils, } from './patch/wileys-utils.js';
// ── Re-exports (complete public surface) ─────────────────────────────────────
// JID utilities
export { lidToJid, getBotJid, normalizeJid, isLidUser as isLidUser, parseJid, jidToLid, resolveJidSync, areJidsSameUserFull, toJid, isJidBot, };
// LID patch
export { patchBaileys, resolveLidToPN, resolveLidFull, cacheGroupParticipants, resolveGroupParticipant, resolveGroupParticipantJid, warmupGroupParticipants, getTextFromMessage, normalizeMessageLid, fixHistorySyncParticipant, getSenderLid, getSenderPN, initContactStore, getLidContactJid, };
// Status
export { StatusFont, assertColorARGB, getStatusMediaType, FUTURE_PROOF_WRAPPERS, STATUS_JID, patchStatusSend, patchRelayMessageForStatus, patchSendMessageMediaId, normalizeMessageContentFull, patchNormalizeMessageContent, };
// Buttons
export { btn, InteractiveValidationError, validateAndNormalizeButtons, validateAndNormalizeSections, validateAuthoringButtons, getInteractiveResponse, injectInteractiveButtons, };
// Wileys utils
export { META_AI_JID, OFFICIAL_BIZ_JID, isJidBotPhone, getSenderLidFull, extractMessageContent, isRealMessage, shouldIncrementChatUnread, getChatId, cleanMessage, fetchLatestWileysVersion, captureEventStream, readAndEmitEventStream, makeInMemoryStore, ALL_WA_PATCH_NAMES, normalizeFullUtils as normalizeMessageContentFull2, _isJidMetaAi as isJidMetaAi, };
// Group Status V2
export { patchGroupStatusSend, assertGroupStatusV2Ready, isGroupStatusV2Content, };
// Baileys utils
export { downloadMediaMessage, getContentType };
// ── Sentinel check ────────────────────────────────────────────────────────────
const SENTINEL_FILENAME = '.wileys-v10-patched';
/**
 * Thrown when createSocket() is called without patches having been applied.
 * Run `npx ts-node apply-patches.ts` from the Baileys root first.
 */
export class PatchNotAppliedError extends Error {
    constructor(baileysRoot) {
        super(`[custom-baileys v10] Patches have not been applied!\n\n` +
            `  Run the patch script from your Baileys root directory:\n\n` +
            `    cd ${baileysRoot}\n` +
            `    npx ts-node /path/to/custom-baileys/apply-patches.ts\n\n` +
            `  Then rebuild Baileys:\n\n` +
            `    npm run build\n\n` +
            `  Patches are required — standalone mode has been removed in v10.\n` +
            `  See GUIDE.md for complete setup instructions.`);
        this.name = 'PatchNotAppliedError';
    }
}
function verifyPatchesApplied(baileysRoot, skipCheck) {
    if (skipCheck)
        return;
    const sentinel = path.join(baileysRoot, SENTINEL_FILENAME);
    if (!fs.existsSync(sentinel)) {
        throw new PatchNotAppliedError(baileysRoot);
    }
    // Read and log patch metadata
    try {
        const meta = JSON.parse(fs.readFileSync(sentinel, 'utf8'));
        console.log(`[custom-baileys v10] ✓ Patches verified` +
            (meta.version ? ` (v${meta.version})` : '') +
            (meta.appliedAt ? ` applied ${meta.appliedAt}` : '') +
            (meta.steps?.length ? ` — ${meta.steps.length} steps` : ''));
    }
    catch { /* sentinel exists but unreadable — proceed */ }
}
// ── CacheStore factory ────────────────────────────────────────────────────────
function makeBaileysCache(stdTTL) {
    const cache = new NodeCache(stdTTL !== undefined ? { stdTTL } : {});
    return {
        get(key) { return cache.get(key); },
        set(key, value) { cache.set(key, value); },
        del(key) { cache.del(key); },
        flushAll() { cache.flushAll(); },
    };
}
// ── Exponential backoff + jitter ──────────────────────────────────────────────
function calcReconnectDelay(attempt, baseMs, maxMs) {
    const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
    const jitter = exp * 0.25 * Math.random();
    return Math.round(exp + jitter);
}
// ── Baileys root resolver (reuse baileys-compat logic) ────────────────────────
function resolveBaileysRootFromDist() {
    const _dir = typeof `${process.platform === 'win32' ? '' : '/'}${/file:\/{2,3}(.+)\/[^/]/.exec(import.meta.url)[1]}` !== 'undefined'
        ? `${process.platform === 'win32' ? '' : '/'}${/file:\/{2,3}(.+)\/[^/]/.exec(import.meta.url)[1]}`
        : dirname(fileURLToPath(import.meta.url));
    // Walk up from dist/ to find Baileys root (has src/Utils/messages.ts)
    let dir = _dir;
    for (let i = 0; i < 6; i++) {
        if (fs.existsSync(path.join(dir, 'src', 'Utils', 'messages.ts')))
            return dir;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    // Fallback: try node_modules siblings
    for (const name of ['@whiskeysockets/baileys', 'baileys', '@adiwajshing/baileys']) {
        try {
            const p = path.dirname(require.resolve(`${name}/package.json`));
            if (fs.existsSync(path.join(p, 'src', 'Utils', 'messages.ts')))
                return p;
        }
        catch { /* try next */ }
    }
    return process.cwd();
}
// ── createSocket ──────────────────────────────────────────────────────────────
/**
 * createSocket — Baileys socket factory.
 *
 * REQUIRES apply-patches.ts to have been run first.
 * All wileys patches are auto-applied at runtime after makeWASocket().
 *
 * @throws {PatchNotAppliedError} if sentinel file is missing and skipPatchCheck is false.
 *
 * @example
 * ```ts
 * import { createSocket } from './custom-baileys/src/make-wa-socket.js'
 *
 * const sock = await createSocket({
 *   sessionName:  'bot',
 *   onQR:         qr => qrcode.generate(qr, { small: true }),
 *   onConnected:  s  => console.log('Connected as', s.user?.id),
 * })
 * sock.ev.on('messages.upsert', ({ messages }) => { ... })
 * ```
 */
export async function createSocket(config = {}) {
    const { sessionName = 'auth_info', autoReconnect = true, reconnectDelayMs = 3000, reconnectMaxDelayMs = 30000, enableGroupCache = true, enableContactStore = true, enableStore = false, preferPnForIncomingEvents = true, skipPatchCheck = false, onQR, onConnected, onDisconnected, logLevel = 'silent', strictButtonValidation = true, ...baileysConfig } = config;
    // ── STEP 0: Verify patches applied ────────────────────────────────────────
    const baileysRoot = resolveBaileysRootFromDist();
    verifyPatchesApplied(baileysRoot, skipPatchCheck);
    const { state, saveCreds } = await useMultiFileAuthState(sessionName);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[custom-baileys v10] WA v${version.join('.')}, isLatest: ${isLatest}`);
    const groupMetaMap = enableGroupCache ? new Map() : undefined;
    const logger = pino({ level: logLevel });
    let reconnectCount = 0;
    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: !onQR,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache: makeBaileysCache(),
        generateHighQualityLinkPreview: true,
        ...(groupMetaMap ? {
            cachedGroupMetadata: async (jid) => groupMetaMap.get(jid),
        } : {}),
        ...baileysConfig,
    });
    // ── Apply runtime patches (order matters) ─────────────────────────────────
    if (enableContactStore)
        initContactStore(sock);
    injectInteractiveButtons(sock, { strictValidation: strictButtonValidation });
    patchStatusSend(sock);
    patchGroupStatusSend(sock);
    // ── Optional store ────────────────────────────────────────────────────────
    const store = enableStore ? makeInMemoryStore() : undefined;
    if (store)
        store.bind(sock.ev);
    // ── Augment socket ────────────────────────────────────────────────────────
    const enhanced = sock;
    if (store)
        enhanced.store = store;
    // JID utilities
    enhanced.lidToJid = lidToJid;
    enhanced.getBotJid = getBotJid;
    enhanced.normalizeJid = normalizeJid;
    enhanced.isLidUser = isLidUser;
    enhanced.parseJid = parseJid;
    enhanced.jidToLid = jidToLid;
    enhanced.resolveJidSync = resolveJidSync;
    enhanced.areJidsSameUserFull = areJidsSameUserFull;
    enhanced.toJid = toJid;
    enhanced.isJidMetaAi = _isJidMetaAi;
    enhanced.isJidBot = isJidBot;
    // LID resolution
    enhanced.resolveLid = (lid) => resolveLidToPN(lid, sock.signalRepository);
    enhanced.resolveLidFull = (lid, groupJid) => resolveLidFull(lid, groupJid, sock.signalRepository);
    enhanced.getSenderLid = getSenderLid;
    enhanced.getSenderLidFull = getSenderLidFull;
    enhanced.getSenderPN = (msg) => getSenderPN(msg, sock.signalRepository);
    enhanced.resolveGroupParticipantJid = resolveGroupParticipantJid;
    enhanced.warmupGroupParticipants = warmupGroupParticipants;
    // Message helpers
    enhanced.sendMessageSafe = async (jid, content, opts) => {
        let resolved = jid;
        if (jid.endsWith('@lid')) {
            resolved = await enhanced.resolveLid(jid);
        }
        else if (isJidBot(jid)) {
            resolved = getBotJid(jid) ?? jid;
        }
        else {
            resolved = normalizeJid(jid) ?? jid;
        }
        return sock.sendMessage(resolved, content, opts);
    };
    enhanced.getMessageText = (msg) => getTextFromMessage(msg);
    enhanced.extractMessageContent = extractMessageContent;
    enhanced.isRealMessage = (msg) => isRealMessage(msg, sock.user?.id ?? '');
    enhanced.fixHistorySyncParticipant = (msg) => fixHistorySyncParticipant(msg);
    enhanced.cleanMessage = cleanMessage;
    enhanced.getChatId = getChatId;
    // ── Event listeners ───────────────────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);
    if (groupMetaMap) {
        sock.ev.on('groups.upsert', async (groups) => {
            for (const g of groups) {
                if (g.id) {
                    groupMetaMap.set(g.id, g);
                    cacheGroupParticipants(g);
                }
            }
        });
        sock.ev.on('groups.update', async (updates) => {
            for (const u of updates) {
                if (!u.id)
                    continue;
                const ex = groupMetaMap.get(u.id);
                const merged = { ...(ex ?? {}), ...u };
                groupMetaMap.set(u.id, merged);
                cacheGroupParticipants(merged);
            }
        });
    }
    else {
        sock.ev.on('groups.upsert', (gs) => gs.forEach(cacheGroupParticipants));
        sock.ev.on('groups.update', (us) => us.forEach(g => { if (g?.participants)
            cacheGroupParticipants(g); }));
    }
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && onQR)
            onQR(qr);
        if (connection === 'open') {
            reconnectCount = 0;
            console.log('[custom-baileys v10] ✅ Connected');
            // Apply LID patch AFTER connection.open — signalRepository now available
            patchBaileys(sock, sock.signalRepository, { preferPnForIncomingEvents });
            onConnected?.(enhanced);
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const reason = String(Object.entries(DisconnectReason)
                .find(([, v]) => v === code)?.[0] ?? `code ${code}`);
            const willReconnect = autoReconnect && code !== DisconnectReason.loggedOut;
            console.log(`[custom-baileys v10] ❌ Disconnected: ${reason}`);
            onDisconnected?.(reason, willReconnect);
            if (willReconnect) {
                reconnectCount++;
                const delay = calcReconnectDelay(reconnectCount, reconnectDelayMs, reconnectMaxDelayMs);
                console.log(`[custom-baileys v10] 🔄 Reconnect #${reconnectCount} in ${delay}ms...`);
                setTimeout(() => createSocket(config), delay);
            }
        }
    });
    return enhanced;
}
//# sourceMappingURL=make-wa-socket.js.map