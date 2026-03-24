/**
 * patch/make-in-memory-store.ts — custom-baileys v10 Enterprise
 *
 * ════════════════════════════════════════════════════════════════════════════
 * FULL PORT of wileys@latest Store/make-in-memory-store.js
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Wileys ships a full-featured store that Baileys rc9 removed entirely.
 * This is a complete TypeScript port with enterprise improvements:
 *
 *  ✓ KeyedDB-backed sorted chat list (pin + archive + timestamp ordering)
 *  ✓ Per-chat ordered message dictionaries (wileys make-ordered-dictionary)
 *  ✓ Full contact store with LID indexing
 *  ✓ Group metadata cache
 *  ✓ Presence tracking
 *  ✓ Label + LabelAssociation support
 *  ✓ loadMessages() with cursor-based pagination
 *  ✓ writeToFile() / readFromFile() for session persistence
 *  ✓ fetchImageUrl() — lazy profile picture loading
 *  ✓ fetchGroupMetadata() — lazy group metadata with store-first caching
 *
 * ENTERPRISE ADDITIONS over wileys:
 *  ✓ LID-indexed contacts (contacts keyed by both id AND lid)
 *  ✓ getContact() — resolves by JID, LID, or phone number
 *  ✓ getMessages() — returns N most recent messages for a JID
 *  ✓ messaging-history.set handler (missing in wileys for partial history)
 *  ✓ Safe jidNormalizedUser() — catches @lid and other non-standard JIDs
 */
import { createRequire } from 'module';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { jidNormalizedUser, isJidGroup, areJidsSameUser, } from '../baileys-compat.js';
import { normalizeJid, isJidLid, } from '../utils/jid.js';
// ─── KeyedDB ──────────────────────────────────────────────────────────────────
// wileys uses @adiwajshing/keyed-db for sorted chat list.
// We load it dynamically so the store still works if it's absent.
const _req = createRequire(import.meta.url);
let KeyedDB;
try {
    KeyedDB = _req('@adiwajshing/keyed-db').default;
}
catch {
    // Fallback: array-backed sorted list if KeyedDB not installed
    KeyedDB = class FallbackKeyedDB {
        constructor(_opts, keyFn) {
            this._opts = _opts;
            this._arr = [];
            this._keyFn = keyFn;
        }
        get(id) { return this._arr.find(x => this._keyFn(x) === id); }
        upsert(...items) { for (const it of items) {
            const idx = this._arr.findIndex(x => this._keyFn(x) === this._keyFn(it));
            if (idx >= 0)
                this._arr[idx] = it;
            else
                this._arr.push(it);
        } }
        insertIfAbsent(...items) { const added = []; for (const it of items) {
            if (!this.get(this._keyFn(it))) {
                this._arr.push(it);
                added.push(it);
            }
        } return added; }
        update(id, fn) { const it = this.get(id); if (it) {
            fn(it);
            return it;
        } return null; }
        deleteById(id) { this._arr = this._arr.filter(x => this._keyFn(x) !== id); }
        filter(fn) { this._arr = this._arr.filter(fn); }
        all() { return this._arr; }
        clear() { this._arr = []; }
        count() { return this._arr.length; }
        get array() { return this._arr; }
    };
}
function makeOrderedDictionary(idFn) {
    const array = [];
    const map = new Map(); // id → index
    const reIndex = () => {
        map.clear();
        for (let i = 0; i < array.length; i++)
            map.set(idFn(array[i]), i);
    };
    const get = (id) => {
        const idx = map.get(id);
        return idx !== undefined ? array[idx] : undefined;
    };
    const upsert = (item, mode) => {
        const id = idFn(item);
        const idx = map.get(id);
        if (idx !== undefined) {
            array[idx] = item;
        }
        else if (mode === 'append') {
            map.set(id, array.length);
            array.push(item);
        }
        else {
            array.unshift(item);
            reIndex();
        }
    };
    const updateAssign = (id, update) => {
        const idx = map.get(id);
        if (idx === undefined)
            return false;
        array[idx] = { ...array[idx], ...update };
        return true;
    };
    const filter = (fn) => {
        const kept = array.filter(fn);
        array.length = 0;
        array.push(...kept);
        reIndex();
    };
    const clear = () => { array.length = 0; map.clear(); };
    return { array, get, upsert, updateAssign, filter, clear, get length() { return array.length; } };
}
const waChatKey = (pin) => ({
    key: (c) => (pin ? (c.pinned ? '1' : '0') : '') +
        (c.archived ? '0' : '1') +
        (c.conversationTimestamp
            ? Number(c.conversationTimestamp).toString(16).padStart(8, '0')
            : '00000000') +
        c.id,
    compare: (k1, k2) => k2.localeCompare(k1),
});
// ─── waMessageID ──────────────────────────────────────────────────────────────
const waMessageID = (m) => m.key.id || '';
// ─── Safe jidNormalize ───────────────────────────────────────────────────────
function safeJidNorm(jid) {
    if (!jid)
        return '';
    try {
        return jidNormalizedUser(jid) || jid;
    }
    catch {
        return jid;
    }
}
// ─── makeInMemoryStore ───────────────────────────────────────────────────────
/**
 * makeInMemoryStore — full wileys@latest store port for Baileys rc9.
 *
 * Handles ALL socket events including messaging-history.set, labels,
 * presences, group-participants.update, message-receipt.update, etc.
 *
 * LID-aware: contacts indexed by both id AND lid for O(1) @lid lookup.
 */
export const makeInMemoryStore = (config = {}) => {
    const socket = config.socket;
    const chatKey = config.chatKey ?? waChatKey(true);
    // Safely instantiate KeyedDB or fallback
    const chats = new KeyedDB(chatKey, (c) => c.id);
    const contacts = {};
    const messages = {};
    const groupMetadata = {};
    const presences = {};
    const state = { connection: 'close' };
    const labels = {};
    const labelAssoc = [];
    const logger = config.logger ?? {
        debug: (..._) => { },
        warn: (..._) => { },
        error: (..._) => { },
    };
    // ── Helpers ───────────────────────────────────────────────────────────────
    const assertMessageList = (jid) => {
        if (!messages[jid])
            messages[jid] = makeOrderedDictionary(waMessageID);
        return messages[jid];
    };
    const contactsUpsert = (newContacts) => {
        const oldSet = new Set(Object.keys(contacts));
        for (const c of newContacts) {
            if (!c.id)
                continue;
            const id = c.id;
            oldSet.delete(id);
            contacts[id] = { ...(contacts[id] ?? {}), ...c };
            // LID indexing — contacts accessible by @lid too
            if (c.lid) {
                const lid = c.lid;
                contacts[lid] = { ...(contacts[lid] ?? {}), ...c };
                oldSet.delete(lid);
            }
            // jid field (wileys) — also index by phone-number JID if different from id
            if (c.jid && c.jid !== id) {
                const jid = c.jid;
                contacts[jid] = { ...(contacts[jid] ?? {}), ...c };
            }
        }
        return oldSet;
    };
    const upsertMsgs = (msgs, mode) => {
        for (const msg of msgs) {
            const m = msg;
            const jid = safeJidNorm(m?.key?.remoteJid);
            if (!jid)
                continue;
            const list = assertMessageList(jid);
            list.upsert(msg, mode);
        }
    };
    // ── bind ──────────────────────────────────────────────────────────────────
    const bind = (ev) => {
        ev.on('connection.update', (update) => {
            Object.assign(state, update);
        });
        // ── History ────────────────────────────────────────────────────────────
        ev.on('messaging-history.set', (d) => {
            const { chats: nc, contacts: nco, messages: nm, isLatest, syncType } = d;
            // ON_DEMAND (6) — skip for now (same as wileys TODO)
            if (syncType === 6)
                return;
            if (isLatest) {
                ;
                chats.clear?.();
                for (const id in messages)
                    delete messages[id];
            }
            if (Array.isArray(nc)) {
                ;
                chats
                    .insertIfAbsent?.(...nc);
                logger.debug({ count: nc.length }, 'synced chats');
            }
            if (Array.isArray(nco)) {
                const old = contactsUpsert(nco);
                if (isLatest)
                    for (const jid of old)
                        delete contacts[jid];
                logger.debug({ count: nco.length }, 'synced contacts');
            }
            if (Array.isArray(nm)) {
                upsertMsgs(nm, 'prepend');
                logger.debug({ count: nm.length }, 'synced messages');
            }
        });
        // ── Contacts ──────────────────────────────────────────────────────────
        ev.on('contacts.upsert', (d) => contactsUpsert(d));
        ev.on('contacts.update', async (updates) => {
            for (const u of updates) {
                const id = u.id;
                if (!id)
                    continue;
                let contact = contacts[id];
                if (!contact) {
                    logger.debug({ update: u }, 'got update for non-existent contact');
                    contact = { id };
                }
                if (u.imgUrl === 'changed' && socket) {
                    try {
                        const fn = socket.profilePictureUrl;
                        contact.imgUrl = fn ? await fn(id) : undefined;
                    }
                    catch {
                        contact.imgUrl = undefined;
                    }
                }
                else if (u.imgUrl === 'removed') {
                    delete contact.imgUrl;
                }
                contacts[id] = { ...contact, ...u };
                // Update LID index too
                if (u.lid)
                    contacts[u.lid] = contacts[id];
            }
        });
        // LID phone share event — index contact by LID immediately
        ev.on('chats.phoneNumberShare', (d) => {
            const { lid, jid } = d;
            if (lid && jid) {
                const norm = normalizeJid(jid) ?? jid;
                contacts[lid] = { ...(contacts[lid] ?? {}), id: lid, jid: norm };
                contacts[norm] = { ...(contacts[norm] ?? {}), id: norm, lid };
            }
        });
        // ── Chats ─────────────────────────────────────────────────────────────
        ev.on('chats.upsert', (d) => {
            ;
            chats.upsert?.(...d);
        });
        ev.on('chats.update', (updates) => {
            for (const u of updates) {
                ;
                chats.update?.(u.id, (chat) => {
                    const c = chat;
                    if ((u.unreadCount ?? 0) > 0) {
                        u.unreadCount = (c.unreadCount || 0) + u.unreadCount;
                    }
                    Object.assign(c, u);
                });
            }
        });
        ev.on('chats.delete', (ids) => {
            for (const id of ids) {
                ;
                chats.deleteById?.(id);
            }
        });
        // ── Messages ──────────────────────────────────────────────────────────
        ev.on('messages.upsert', (d) => {
            const { messages: ms, type } = d;
            switch (type) {
                case 'append':
                case 'notify':
                    for (const msg of ms) {
                        const m = msg;
                        const jid = safeJidNorm(m.key?.remoteJid);
                        if (!jid)
                            continue;
                        const list = assertMessageList(jid);
                        list.upsert(msg, 'append');
                        // Create chat entry if new notify
                        if (type === 'notify') {
                            const exists = chats.get?.(jid);
                            if (!exists) {
                                const ts = msg.messageTimestamp;
                                ev.emit?.('chats.upsert', [{ id: jid, conversationTimestamp: ts, unreadCount: 1 }]);
                            }
                        }
                    }
                    break;
            }
        });
        ev.on('messages.update', (updates) => {
            for (const { key, update } of updates) {
                const jid = safeJidNorm(key?.remoteJid);
                if (!jid)
                    continue;
                const list = assertMessageList(jid);
                // Respect status ordering (don't downgrade)
                const cur = list.get(key.id ?? '');
                const upd = update;
                if (cur?.status && upd?.status && upd.status <= cur.status) {
                    delete upd.status;
                }
                const ok = list.updateAssign(key.id ?? '', update);
                if (!ok)
                    logger.debug({ update }, 'got update for non-existent message');
            }
        });
        ev.on('messages.delete', (d) => {
            if (d.all) {
                const { jid } = d;
                messages[jid]?.clear();
            }
            else {
                const { keys } = d;
                const jid = safeJidNorm(keys[0]?.remoteJid);
                if (!jid)
                    return;
                const list = messages[jid];
                if (!list)
                    return;
                const ids = new Set(keys.map(k => k.id));
                list.filter((m) => !ids.has(m.key?.id));
            }
        });
        // ── Groups ────────────────────────────────────────────────────────────
        ev.on('groups.upsert', (...args) => {
            const gs = args[0];
            for (const g of (Array.isArray(gs) ? gs : [])) {
                const meta = g;
                if (meta.id)
                    groupMetadata[meta.id] = meta;
            }
        });
        ev.on('groups.update', (updates) => {
            for (const u of updates) {
                if (groupMetadata[u.id])
                    Object.assign(groupMetadata[u.id], u);
                else
                    logger.debug({ update: u }, 'got update for non-existent group metadata');
            }
        });
        ev.on('group-participants.update', (d) => {
            const { id, participants, action } = d;
            const meta = groupMetadata[id];
            if (!meta)
                return;
            const pts = meta.participants ?? [];
            switch (action) {
                case 'add':
                    pts.push(...participants.map(pid => ({ id: pid, isAdmin: false, isSuperAdmin: false })));
                    break;
                case 'promote':
                case 'demote':
                    for (const p of pts)
                        if (participants.includes(p.id))
                            p.isAdmin = action === 'promote';
                    break;
                case 'remove':
                    meta.participants = pts.filter(p => !participants.includes(p.id));
                    break;
            }
        });
        // ── Presences ─────────────────────────────────────────────────────────
        ev.on('presence.update', (d) => {
            const { id, presences: ps } = d;
            presences[id] = presences[id] ?? {};
            Object.assign(presences[id], ps);
        });
        // ── Message receipts / reactions ──────────────────────────────────────
        ev.on('message-receipt.update', (updates) => {
            for (const { key, receipt } of updates) {
                const jid = safeJidNorm(key?.remoteJid);
                const msg = messages[jid]?.get(key?.id ?? '');
                if (msg) {
                    const arr = msg.userReceipt ?? [];
                    arr.push(receipt);
                    msg.userReceipt = arr;
                }
            }
        });
        ev.on('messages.reaction', (reactions) => {
            for (const { key, reaction } of reactions) {
                const jid = safeJidNorm(key?.remoteJid);
                const msg = messages[jid]?.get(key?.id ?? '');
                if (msg) {
                    const arr = msg.reactions ?? [];
                    const r = reaction;
                    const idx = arr.findIndex((x) => x.key?.id === r?.key?.id);
                    if (idx >= 0)
                        arr[idx] = reaction;
                    else
                        arr.push(reaction);
                    msg.reactions = arr;
                }
            }
        });
        // ── Labels ────────────────────────────────────────────────────────────
        ev.on('labels.edit', (label) => {
            const l = label;
            if (l.deleted) {
                delete labels[l.id];
                return;
            }
            if (Object.keys(labels).length < 20)
                labels[l.id] = label;
            else
                logger.error('Labels count exceeded (max 20)');
        });
        ev.on('labels.association', (d) => {
            const { type, association } = d;
            if (type === 'add')
                labelAssoc.push(association);
            else {
                const a = association;
                const idx = labelAssoc.findIndex(x => {
                    const y = x;
                    return y.chatId === a.chatId && y.labelId === a.labelId &&
                        (!a.messageId || y.messageId === a.messageId);
                });
                if (idx >= 0)
                    labelAssoc.splice(idx, 1);
            }
        });
    };
    // ── Query API ─────────────────────────────────────────────────────────────
    const loadMessages = async (jid, count, cursor) => {
        const norm = safeJidNorm(jid);
        const list = assertMessageList(norm);
        const mode = !cursor || 'before' in cursor ? 'before' : 'after';
        const cursorKey = cursor ? ('before' in cursor ? cursor.before : cursor.after) : undefined;
        let result;
        if (mode === 'before' && (!cursorKey || list.get(cursorKey.id ?? ''))) {
            if (cursorKey) {
                const idx = list.array.findIndex(m => m.key?.id === cursorKey.id);
                result = list.array.slice(0, idx);
            }
            else {
                result = list.array;
            }
            if (result.length > count)
                result = result.slice(-count);
        }
        else {
            result = [];
        }
        return result;
    };
    const loadMessage = async (jid, id) => messages[safeJidNorm(jid)]?.get(id);
    const mostRecentMessage = async (jid) => {
        const arr = messages[safeJidNorm(jid)]?.array;
        return arr?.[arr.length - 1];
    };
    const getMessages = (jid, limit = 50) => {
        const arr = messages[safeJidNorm(jid)]?.array ?? [];
        return limit > 0 ? arr.slice(-limit) : [...arr];
    };
    const getContact = (jid) => {
        if (!jid)
            return undefined;
        return contacts[jid]
            ?? contacts[normalizeJid(jid) ?? jid]
            ?? (isJidLid(jid) ? contacts[jid.replace('@lid', '@s.whatsapp.net')] : undefined);
    };
    const fetchImageUrl = async (jid, sock) => {
        const contact = contacts[jid];
        const s = sock ?? socket;
        if (!contact) {
            const fn = s?.profilePictureUrl;
            return fn ? fn(jid).catch(() => undefined) : undefined;
        }
        if (typeof contact.imgUrl === 'undefined') {
            const fn = s?.profilePictureUrl;
            contact.imgUrl = fn ? await fn(jid).catch(() => undefined) : undefined;
        }
        return contact.imgUrl;
    };
    const fetchGroupMetadata = async (jid, sock) => {
        const s = sock ?? socket;
        if (!groupMetadata[jid]) {
            const fn = s?.groupMetadata;
            if (fn) {
                const meta = await fn(jid).catch(() => undefined);
                if (meta)
                    groupMetadata[jid] = meta;
            }
        }
        return groupMetadata[jid];
    };
    const getLabels = () => labels;
    const getChatLabels = (chatId) => labelAssoc.filter((la) => la.chatId === chatId);
    const getMessageLabels = (messageId) => labelAssoc
        .filter((la) => la.messageId === messageId)
        .map((la) => la.labelId);
    // ── Persistence ───────────────────────────────────────────────────────────
    const toJSON = () => ({
        chats: chats.toJSON?.() ?? chats,
        contacts,
        messages: Object.fromEntries(Object.entries(messages).map(([jid, dict]) => [jid, dict.array])),
        labels,
        labelAssociations: labelAssoc,
    });
    const fromJSON = (json) => {
        const j = json;
        if (j.chats?.length) {
            const upsertFn = chats.upsert;
            if (upsertFn)
                upsertFn(...j.chats);
        }
        if (j.contacts)
            Object.assign(contacts, j.contacts);
        if (j.messages) {
            for (const [jid, msgs] of Object.entries(j.messages)) {
                const list = assertMessageList(jid);
                for (const m of msgs)
                    list.upsert(m, 'append');
            }
        }
        if (j.labels)
            Object.assign(labels, j.labels);
        if (j.labelAssociations)
            labelAssoc.push(...j.labelAssociations);
    };
    const writeToFile = (path) => {
        writeFileSync(path, JSON.stringify(toJSON()), 'utf-8');
    };
    const readFromFile = (path) => {
        if (!existsSync(path))
            return;
        try {
            const raw = readFileSync(path, 'utf-8');
            if (raw.trim())
                fromJSON(JSON.parse(raw));
        }
        catch (err) {
            logger.warn({ path, err }, 'failed to read store from file');
        }
    };
    return {
        chats,
        contacts,
        messages,
        groupMetadata,
        presences,
        state,
        labels: labels,
        bind,
        loadMessages,
        loadMessage,
        mostRecentMessage,
        getMessages,
        getContact,
        fetchImageUrl,
        fetchGroupMetadata,
        getLabels,
        getChatLabels,
        getMessageLabels,
        toJSON,
        fromJSON,
        writeToFile,
        readFromFile,
    };
};
// ─── Export chat key helpers ──────────────────────────────────────────────────
export { waChatKey, waMessageID };
//# sourceMappingURL=make-in-memory-store.js.map