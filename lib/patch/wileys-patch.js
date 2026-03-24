/**
 * patch/wileys-patch.ts — custom-baileys v10 Enterprise
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ENTERPRISE LID INFRASTRUCTURE — wileys@latest complete port
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Zero source modification required. All patches are runtime ev.emit
 * intercepts and socket monkey-patches applied after makeWASocket() returns.
 *
 * LID Resolution Pipeline (per message, in priority order):
 *   1. SYNC  — node attrs (participant_pn / sender_pn) — set by Baileys recv
 *   2. SYNC  — contactLidStore (populated by contacts.upsert / phoneNumberShare)
 *   3. SYNC  — groupParticipantJidCache (TTL 10 min, wileys-identical)
 *   4. ASYNC — signalRepository.lidMapping.getPNForLID() (authoritative)
 *   5. ASYNC — groupMetadata fetch + cache repopulation (rate-limited 60s)
 *   6. LAST  — naive lidToJid() strip (wrong PN but won't crash)
 *
 * JID CONVERSION — see src/utils/jid.ts for full conversion utilities.
 * This file re-exports the public subset for convenience.
 */
import NodeCache from '@cacheable/node-cache';
// ─── Re-export JID utilities (convenience layer) ──────────────────────────────
export { BOT_MAP, JidDomain, isJidUser, isJidLid, isJidLegacyUser, isJidGroup, isJidBroadcast, isJidStatusBroadcast, isJidNewsletter, isJidBot, isJidUserLike, parseJid, normalizeJid, normalizeJidUser, lidToJid, jidToLid, getBotJid, phoneToBotJid, resolveJidSync, areJidsSameUserFull, encodeJid, toJid, } from '../utils/jid.js';
import { isJidLid as _isLidCheck, normalizeJid as _normalizeJid, lidToJid as _lidToJid, getBotJid as _getBotJid, toJid as _toJid, isJidBot as _isJidBotLocal, BOT_MAP as _BOT_MAP_LOCAL, } from '../utils/jid.js';
// ─── Legacy isLidUser alias ───────────────────────────────────────────────────
export const isLidUser = _isLidCheck;
// ─── Module-level singletons ──────────────────────────────────────────────────
const groupParticipantJidCache = new NodeCache({ stdTTL: 10 * 60 });
const groupMetadataWarmupCache = new NodeCache({ stdTTL: 60 });
const contactLidStore = new Map();
let _groupMetadataFn = null;
// ─── Internal PN normalizer ───────────────────────────────────────────────────
function normalizePN(pn) {
    if (!pn)
        return pn;
    if (pn.endsWith('@s.whatsapp.net') || pn.endsWith('@lid'))
        return pn;
    if (pn.endsWith('@c.us'))
        return pn.replace('@c.us', '@s.whatsapp.net');
    return `${pn}@s.whatsapp.net`;
}
// ─── Public accessors ─────────────────────────────────────────────────────────
export const getLidContactJid = (lid) => contactLidStore.get(lid);
/**
 * getSenderLid — extract the @lid identifier from a message key.
 * Returns the raw participant/remoteJid value if it ends in @lid,
 * otherwise re-encodes the user part to @lid form.
 */
export const getSenderLid = (msg) => {
    const key = msg.key;
    const raw = (key?.participant ?? key?.remoteJid);
    if (!raw)
        return undefined;
    if (raw.endsWith('@lid'))
        return raw;
    const user = raw.split('@')[0];
    return user ? `${user}@lid` : undefined;
};
/**
 * getSenderPN — resolve the phone-number JID for a message sender.
 * Full async pipeline: contact store → group cache → signalRepository.
 */
export const getSenderPN = async (msg, repo) => {
    const key = msg.key;
    const remoteJid = (key?.remoteJid ?? '');
    const isGroup = remoteJid.endsWith('@g.us');
    const participant = (key?.participant ?? (!isGroup ? remoteJid : ''));
    if (!participant)
        return remoteJid;
    if (participant.endsWith('@lid')) {
        const gJid = isGroup ? remoteJid : undefined;
        const res = await resolveLidFull(participant, gJid, repo);
        return res.jid;
    }
    return normalizePN(participant);
};
// ─── Contact store ────────────────────────────────────────────────────────────
/**
 * initContactStore — wire ev listeners to populate contactLidStore.
 * Must be called before connection.open.
 */
export const initContactStore = (sock) => {
    const ev = sock.ev;
    ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
            if (c.id?.endsWith('@lid') && c.jid)
                contactLidStore.set(c.id, normalizePN(c.jid));
            if (c.lid && c.id && !c.id.endsWith('@lid')) {
                const lid = c.lid.endsWith('@lid') ? c.lid : `${c.lid}@lid`;
                contactLidStore.set(lid, normalizePN(c.id));
            }
        }
    });
    ev.on('contacts.update', (updates) => {
        for (const u of updates) {
            if (u.id?.endsWith('@lid') && u.jid)
                contactLidStore.set(u.id, normalizePN(u.jid));
            if (u.lid && u.id && !u.id.endsWith('@lid')) {
                const lid = u.lid.endsWith('@lid') ? u.lid : `${u.lid}@lid`;
                contactLidStore.set(lid, normalizePN(u.id));
            }
        }
    });
    ev.on('chats.phoneNumberShare', (data) => {
        const d = data;
        if (d?.lid && d?.jid) {
            const lid = d.lid.endsWith('@lid') ? d.lid : `${d.lid}@lid`;
            contactLidStore.set(lid, normalizePN(d.jid));
        }
    });
};
// ─── Group participant cache ──────────────────────────────────────────────────
/**
 * cacheGroupParticipants — populate TTL cache from GroupMetadata.
 * Handles both pn-addressed (wileys) and lid-addressed groups.
 * participant.jid or participant.phone_number = real PN,
 * participant.id may be @lid in LID-addressed groups.
 */
export const cacheGroupParticipants = (group) => {
    if (!group?.id || !Array.isArray(group.participants))
        return;
    for (const p of group.participants) {
        const lid = p.id;
        const realJid = _normalizeJid(p.jid ??
            p.phone_number ??
            lid);
        if (lid && realJid && lid !== realJid) {
            groupParticipantJidCache.set(`${group.id}|${lid}`, realJid);
        }
    }
};
export const resolveGroupParticipant = (groupJid, lid) => {
    if (!groupJid || !lid)
        return undefined;
    return groupParticipantJidCache.get(`${groupJid}|${lid}`);
};
/**
 * resolveGroupParticipantJid — async lookup with rate-limited warmup.
 */
export const resolveGroupParticipantJid = async (groupJid, lid) => {
    const cached = resolveGroupParticipant(groupJid, lid);
    if (cached)
        return cached;
    const warmupKey = `warmup:${groupJid}`;
    if (_groupMetadataFn && !groupMetadataWarmupCache.has(warmupKey)) {
        groupMetadataWarmupCache.set(warmupKey, true);
        try {
            const meta = await _groupMetadataFn(groupJid);
            cacheGroupParticipants(meta);
        }
        catch { /* network error — warmup failed */ }
    }
    return resolveGroupParticipant(groupJid, lid);
};
/**
 * warmupGroupParticipants — pre-populate cache for a list of groups.
 */
export const warmupGroupParticipants = async (groupJids) => {
    if (!_groupMetadataFn)
        return;
    await Promise.allSettled(groupJids.map(async (jid) => {
        try {
            const meta = await _groupMetadataFn(jid);
            cacheGroupParticipants(meta);
        }
        catch { /* skip */ }
    }));
};
// ─── LID resolution ───────────────────────────────────────────────────────────
/**
 * resolveLidToPN — async @lid → real phone JID via signalRepository.
 *
 * Uses wileys LID mapping: repo.lidMapping.getPNForLID() (when available).
 * Falls back to naive lidToJid() if repo is absent.
 */
export const resolveLidToPN = async (lid, repo) => {
    if (!lid.endsWith('@lid'))
        return normalizePN(lid);
    // 1 — signalRepository authoritative path
    if (repo) {
        try {
            const mapping = repo.lidMapping;
            if (typeof mapping?.getPNForLID === 'function') {
                const user = lid.split('@')[0];
                const pn = await mapping.getPNForLID(user);
                if (pn)
                    return normalizePN(pn);
            }
        }
        catch { /* fall through */ }
    }
    // 2 — naive strip (wrong PN but won't crash)
    return _lidToJid(lid) ?? lid;
};
/**
 * resolveLidFull — full multi-tier resolution for one @lid JID.
 *
 * Tier order:
 *   contactLidStore → groupParticipantJidCache → signalRepository → naive
 */
export async function resolveLidFull(lid, groupJid, repo) {
    if (!lid.endsWith('@lid')) {
        return { jid: normalizePN(lid), via: 'passthrough', lid };
    }
    // Tier 1 — contact store
    const fromStore = getLidContactJid(lid);
    if (fromStore)
        return { jid: fromStore, via: 'contact_store', lid };
    // Tier 2 — group participant cache
    if (groupJid) {
        const fromCache = resolveGroupParticipant(groupJid, lid);
        if (fromCache)
            return { jid: fromCache, via: 'group_cache', lid };
    }
    // Tier 3 — signalRepository
    const fromRepo = await resolveLidToPN(lid, repo);
    const naiveLid = (_lidToJid(lid) ?? lid);
    if (fromRepo && fromRepo !== naiveLid)
        return { jid: fromRepo, via: 'signal_repo', lid };
    // Tier 4 — group warmup + retry
    if (groupJid) {
        const fromWarmup = await resolveGroupParticipantJid(groupJid, lid);
        if (fromWarmup)
            return { jid: fromWarmup, via: 'group_warmup', lid };
    }
    // Tier 5 — naive strip (last resort)
    return { jid: naiveLid, via: 'naive', lid };
}
// ─── Meta AI predicate — isJidBot + BOT_MAP phone check ──────────────────────
/**
 * isJidMetaAi — true if jid is any Meta AI @bot address present in BOT_MAP.
 * (BOT_MAP user part → phone 13135550002 is the primary Meta AI entry, but all
 *  bot JIDs in BOT_MAP are Meta AI bots so we check BOT_MAP membership.)
 */
export const isJidMetaAi = (jid) => {
    if (!_isJidBotLocal(jid))
        return false;
    const user = jid.split('@')[0] ?? '';
    return _BOT_MAP_LOCAL.has(user);
};
// ─── Context info LID normalizer ─────────────────────────────────────────────
const CTX_MSG_TYPES = [
    'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage',
    'stickerMessage', 'extendedTextMessage', 'contactMessage',
    'locationMessage', 'listMessage', 'buttonsMessage', 'interactiveMessage',
    'pollCreationMessage', 'pollCreationMessageV2', 'pollCreationMessageV3',
];
async function resolveCtxInfo(ctx, groupJid, repo) {
    if (!ctx)
        return;
    const mentionedJid = ctx.mentionedJid;
    if (Array.isArray(mentionedJid)) {
        ctx.mentionedJid = await Promise.all(mentionedJid.map(async (j) => {
            if (!j.endsWith('@lid'))
                return j;
            return (await resolveLidFull(j, groupJid, repo)).jid;
        }));
    }
    const quotedStanza = ctx.quotedMessage;
    if (quotedStanza) {
        for (const t of CTX_MSG_TYPES) {
            const inner = quotedStanza[t];
            if (inner?.contextInfo)
                await resolveCtxInfo(inner.contextInfo, groupJid, repo);
        }
    }
}
/**
 * normalizeMessageLid — recursively resolve all @lid references in a message.
 */
export async function normalizeMessageLid(msg, repo, groupJid) {
    if (!msg)
        return msg;
    const key = msg.key;
    if (!key)
        return msg;
    const effectiveGroup = groupJid ??
        (typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@g.us') ? key.remoteJid : undefined);
    // key.participant @lid (group message sender)
    if (typeof key.participant === 'string' && key.participant.endsWith('@lid')) {
        const sync = resolveGroupParticipant(effectiveGroup ?? '', key.participant)
            ?? getLidContactJid(key.participant);
        key.participant = sync ?? (await resolveLidFull(key.participant, effectiveGroup, repo)).jid;
    }
    // key.remoteJid @lid (private DM with LID-migrated contact)
    if (typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@lid')) {
        key.remoteJid = getLidContactJid(key.remoteJid)
            ?? (await resolveLidFull(key.remoteJid, undefined, repo)).jid;
    }
    const message = msg.message;
    if (!message)
        return msg;
    for (const t of CTX_MSG_TYPES) {
        await resolveCtxInfo(message[t]?.contextInfo, effectiveGroup, repo);
    }
    // viewOnce wrappers
    for (const wrap of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
        const inner = message[wrap];
        if (!inner?.message)
            continue;
        const m = inner.message;
        for (const t of ['imageMessage', 'videoMessage']) {
            await resolveCtxInfo(m[t]?.contextInfo, effectiveGroup, repo);
        }
    }
    // groupStatusMessageV2 inner message
    const gsm2 = message.groupStatusMessageV2?.message;
    if (gsm2) {
        for (const t of CTX_MSG_TYPES) {
            await resolveCtxInfo(gsm2[t]?.contextInfo, effectiveGroup, repo);
        }
    }
    return msg;
}
/**
 * fixHistorySyncParticipant — fix 3 known Baileys rc9 history sync bugs.
 *
 *  BUG 1: participant set to groupJid itself
 *  BUG 2: participant is @lid in cached messages
 *  BUG 3: remoteJid is @lid for LID-migrated contacts
 */
export async function fixHistorySyncParticipant(msg, repo) {
    if (!msg?.key)
        return msg;
    const key = msg.key;
    const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
    const isGroup = remoteJid.endsWith('@g.us');
    if (isGroup && typeof key.participant === 'string' &&
        (key.participant === remoteJid || key.participant.endsWith('@g.us'))) {
        key.participant = undefined;
    }
    if ((typeof key.participant === 'string' && key.participant.endsWith('@lid')) ||
        (typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@lid'))) {
        await normalizeMessageLid(msg, repo, isGroup ? remoteJid : undefined);
    }
    else if (isGroup && key.participant) {
        await normalizeMessageLid(msg, repo, remoteJid);
    }
    return msg;
}
// ─── Text extraction ──────────────────────────────────────────────────────────
export const getTextFromMessage = (msg) => {
    if (!msg?.message)
        return undefined;
    const m = msg.message;
    return (m.conversation ??
        m.extendedTextMessage?.text ??
        m.imageMessage?.caption ??
        m.videoMessage?.caption ??
        m.documentMessage?.caption ??
        m.buttonsResponseMessage?.selectedDisplayText ??
        m.listResponseMessage?.title ??
        m.interactiveResponseMessage?.body ??
        undefined);
};
// ─── Main patch ───────────────────────────────────────────────────────────────
/**
 * patchBaileys — apply all LID enterprise patches to a live Baileys socket.
 *
 * Call this AFTER connection.open so signalRepository is available.
 * All patches are idempotent — safe to call on reconnect.
 */
export const patchBaileys = (sock, signalRepository) => {
    const repo = signalRepository ??
        sock.signalRepository ?? null;
    if (typeof sock.groupMetadata === 'function') {
        _groupMetadataFn = sock.groupMetadata.bind(sock);
    }
    if (sock.__wileysPatchedV10)
        return;
    sock.__wileysPatchedV10 = true;
    const evObj = sock.ev;
    const originalEmit = evObj.emit.bind(evObj);
    evObj.emit = (...args) => {
        const [event, data, ...rest] = args;
        // ── Live messages ─────────────────────────────────────────────────────
        if (event === 'messages.upsert') {
            const d = data;
            if (Array.isArray(d?.messages)) {
                // SYNC pass — instant cache lookups
                d.messages = d.messages.map(msg => {
                    const key = msg.key;
                    if (!key)
                        return msg;
                    if (typeof key.participant === 'string' && key.participant.endsWith('@lid')) {
                        const gJid = typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@g.us')
                            ? key.remoteJid : undefined;
                        const sync = (gJid ? resolveGroupParticipant(gJid, key.participant) : undefined)
                            ?? getLidContactJid(key.participant);
                        if (sync)
                            key.participant = sync;
                    }
                    if (typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@lid')) {
                        const fromStore = getLidContactJid(key.remoteJid);
                        if (fromStore)
                            key.remoteJid = fromStore;
                    }
                    return msg;
                });
                // ASYNC pass — signalRepository + group warmup
                Promise.all(d.messages.map(async (msg) => {
                    const key = msg.key;
                    const gJid = typeof key?.remoteJid === 'string' && key.remoteJid.endsWith('@g.us')
                        ? key.remoteJid : undefined;
                    if (gJid && typeof key?.participant === 'string' && key.participant.endsWith('@lid')) {
                        const resolved = await resolveGroupParticipantJid(gJid, key.participant);
                        if (resolved)
                            key.participant = resolved;
                    }
                    return normalizeMessageLid(msg, repo, gJid);
                })).then(fixed => { d.messages = fixed; }).catch(() => { });
            }
        }
        // ── History sync ──────────────────────────────────────────────────────
        if (event === 'messaging-history.set') {
            const d = data;
            if (Array.isArray(d?.messages)) {
                for (const msg of d.messages) {
                    const key = msg.key;
                    if (!key)
                        continue;
                    const rj = typeof key.remoteJid === 'string' ? key.remoteJid : '';
                    const isGroup = rj.endsWith('@g.us');
                    if (isGroup && typeof key.participant === 'string' &&
                        (key.participant === rj || key.participant.endsWith('@g.us'))) {
                        key.participant = undefined;
                    }
                    if (isGroup && typeof key.participant === 'string' && key.participant.endsWith('@lid')) {
                        const cached = resolveGroupParticipant(rj, key.participant)
                            ?? getLidContactJid(key.participant);
                        if (cached)
                            key.participant = cached;
                    }
                    if (typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@lid')) {
                        const fromStore = getLidContactJid(key.remoteJid);
                        if (fromStore)
                            key.remoteJid = fromStore;
                    }
                }
                Promise.all(d.messages.map(m => fixHistorySyncParticipant(m, repo))).catch(() => { });
            }
        }
        return originalEmit(event, data, ...rest);
    };
    evObj.on('groups.upsert', (gs) => gs.forEach(cacheGroupParticipants));
    evObj.on('groups.update', (us) => us.forEach(g => { if (g?.participants)
        cacheGroupParticipants(g); }));
    console.log('[wileys-patch v10] LID enterprise patch active ✓');
    if (!repo)
        console.warn('[wileys-patch v10] ⚠  signalRepository unavailable — call after connection.open');
    if (!_groupMetadataFn)
        console.warn('[wileys-patch v10] ⚠  sock.groupMetadata not found — async warmup disabled');
};
//# sourceMappingURL=wileys-patch.js.map