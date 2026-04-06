/**
 * patch/wileys-patch.ts
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LID INFRASTRUCTURE — wileys@latest complete port
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
import { isJidLid as _isLidCheck, normalizeJid as _normalizeJid, lidToJid as _lidToJid, jidToLid as _jidToLid, getBotJid as _getBotJid, toJid as _toJid, isJidBot as _isJidBotLocal, BOT_MAP as _BOT_MAP_LOCAL, } from '../utils/jid.js';
// ─── Legacy isLidUser alias ───────────────────────────────────────────────────
export const isLidUser = _isLidCheck;
// ─── Module-level singletons ──────────────────────────────────────────────────
const groupParticipantJidCache = new NodeCache({ stdTTL: 10 * 60 });
const groupMetadataWarmupCache = new NodeCache({ stdTTL: 60 });
const contactLidStore = new Map();
const maskedLidStore = new Map();
let _groupMetadataFn = null;
let _selfPnJid;
let _selfLidJid;
// ─── Internal PN normalizer ───────────────────────────────────────────────────
function normalizePN(pn) {
    if (!pn)
        return pn;
    if (pn.endsWith('@s.whatsapp.net') ||
        pn.endsWith('@hosted') ||
        pn.endsWith('@lid') ||
        pn.endsWith('@hosted.lid'))
        return pn;
    if (pn.endsWith('@c.us'))
        return pn.replace('@c.us', '@s.whatsapp.net');
    return `${pn}@s.whatsapp.net`;
}
const isHostedLidJid = (jid) => typeof jid === 'string' && jid.endsWith('@hosted.lid');
const isAnyLidJid = (jid) => _isLidCheck(jid) || isHostedLidJid(jid);
const ensureLidJid = (jid) => isAnyLidJid(jid) ? jid : `${jid}@lid`;
const getDerivedLidJid = (jid) => {
    if (typeof jid !== 'string' || jid.length === 0)
        return undefined;
    if (isAnyLidJid(jid))
        return jid;
    if (jid.endsWith('@hosted'))
        return jid.replace('@hosted', '@hosted.lid');
    return _jidToLid(jid) ?? undefined;
};
const getMaskedCacheKey = (jid) => {
    const value = typeof jid === 'string' ? jid : undefined;
    if (!value || value.length === 0)
        return undefined;
    if (value.endsWith('@hosted.lid'))
        return value.replace('@hosted.lid', '@hosted');
    if (value.endsWith('@lid'))
        return value.replace('@lid', '@s.whatsapp.net');
    if (value.endsWith('@s.whatsapp.net') || value.endsWith('@hosted'))
        return value;
    return undefined;
};
const naiveLidToPn = (jid) => isHostedLidJid(jid)
    ? jid.replace('@hosted.lid', '@hosted')
    : (_lidToJid(jid) ?? jid);
const asNonEmptyString = (value) => typeof value === 'string' && value.length > 0 ? value : undefined;
const getJidUser = (jid) => {
    if (typeof jid !== 'string' || jid.length === 0)
        return undefined;
    const atIdx = jid.indexOf('@');
    if (atIdx <= 0)
        return undefined;
    return jid.slice(0, atIdx);
};
const getPreferredPnFromAlt = (value) => {
    const jid = asNonEmptyString(value);
    if (!jid || isAnyLidJid(jid))
        return undefined;
    return normalizePN(jid);
};
const rememberLidPnPair = (lid, pn) => {
    if (!lid || !pn || !isAnyLidJid(lid))
        return;
    const normalizedPn = normalizePN(pn);
    contactLidStore.set(lid, normalizedPn);
    const maskedKey = getMaskedCacheKey(lid);
    if (maskedKey && maskedKey !== normalizedPn) {
        maskedLidStore.set(maskedKey, normalizedPn);
    }
};
const rememberMaskedPnPair = (candidate, pn) => {
    if (!candidate || !pn)
        return;
    const normalizedPn = normalizePN(pn);
    const maskedKey = getMaskedCacheKey(candidate);
    if (!maskedKey || maskedKey === normalizedPn)
        return;
    maskedLidStore.set(maskedKey, normalizedPn);
};
const getMaskedPnJid = (jid) => {
    const maskedKey = getMaskedCacheKey(jid);
    return maskedKey ? maskedLidStore.get(maskedKey) : undefined;
};
const getKnownPnForIdentitySync = (jid, groupJid) => {
    if (!jid)
        return undefined;
    const fromGroupCache = groupJid ? resolveGroupParticipant(groupJid, jid) : undefined;
    if (fromGroupCache)
        return normalizePN(fromGroupCache);
    const fromMaskedCache = getMaskedPnJid(jid);
    if (fromMaskedCache)
        return normalizePN(fromMaskedCache);
    if (isAnyLidJid(jid)) {
        const fromContactStore = getLidContactJid(jid);
        if (fromContactStore)
            return normalizePN(fromContactStore);
    }
    return undefined;
};
const rememberKeyPnMappings = (key) => {
    const participantPn = getPreferredPnFromAlt(key.participantAlt);
    const remotePn = getPreferredPnFromAlt(key.remoteJidAlt);
    rememberLidPnPair(asNonEmptyString(key.participant), participantPn);
    rememberLidPnPair(asNonEmptyString(key.remoteJid), remotePn);
    rememberMaskedPnPair(asNonEmptyString(key.participant), participantPn);
    rememberMaskedPnPair(asNonEmptyString(key.remoteJid), remotePn);
};
const fixBogusGroupParticipantSync = (key) => {
    const remoteJid = asNonEmptyString(key.remoteJid);
    const participant = asNonEmptyString(key.participant);
    if (!remoteJid?.endsWith('@g.us') || !participant)
        return;
    if (participant !== remoteJid && !participant.endsWith('@g.us'))
        return;
    const participantPn = getPreferredPnFromAlt(key.participantAlt);
    if (participantPn) {
        key.participant = participantPn;
        return;
    }
    if (key.fromMe === true) {
        key.participant = _selfPnJid ?? _selfLidJid ?? key.participant;
        return;
    }
    key.participant = undefined;
};
const getPreferredPnForKeyFieldSync = (key, field) => {
    const altField = field === 'participant' ? 'participantAlt' : 'remoteJidAlt';
    const altPn = getPreferredPnFromAlt(key[altField]);
    if (altPn)
        return altPn;
    const value = asNonEmptyString(key[field]);
    const groupJid = field === 'participant' &&
        typeof key.remoteJid === 'string' &&
        key.remoteJid.endsWith('@g.us')
        ? key.remoteJid
        : undefined;
    const knownPn = getKnownPnForIdentitySync(value, groupJid);
    if (knownPn)
        return knownPn;
    if (!value || !isAnyLidJid(value))
        return undefined;
    return undefined;
};
const applyPreferredPnToMessageKeySync = (key) => {
    rememberKeyPnMappings(key);
    fixBogusGroupParticipantSync(key);
    const participantPn = getPreferredPnForKeyFieldSync(key, 'participant');
    if (participantPn)
        key.participant = participantPn;
    const remotePn = getPreferredPnForKeyFieldSync(key, 'remoteJid');
    if (remotePn)
        key.remoteJid = remotePn;
};
const hoistRootParticipantToKeySync = (message) => {
    const key = message.key;
    if (!key)
        return undefined;
    const remoteJid = asNonEmptyString(key.remoteJid);
    if (!remoteJid || (remoteJid !== 'status@broadcast' && !remoteJid.endsWith('@g.us'))) {
        return key;
    }
    const rootParticipant = asNonEmptyString(message.participant);
    const keyParticipant = asNonEmptyString(key.participant);
    const preferredParticipant = rootParticipant ?? keyParticipant;
    if (rootParticipant) {
        delete message.participant;
    }
    if (!preferredParticipant)
        return key;
    key.participant = preferredParticipant;
    return key;
};
const getMessageKeyFromChatEntry = (entry) => {
    if (!entry || typeof entry !== 'object')
        return undefined;
    const record = entry;
    if (record.key && typeof record.key === 'object') {
        hoistRootParticipantToKeySync(record);
        return record.key;
    }
    const nested = record.message;
    if (nested && typeof nested === 'object') {
        const nestedRecord = nested;
        hoistRootParticipantToKeySync(nestedRecord);
        const nestedKey = nestedRecord.key;
        if (nestedKey && typeof nestedKey === 'object') {
            return nestedKey;
        }
    }
    return undefined;
};
const applyPreferredPnToChatSync = (chat) => {
    const currentId = asNonEmptyString(chat.id);
    if (!currentId)
        return;
    const firstEntry = Array.isArray(chat.messages) ? chat.messages[0] : undefined;
    const firstKey = getMessageKeyFromChatEntry(firstEntry);
    if (firstKey)
        applyPreferredPnToMessageKeySync(firstKey);
    if (currentId === 'status@broadcast') {
        if (firstKey?.fromMe === true)
            return;
        const senderPn = getPreferredPnFromAlt(firstKey?.participantAlt)
            ?? getKnownPnForIdentitySync(asNonEmptyString(firstKey?.participant))
            ?? asNonEmptyString(firstKey?.participant);
        if (senderPn && !isAnyLidJid(senderPn)) {
            chat.id = normalizePN(senderPn);
        }
        return;
    }
    const currentKnownPn = getKnownPnForIdentitySync(currentId);
    if (!isAnyLidJid(currentId) && !currentKnownPn)
        return;
    const preferredPn = asNonEmptyString(chat.pnJid)
        ?? asNonEmptyString(chat.phoneNumber)
        ?? getPreferredPnFromAlt(chat.jid)
        ?? asNonEmptyString(chat.jid)
        ?? currentKnownPn
        ?? getPreferredPnFromAlt(firstKey?.remoteJidAlt)
        ?? getKnownPnForIdentitySync(asNonEmptyString(firstKey?.remoteJid))
        ?? asNonEmptyString(firstKey?.remoteJid);
    if (preferredPn) {
        const derivedLid = isAnyLidJid(currentId) ? currentId : getDerivedLidJid(currentId);
        if (!asNonEmptyString(chat.lidJid) && derivedLid) {
            chat.lidJid = derivedLid;
        }
        chat.id = normalizePN(preferredPn);
    }
};
const applyPreferredPnToContactSync = (contact) => {
    const currentId = asNonEmptyString(contact.id);
    if (!currentId)
        return;
    const currentKnownPn = getKnownPnForIdentitySync(currentId);
    const explicitContactLid = asNonEmptyString(contact.lid)
        ?? asNonEmptyString(contact.accountLid);
    const derivedCurrentLid = explicitContactLid
        ?? (isAnyLidJid(currentId) ? currentId : getDerivedLidJid(currentId));
    const contactPn = getPreferredPnFromAlt(contact.jid)
        ?? asNonEmptyString(contact.jid)
        ?? asNonEmptyString(contact.phoneNumber)
        ?? currentKnownPn
        ?? (!isAnyLidJid(currentId) ? normalizePN(currentId) : undefined);
    const contactLid = derivedCurrentLid;
    rememberLidPnPair(contactLid, contactPn);
    rememberMaskedPnPair(currentId, contactPn);
    if (!isAnyLidJid(currentId) && !currentKnownPn)
        return;
    const preferredPn = contactPn
        ?? currentKnownPn
        ?? getKnownPnForIdentitySync(currentId);
    if (preferredPn) {
        if (!asNonEmptyString(contact.lid) && derivedCurrentLid) {
            contact.lid = derivedCurrentLid;
        }
        const normalized = normalizePN(preferredPn);
        contact.id = normalized;
        if (!asNonEmptyString(contact.jid)) {
            contact.jid = normalized;
        }
    }
};
const getPreferredPnForJidSync = (jid, groupJid) => {
    const value = asNonEmptyString(jid);
    if (!value)
        return undefined;
    const knownPn = getKnownPnForIdentitySync(value, groupJid);
    if (knownPn)
        return knownPn;
    if (!isAnyLidJid(value)) {
        if (value.endsWith('@s.whatsapp.net') ||
            value.endsWith('@hosted') ||
            value.endsWith('@c.us')) {
            return normalizePN(value);
        }
        return undefined;
    }
    return undefined;
};
const applyPreferredPnToMessageLikeSync = (messageLike) => {
    const key = messageLike.key;
    if (key)
        applyPreferredPnToMessageKeySync(key);
};
const applyPreferredPnToReactionSync = (entry) => {
    applyPreferredPnToMessageLikeSync(entry);
    const reaction = entry.reaction;
    const reactionKey = reaction?.key;
    if (reactionKey)
        applyPreferredPnToMessageKeySync(reactionKey);
};
const applyPreferredPnToReceiptSync = (entry) => {
    applyPreferredPnToMessageLikeSync(entry);
    const key = entry.key;
    const groupJid = typeof key?.remoteJid === 'string' && key.remoteJid.endsWith('@g.us')
        ? key.remoteJid
        : undefined;
    const receipt = entry.receipt;
    const userPn = getPreferredPnForJidSync(receipt?.userJid, groupJid);
    if (receipt && userPn) {
        receipt.userJid = userPn;
    }
};
const applyPreferredPnToGroupParticipantSync = (participant, groupJid) => {
    const currentId = asNonEmptyString(participant.id);
    if (!currentId)
        return;
    const currentKnownPn = getPreferredPnForJidSync(currentId, groupJid);
    const derivedCurrentLid = (isAnyLidJid(currentId) ? currentId : getDerivedLidJid(currentId))
        ?? asNonEmptyString(participant.lid);
    const preferredPn = getPreferredPnFromAlt(participant.jid)
        ?? asNonEmptyString(participant.jid)
        ?? asNonEmptyString(participant.phone_number)
        ?? currentKnownPn;
    rememberLidPnPair(derivedCurrentLid, preferredPn);
    rememberMaskedPnPair(currentId, preferredPn);
    if ((!isAnyLidJid(currentId) && !currentKnownPn) || !preferredPn)
        return;
    if (!asNonEmptyString(participant.lid) && derivedCurrentLid) {
        participant.lid = derivedCurrentLid;
    }
    participant.id = preferredPn;
    if (!asNonEmptyString(participant.jid)) {
        participant.jid = preferredPn;
    }
};
const applyPreferredPnToGroupUpdateSync = (group) => {
    const groupJid = asNonEmptyString(group.id);
    const authorPn = getPreferredPnFromAlt(group.authorPn)
        ?? getPreferredPnForJidSync(group.author, groupJid);
    if (authorPn) {
        group.author = authorPn;
    }
    const ownerPn = getPreferredPnFromAlt(group.ownerPn)
        ?? getPreferredPnForJidSync(group.owner, groupJid);
    if (ownerPn) {
        group.owner = ownerPn;
    }
    if (Array.isArray(group.participants)) {
        for (const participant of group.participants) {
            applyPreferredPnToGroupParticipantSync(participant, groupJid);
        }
    }
};
const applyPreferredPnToGroupParticipantsEventSync = (eventData) => {
    const groupJid = asNonEmptyString(eventData.id) ?? asNonEmptyString(eventData.jid);
    const authorPn = getPreferredPnFromAlt(eventData.authorPn)
        ?? getPreferredPnForJidSync(eventData.author, groupJid);
    if (authorPn) {
        eventData.author = authorPn;
    }
    if (Array.isArray(eventData.participants)) {
        for (const participant of eventData.participants) {
            applyPreferredPnToGroupParticipantSync(participant, groupJid);
        }
    }
};
const applyPreferredPnToJoinRequestSync = (eventData) => {
    const groupJid = asNonEmptyString(eventData.id) ?? asNonEmptyString(eventData.jid);
    const authorPn = getPreferredPnFromAlt(eventData.authorPn)
        ?? getPreferredPnForJidSync(eventData.author, groupJid);
    if (authorPn) {
        eventData.author = authorPn;
    }
    const participantPn = getPreferredPnFromAlt(eventData.participantPn)
        ?? getPreferredPnForJidSync(eventData.participant, groupJid);
    if (participantPn) {
        eventData.participant = participantPn;
    }
};
// ─── Public accessors ─────────────────────────────────────────────────────────
export const getLidContactJid = (lid) => contactLidStore.get(lid);
/**
 * getSenderLid — extract the @lid identifier from a message key.
 * Returns the raw participant/remoteJid value if it ends in @lid,
 * otherwise re-encodes the user part to @lid form.
 */
export const getSenderLid = (msg) => {
    const key = msg.key;
    const rawValue = asNonEmptyString(key?.participant) ?? asNonEmptyString(key?.remoteJid);
    if (typeof rawValue !== 'string' || rawValue.length === 0)
        return undefined;
    if (isAnyLidJid(rawValue))
        return rawValue;
    const user = getJidUser(rawValue);
    return user ? `${user}@lid` : undefined;
};
/**
 * getSenderPN — resolve the phone-number JID for a message sender.
 * Full async pipeline: contact store → group cache → signalRepository.
 */
export const getSenderPN = async (msg, repo) => {
    const key = msg.key;
    const remoteJid = asNonEmptyString(key?.remoteJid) ?? '';
    const isGroup = remoteJid.endsWith('@g.us');
    const participant = asNonEmptyString(key?.participant) ?? (!isGroup ? remoteJid : '');
    if (!participant)
        return remoteJid;
    const knownPn = getPreferredPnForJidSync(participant, isGroup ? remoteJid : undefined);
    if (knownPn)
        return knownPn;
    if (isAnyLidJid(participant)) {
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
            if (c.id && isAnyLidJid(c.id) && c.jid)
                contactLidStore.set(c.id, normalizePN(c.jid));
            if (c.lid && c.id && !isAnyLidJid(c.id)) {
                const lid = ensureLidJid(c.lid);
                contactLidStore.set(lid, normalizePN(c.id));
            }
            if (c.id && c.jid) {
                rememberMaskedPnPair(c.id, c.jid);
            }
        }
    });
    ev.on('contacts.update', (updates) => {
        for (const u of updates) {
            if (u.id && isAnyLidJid(u.id) && u.jid)
                contactLidStore.set(u.id, normalizePN(u.jid));
            if (u.lid && u.id && !isAnyLidJid(u.id)) {
                const lid = ensureLidJid(u.lid);
                contactLidStore.set(lid, normalizePN(u.id));
            }
            if (u.id && u.jid) {
                rememberMaskedPnPair(u.id, u.jid);
            }
        }
    });
    ev.on('chats.phoneNumberShare', (data) => {
        const d = data;
        if (d?.lid && d?.jid) {
            const lid = ensureLidJid(d.lid);
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
            const maskedKey = getMaskedCacheKey(lid);
            if (maskedKey && maskedKey !== realJid) {
                groupParticipantJidCache.set(`${group.id}|${maskedKey}`, realJid);
            }
            rememberMaskedPnPair(lid, realJid);
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
    if (!isAnyLidJid(lid))
        return normalizePN(lid);
    // 1 — signalRepository authoritative path
    if (repo) {
        try {
            const mapping = repo.lidMapping;
            if (typeof mapping?.getPNForLID === 'function') {
                const pn = await mapping.getPNForLID(lid);
                if (pn)
                    return normalizePN(pn);
            }
        }
        catch { /* fall through */ }
    }
    // 2 — naive strip (wrong PN but won't crash)
    return naiveLidToPn(lid);
};
/**
 * resolveLidFull — full multi-tier resolution for one @lid JID.
 *
 * Tier order:
 *   contactLidStore → groupParticipantJidCache → signalRepository → naive
 */
export async function resolveLidFull(lid, groupJid, repo) {
    if (!isAnyLidJid(lid)) {
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
    const naiveLid = naiveLidToPn(lid);
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
    const user = getJidUser(jid);
    return typeof user === 'string' && _BOT_MAP_LOCAL.has(user);
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
            if (!isAnyLidJid(j))
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
    if (typeof key.participant === 'string' && isAnyLidJid(key.participant)) {
        const sync = resolveGroupParticipant(effectiveGroup ?? '', key.participant)
            ?? getLidContactJid(key.participant);
        key.participant = sync ?? (await resolveLidFull(key.participant, effectiveGroup, repo)).jid;
    }
    // key.remoteJid @lid (private DM with LID-migrated contact)
    if (typeof key.remoteJid === 'string' && isAnyLidJid(key.remoteJid)) {
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
    const participant = asNonEmptyString(key.participant);
    const isGroup = remoteJid.endsWith('@g.us');
    if (isGroup) {
        fixBogusGroupParticipantSync(key);
    }
    if ((typeof key.participant === 'string' && isAnyLidJid(key.participant)) ||
        (typeof key.remoteJid === 'string' && isAnyLidJid(key.remoteJid))) {
        await normalizeMessageLid(msg, repo, isGroup ? remoteJid : undefined);
    }
    else if (isGroup && typeof key.participant === 'string') {
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
 * patchBaileys — apply all LID patches to a live Baileys socket.
 *
 * Call this AFTER connection.open so signalRepository is available.
 * All patches are idempotent — safe to call on reconnect.
 */
export const patchBaileys = (sock, signalRepository, options = {}) => {
    const repo = signalRepository ??
        sock.signalRepository ?? null;
    const { preferPnForIncomingEvents = true } = options;
    const user = sock.user;
    _selfPnJid = _normalizeJid(asNonEmptyString(user?.id)) ?? _selfPnJid;
    _selfLidJid = ensureLidJid(asNonEmptyString(user?.lid) ?? _selfLidJid ?? '');
    if (_selfLidJid === '@lid') {
        _selfLidJid = undefined;
    }
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
                    hoistRootParticipantToKeySync(msg);
                    const key = msg.key;
                    if (!key)
                        return msg;
                    fixBogusGroupParticipantSync(key);
                    if (preferPnForIncomingEvents) {
                        applyPreferredPnToMessageKeySync(key);
                    }
                    else {
                        if (typeof key.participant === 'string' && isAnyLidJid(key.participant)) {
                            const gJid = typeof key.remoteJid === 'string' && key.remoteJid.endsWith('@g.us')
                                ? key.remoteJid : undefined;
                            const sync = (gJid ? resolveGroupParticipant(gJid, key.participant) : undefined)
                                ?? getLidContactJid(key.participant);
                            if (sync)
                                key.participant = sync;
                        }
                        if (typeof key.remoteJid === 'string' && isAnyLidJid(key.remoteJid)) {
                            const fromStore = getLidContactJid(key.remoteJid);
                            if (fromStore)
                                key.remoteJid = fromStore;
                        }
                    }
                    return msg;
                });
                // ASYNC pass — signalRepository + group warmup
                Promise.all(d.messages.map(async (msg) => {
                    const key = msg.key;
                    const gJid = typeof key?.remoteJid === 'string' && key.remoteJid.endsWith('@g.us')
                        ? key.remoteJid : undefined;
                    if (gJid && typeof key?.participant === 'string' && isAnyLidJid(key.participant)) {
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
            for (const mapping of d.lidPnMappings ?? []) {
                rememberLidPnPair(mapping.lid, mapping.pn);
            }
            if (preferPnForIncomingEvents) {
                for (const contact of d.contacts ?? []) {
                    applyPreferredPnToContactSync(contact);
                }
                for (const chat of d.chats ?? []) {
                    applyPreferredPnToChatSync(chat);
                }
            }
            if (Array.isArray(d?.messages)) {
                for (const msg of d.messages) {
                    hoistRootParticipantToKeySync(msg);
                    const key = msg.key;
                    if (!key)
                        continue;
                    fixBogusGroupParticipantSync(key);
                    const rj = typeof key.remoteJid === 'string' ? key.remoteJid : '';
                    const isGroup = rj.endsWith('@g.us');
                    if (isGroup && typeof key.participant === 'string' &&
                        (key.participant === rj || key.participant.endsWith('@g.us'))) {
                        key.participant = undefined;
                    }
                    if (preferPnForIncomingEvents) {
                        applyPreferredPnToMessageKeySync(key);
                    }
                    else {
                        if (isGroup && typeof key.participant === 'string' && isAnyLidJid(key.participant)) {
                            const cached = resolveGroupParticipant(rj, key.participant)
                                ?? getLidContactJid(key.participant);
                            if (cached)
                                key.participant = cached;
                        }
                        if (typeof key.remoteJid === 'string' && isAnyLidJid(key.remoteJid)) {
                            const fromStore = getLidContactJid(key.remoteJid);
                            if (fromStore)
                                key.remoteJid = fromStore;
                        }
                    }
                }
                Promise.all(d.messages.map(m => fixHistorySyncParticipant(m, repo))).catch(() => { });
            }
        }
        if (preferPnForIncomingEvents && (event === 'chats.update' || event === 'chats.upsert')) {
            const chats = Array.isArray(data) ? data : [];
            for (const chat of chats) {
                applyPreferredPnToChatSync(chat);
            }
        }
        if (preferPnForIncomingEvents && (event === 'contacts.upsert' || event === 'contacts.update')) {
            const contacts = Array.isArray(data) ? data : [];
            for (const contact of contacts) {
                applyPreferredPnToContactSync(contact);
            }
        }
        if (preferPnForIncomingEvents && event === 'messages.update') {
            const updates = Array.isArray(data) ? data : [];
            for (const update of updates) {
                applyPreferredPnToMessageLikeSync(update);
            }
        }
        if (preferPnForIncomingEvents && event === 'messages.reaction') {
            const reactions = Array.isArray(data) ? data : [];
            for (const reaction of reactions) {
                applyPreferredPnToReactionSync(reaction);
            }
        }
        if (preferPnForIncomingEvents && event === 'message-receipt.update') {
            const receipts = Array.isArray(data) ? data : [];
            for (const receipt of receipts) {
                applyPreferredPnToReceiptSync(receipt);
            }
        }
        if (preferPnForIncomingEvents && event === 'messages.delete') {
            const payload = data;
            for (const key of payload?.keys ?? []) {
                applyPreferredPnToMessageKeySync(key);
            }
        }
        if (preferPnForIncomingEvents && (event === 'groups.upsert' || event === 'groups.update')) {
            const groups = Array.isArray(data) ? data : [];
            for (const group of groups) {
                applyPreferredPnToGroupUpdateSync(group);
            }
        }
        if (preferPnForIncomingEvents && event === 'group-participants.update' && data && typeof data === 'object') {
            applyPreferredPnToGroupParticipantsEventSync(data);
        }
        if (preferPnForIncomingEvents && event === 'group.join-request' && data && typeof data === 'object') {
            applyPreferredPnToJoinRequestSync(data);
        }
        return originalEmit(event, data, ...rest);
    };
    evObj.on('groups.upsert', (gs) => gs.forEach(cacheGroupParticipants));
    evObj.on('groups.update', (us) => us.forEach(g => { if (g?.participants)
        cacheGroupParticipants(g); }));
    console.log('[wileys-patch v10] LID patch active ✓');
    if (preferPnForIncomingEvents) {
        console.log('[wileys-patch v10] PN-first incoming event fallback active ✓');
    }
    if (!repo)
        console.warn('[wileys-patch v10] ⚠  signalRepository unavailable — call after connection.open');
    if (!_groupMetadataFn)
        console.warn('[wileys-patch v10] ⚠  sock.groupMetadata not found — async warmup disabled');
};
//# sourceMappingURL=wileys-patch.js.map