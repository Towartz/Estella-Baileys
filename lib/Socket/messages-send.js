// [wileys-v10-messages-send] DO NOT EDIT
/**
 * messages-send.ts — WILEYS PORT v9 (Baileys rc9 compatible)
 *
 * Direct TypeScript port of wileys@0.5.1 Socket/messages-send.js,
 * corrected for ALL Baileys v7 rc9 type differences:
 *
 *   - isJidUser removed from WABinary → inline: jid?.endsWith('@s.whatsapp.net')
 *   - BinaryNode from '../WABinary' (not '../Types')
 *   - normalizeMessageContent from '../Utils/messages' directly (not barrel)
 *   - albumMessageItemDelayMs via (config as any)
 *   - processingMutex via (sock as any).processingMutex
 *   - assertSessions force?: boolean (optional)
 *   - authState.keys.transaction(exec, key) → 2nd arg 'relayMessage'
 *   - extractDeviceJids cast as any for 4-arg rc9 signature
 *   - mediaHandle as (up as any).handle
 *   - messageRetryManager passed through from underlying sock
 *   - getStatusCodeForMediaRetry arg cast to number
 */
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import { randomBytes } from 'crypto';
import { createRequire } from 'module';
// WAProto is a CJS module — createRequire guarantees it loads correctly
// regardless of tsc-esm-fix directory resolution issues with ESM directory imports
const _require = createRequire(import.meta.url);
const { proto } = _require('../../WAProto');
import { DEFAULT_CACHE_TTLS, WA_DEFAULT_EPHEMERAL } from '../Defaults/index.js';
import { aggregateMessageKeysNotFromMe, encodeWAMessage, encodeNewsletterMessage, encodeSignedDeviceIdentity, extractDeviceJids, generateWAMessage, generateWAMessageFromContent, getContentType, getStatusCodeForMediaRetry, getUrlFromDirectPath, getWAUploadToServer, parseAndInjectE2ESessions, unixTimestampSeconds, generateMessageIDV2, bindWaitForEvent, encryptMediaRetryRequest, decryptMediaRetryData, assertMediaContent, } from '../Utils/index.js';
import { normalizeMessageContentFull as normalizeMessageContent } from '../Utils/messages.js';
import { getUrlInfo } from '../Utils/link-preview.js';
import { areJidsSameUser, getBinaryNodeChild, getBinaryNodeChildren, isJidGroup, isJidNewsletter, jidDecode, jidEncode, jidNormalizedUser, S_WHATSAPP_NET, } from '../WABinary/index.js';
import { USyncQuery, USyncUser } from '../WAUSync/index.js';
import { makeNewsletterSocket } from './newsletter.js';
// rc9 removed isJidUser export from WABinary
const isJidUser = (jid) => !!jid?.endsWith('@s.whatsapp.net');
const getMediaType = (message) => {
    if (message.imageMessage)
        return 'image';
    if (message.videoMessage)
        return message.videoMessage.gifPlayback ? 'gif' : 'video';
    if (message.audioMessage)
        return message.audioMessage.ptt ? 'ptt' : 'audio';
    if (message.contactMessage)
        return 'vcard';
    if (message.documentMessage)
        return 'document';
    if (message.contactsArrayMessage)
        return 'contact_array';
    if (message.liveLocationMessage)
        return 'livelocation';
    if (message.stickerMessage)
        return 'sticker';
    if (message.listMessage)
        return 'list';
    if (message.listResponseMessage)
        return 'list_response';
    if (message.buttonsResponseMessage)
        return 'buttons_response';
    if (message.orderMessage)
        return 'order';
    if (message.productMessage)
        return 'product';
    if (message.interactiveResponseMessage)
        return 'native_flow_response';
    if (message.groupInviteMessage)
        return 'url';
    return undefined;
};
const getTypeMessage = (msg) => {
    if (msg.viewOnceMessage)
        return getTypeMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2)
        return getTypeMessage(msg.viewOnceMessageV2.message);
    if (msg.viewOnceMessageV2Extension)
        return getTypeMessage(msg.viewOnceMessageV2Extension.message);
    if (msg.ephemeralMessage)
        return getTypeMessage(msg.ephemeralMessage.message);
    if (msg.documentWithCaptionMessage)
        return getTypeMessage(msg.documentWithCaptionMessage.message);
    if (msg.reactionMessage)
        return 'reaction';
    if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3 || msg.pollUpdateMessage)
        return 'poll';
    if (getMediaType(msg))
        return 'media';
    return 'text';
};
export const makeMessagesSocket = (config) => {
    const { logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview, options: axiosOptions, patchMessageBeforeSending, cachedGroupMetadata } = config;
    const albumMessageItemDelayMs = config.albumMessageItemDelayMs ?? 0;
    const sock = makeNewsletterSocket(config);
    const { ev, authState, signalRepository, upsertMessage, query, fetchPrivacySettings, sendNode, groupMetadata, groupToggleEphemeral } = sock;
    const processingMutex = sock.processingMutex;
    const userDevicesCache = config.userDevicesCache || new NodeCache({ stdTTL: DEFAULT_CACHE_TTLS.USER_DEVICES, useClones: false });
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({ tag: 'iq', attrs: { type: 'set', xmlns: 'w:m', to: S_WHATSAPP_NET }, content: [{ tag: 'media_conn', attrs: {} }] });
                const n = getBinaryNodeChild(result, 'media_conn');
                return {
                    hosts: getBinaryNodeChildren(n, 'host').map(({ attrs }) => ({ hostname: attrs.hostname, maxContentLengthBytes: +(attrs.maxContentLengthBytes ?? 0) })),
                    auth: n.attrs.auth, ttl: +(n.attrs.ttl ?? 300), fetchDate: new Date(),
                };
            })();
        }
        return mediaConn;
    };
    const sendReceipt = async (jid, participant, messageIds, type) => {
        const filteredIds = messageIds.filter(Boolean);
        const node = { tag: 'receipt', attrs: { id: filteredIds[0] || '' } };
        if (type === 'read' || type === 'read-self')
            node.attrs.t = unixTimestampSeconds().toString();
        if (type === 'sender' && isJidUser(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant)
                node.attrs.participant = participant;
        }
        if (type)
            node.attrs.type = isJidNewsletter(jid) ? 'read-self' : type;
        const rest = filteredIds.slice(1);
        if (rest.length)
            node.content = [{ tag: 'list', attrs: {}, content: rest.map(id => ({ tag: 'item', attrs: { id } })) }];
        logger.debug({ attrs: node.attrs, messageIds: filteredIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    const sendReceipts = async (keys, type) => {
        for (const { jid, participant, messageIds } of aggregateMessageKeysNotFromMe(keys)) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    const readMessages = async (keys) => {
        const s = await fetchPrivacySettings();
        await sendReceipts(keys, s.readreceipts === 'all' ? 'read' : 'read-self');
    };
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        const deviceResults = [];
        const toFetch = [];
        jids = Array.from(new Set(jids));
        for (let jid of jids) {
            const user = jidDecode(jid)?.user;
            jid = jidNormalizedUser(jid);
            if (useCache) {
                const devices = userDevicesCache.get(user);
                if (devices) {
                    deviceResults.push(...devices);
                    logger.trace({ user }, 'using cache for devices');
                }
                else
                    toFetch.push(jid);
            }
            else {
                toFetch.push(jid);
            }
        }
        if (!toFetch.length)
            return deviceResults;
        const q = new USyncQuery().withContext('message').withDeviceProtocol();
        for (const jid of toFetch)
            q.withUser(new USyncUser().withId(jid));
        const result = await sock.executeUSyncQuery(q);
        if (result) {
            const extracted = extractDeviceJids(result?.list, authState.creds.me.id, ignoreZeroDevices);
            const dm = {};
            for (const item of extracted) {
                dm[item.user] = dm[item.user] || [];
                dm[item.user].push(item);
                deviceResults.push(item);
            }
            for (const k in dm)
                userDevicesCache.set(k, dm[k]);
        }
        return deviceResults;
    };
    const assertSessions = async (jids, force) => {
        let jidsRequiringFetch = [];
        if (force) {
            jidsRequiringFetch = jids;
        }
        else {
            const addrs = jids.map(jid => signalRepository.jidToSignalProtocolAddress(jid));
            const sessions = await authState.keys.get('session', addrs);
            for (const jid of jids) {
                if (!sessions[signalRepository.jidToSignalProtocolAddress(jid)])
                    jidsRequiringFetch.push(jid);
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const r = await query({ tag: 'iq', attrs: { xmlns: 'encrypt', type: 'get', to: S_WHATSAPP_NET }, content: [{ tag: 'key', attrs: {}, content: jidsRequiringFetch.map(jid => ({ tag: 'user', attrs: { jid } })) }] });
            await parseAndInjectE2ESessions(r, signalRepository);
            return true;
        }
        return false;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id)
            throw new Boom('Not authenticated');
        const meJid = jidNormalizedUser(authState.creds.me.id);
        return relayMessage(meJid, { protocolMessage: { peerDataOperationRequestMessage: pdoMessage, type: proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE } }, { additionalAttributes: { category: 'peer', push_priority: 'high_force' } }); // proto is runtime-loaded CJS value
    };
    const createParticipantNodes = async (jids, message, extraAttrs) => {
        let patched = await patchMessageBeforeSending(message, jids);
        if (!Array.isArray(patched))
            patched = jids ? jids.map((jid) => ({ recipientJid: jid, ...patched })) : [patched];
        let shouldIncludeDeviceIdentity = false;
        const nodes = await Promise.all(patched.map(async (p) => {
            const { recipientJid: jid, ...pm } = p;
            if (!jid)
                return {};
            const bytes = encodeWAMessage(pm);
            const { type, ciphertext } = await signalRepository.encryptMessage({ jid, data: bytes });
            if (type === 'pkmsg')
                shouldIncludeDeviceIdentity = true;
            return { tag: 'to', attrs: { jid }, content: [{ tag: 'enc', attrs: { v: '2', type, ...(extraAttrs || {}) }, content: ciphertext }] };
        }));
        return { nodes, shouldIncludeDeviceIdentity };
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList } = {}) => {
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        const { user, server } = jidDecode(jid);
        const STATUS_JID = 'status@broadcast';
        const isGroup = server === 'g.us', isNewsletter = server === 'newsletter';
        const isStatus = jid === STATUS_JID, isLid = server === 'lid';
        msgId = msgId || generateMessageIDV2(sock.user?.id);
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [];
        const destinationJid = !isStatus ? jidEncode(user, isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net') : STATUS_JID;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = { deviceSentMessage: { destinationJid, message }, messageContextInfo: message.messageContextInfo };
        const extraAttrs = {};
        if (participant) {
            if (!isGroup && !isStatus)
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' };
            const { user: pu, device: pd } = jidDecode(participant.jid);
            devices.push({ user: pu, device: pd });
        }
        // rc9: transaction takes (exec, key)
        await authState.keys.transaction(async () => {
            // CRITICAL: normalize first → getMediaType sees unwrapped content
            const nm = normalizeMessageContent(message);
            const mediaType = nm ? getMediaType(nm) : undefined;
            if (mediaType)
                extraAttrs['mediatype'] = mediaType;
            if (normalizeMessageContent(message)?.pinInChatMessage)
                extraAttrs['decrypt-fail'] = 'hide';
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let gd = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                        if (gd && Array.isArray(gd?.participants)) {
                            logger.trace({ jid, participants: gd.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus)
                            gd = await groupMetadata(jid);
                        return gd;
                    })(),
                    (async () => {
                        // [wileys-v10-status-skm] Load sender-key-memory for BOTH groups AND
                        // status@broadcast. Previously guarded by !isStatus, which forced a full
                        // re-distribution of the sender key on every status send, calling
                        // assertSessions for the entire statusJidList (100s of contacts) and
                        // causing WA to return "No sessions" for any deactivated JID.
                        if (!participant) {
                            const r = await authState.keys.get('sender-key-memory', [jid]);
                            return r[jid] || {};
                        }
                        return {};
                    })(),
                ]);
                if (!participant) {
                    const pl = (groupData && !isStatus) ? groupData.participants.map((p) => p.id) : [];
                    if (isStatus && statusJidList)
                        pl.push(...statusJidList);
                    if (!isStatus)
                        additionalAttributes = { ...additionalAttributes, addressing_mode: groupData?.addressingMode || 'pn' };
                    devices.push(...await getUSyncDevices(pl, !!useUserDevicesCache, false));
                }
                const patched = await patchMessageBeforeSending(message);
                if (Array.isArray(patched))
                    throw new Boom('Per-jid patching is not supported in groups');
                const bytes = encodeWAMessage(patched);
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({ group: destinationJid, data: bytes, meId });
                const senderKeyJids = [];
                for (const { user: du, device } of devices) {
                    const dj = jidEncode(du, groupData?.addressingMode === 'lid' ? 'lid' : 's.whatsapp.net', device);
                    if (!senderKeyMap[dj] || !!participant) {
                        senderKeyJids.push(dj);
                        senderKeyMap[dj] = true;
                    }
                }
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    if (isStatus) {
                        // [wileys-v10-status-assert] For status@broadcast, assertSessions on
                        // hundreds of contacts at once causes WA to return "No sessions" if any
                        // single JID has a deactivated / expired prekey bundle.
                        // Strategy: batch in chunks of 20 and swallow individual batch errors so
                        // one bad contact never aborts the entire status send.
                        const BATCH = 20;
                        for (let i = 0; i < senderKeyJids.length; i += BATCH) {
                            const chunk = senderKeyJids.slice(i, i + BATCH);
                            try {
                                await assertSessions(chunk, false);
                            }
                            catch (batchErr) {
                                logger.warn({ chunk, err: batchErr?.message ?? String(batchErr) }, '[wileys-v10] assertSessions batch failed — skipping chunk');
                            }
                        }
                    }
                    else {
                        await assertSessions(senderKeyJids, false);
                    }
                    const r = await createParticipantNodes(senderKeyJids, { senderKeyDistributionMessage: { axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage, groupId: destinationJid } }, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || r.shouldIncludeDeviceIdentity;
                    participants.push(...r.nodes);
                }
                binaryNodeContent.push({ tag: 'enc', attrs: { v: '2', type: 'skmsg' }, content: ciphertext });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else if (isNewsletter) {
                let msg = message;
                if (msg.protocolMessage?.editedMessage) {
                    msgId = msg.protocolMessage.key?.id;
                    message = msg.protocolMessage.editedMessage;
                }
                if (msg.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE) {
                    msgId = msg.protocolMessage.key?.id;
                    message = {};
                }
                const patched = await patchMessageBeforeSending(message, []);
                if (Array.isArray(patched))
                    throw new Boom('Per-jid patching is not supported in channel');
                binaryNodeContent.push({ tag: 'plaintext', attrs: mediaType ? { mediatype: mediaType } : {}, content: encodeNewsletterMessage(patched) });
            }
            else {
                const { user: meUser } = jidDecode(meId);
                if (!participant) {
                    devices.push({ user });
                    if (user !== meUser)
                        devices.push({ user: meUser });
                    if (additionalAttributes?.['category'] !== 'peer')
                        devices.push(...await getUSyncDevices([meId, jid], !!useUserDevicesCache, true));
                }
                const allJids = [], meJids = [], otherJids = [];
                for (const { user: du, device } of devices) {
                    const isMe = du === meUser;
                    const dj = jidEncode(isMe && isLid ? authState.creds?.me?.lid?.split(':')[0] || du : du, isLid ? 'lid' : 's.whatsapp.net', device);
                    if (isMe)
                        meJids.push(dj);
                    else
                        otherJids.push(dj);
                    allJids.push(dj);
                }
                await assertSessions(allJids, false);
                const [{ nodes: mn, shouldIncludeDeviceIdentity: s1 }, { nodes: on, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs),
                ]);
                participants.push(...mn, ...on);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const pn = participants[0]?.content?.[0];
                    if (pn)
                        binaryNodeContent.push(pn);
                }
                else
                    binaryNodeContent.push({ tag: 'participants', attrs: {}, content: participants });
            }
            // CRITICAL: additionalAttributes spread into stanza → media_id + mediatype on outer <message>
            const stanza = {
                tag: 'message',
                attrs: { id: msgId, type: isNewsletter ? getTypeMessage(message) : 'text', ...(additionalAttributes || {}) },
                content: binaryNodeContent,
            };
            if (participant) {
                if (isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if (areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else
                    stanza.attrs.to = participant.jid;
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({ tag: 'device-identity', attrs: {}, content: encodeSignedDeviceIdentity(authState.creds.account, true) });
                logger.debug({ jid }, 'adding device identity');
            }
            if (additionalNodes?.length)
                stanza.content.push(...additionalNodes);
            // biz + bot nodes — only inject if additionalNodes did not already carry them.
            // injectInteractiveButtons() wraps relayMessage and pre-populates additionalNodes
            // with the correct biz/bot nodes. Without this guard both code-paths fire and
            // WA rejects the stanza because of duplicate child nodes.
            // [wileys-v10-biz-dedup]
            const _alreadyHasBiz = (additionalNodes ?? []).some((n) => n.tag === 'biz');
            if (!_alreadyHasBiz) {
                const sn = normalizeMessageContent(message);
                const st = getContentType(sn);
                if ((isJidGroup(jid) || isJidUser(jid)) && (st === 'interactiveMessage' || st === 'buttonsMessage' || st === 'listMessage')) {
                    const biz = { tag: 'biz', attrs: {} };
                    const m = message;
                    const hi = m?.viewOnceMessage?.message?.interactiveMessage || m?.viewOnceMessageV2?.message?.interactiveMessage || m?.viewOnceMessageV2Extension?.message?.interactiveMessage || m?.interactiveMessage;
                    const hb = m?.viewOnceMessage?.message?.buttonsMessage || m?.viewOnceMessageV2?.message?.buttonsMessage || m?.viewOnceMessageV2Extension?.message?.buttonsMessage || m?.buttonsMessage;
                    if (hi || hb)
                        biz.content = [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }];
                    else if (m?.listMessage)
                        biz.content = [{ tag: 'list', attrs: { type: 'product_list', v: '2' } }];
                    stanza.content.push(biz);
                    if (!isJidGroup(jid) && !jid.endsWith('@broadcast') && !jid.endsWith('@newsletter')) {
                        ;
                        stanza.content.push({ tag: 'bot', attrs: { biz_bot: '1' } });
                    }
                }
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
        }, `relay-${msgId ?? 'msg'}`);
        return msgId;
    };
    const getPrivacyTokens = async (jids) => {
        const t = unixTimestampSeconds().toString();
        return query({ tag: 'iq', attrs: { to: S_WHATSAPP_NET, type: 'set', xmlns: 'privacy' }, content: [{ tag: 'tokens', attrs: {}, content: jids.map(jid => ({ tag: 'token', attrs: { jid: jidNormalizedUser(jid), t, type: 'trusted_contact' } })) }] });
    };
    const waUploadToServer = getWAUploadToServer(config, refreshMediaConn);
    const waitForMsgMediaUpdate = bindWaitForEvent(ev, 'messages.media-update');
    const sendMessage = async (jid, content, options = {}) => {
        const userJid = authState.creds.me.id;
        if (!options.ephemeralExpiration && isJidGroup(jid) && typeof sock.groupQuery === 'function') {
            try {
                const groups = await sock.groupQuery(jid, 'get', [{ tag: 'query', attrs: { request: 'interactive' } }]);
                const meta = getBinaryNodeChild(groups, 'group');
                options.ephemeralExpiration = (getBinaryNodeChild(meta, 'ephemeral')?.attrs?.expiration) || 0;
            }
            catch { /* non-fatal: ephemeral expiry defaults to 0 */ }
        }
        if (typeof content === 'object' && 'disappearingMessagesInChat' in content && typeof content['disappearingMessagesInChat'] !== 'undefined' && isJidGroup(jid)) {
            const v = typeof content.disappearingMessagesInChat === 'boolean' ? (content.disappearingMessagesInChat ? WA_DEFAULT_EPHEMERAL : 0) : content.disappearingMessagesInChat;
            await groupToggleEphemeral(jid, v);
        }
        if (typeof content === 'object' && 'album' in content && content.album) {
            const { album, caption } = content;
            if (caption && !album[0].caption)
                album[0].caption = caption;
            let mediaHandle, mediaMsg;
            const albumMsg = generateWAMessageFromContent(jid, { albumMessage: { expectedImageCount: album.filter((i) => 'image' in i).length, expectedVideoCount: album.filter((i) => 'video' in i).length } }, { userJid, ...options });
            await relayMessage(jid, albumMsg.message, { messageId: albumMsg.key.id });
            for (const i in album) {
                const media = album[i];
                const upFn = async (rs, opts) => { const up = await waUploadToServer(rs, { ...opts, newsletter: isJidNewsletter(jid) }); mediaHandle = up.handle; return up; };
                if ('image' in media)
                    mediaMsg = await generateWAMessage(jid, { image: media.image, ...(media.caption ? { caption: media.caption } : {}), ...options }, { userJid, upload: upFn, ...options });
                else if ('video' in media)
                    mediaMsg = await generateWAMessage(jid, { video: media.video, ...(media.caption ? { caption: media.caption } : {}), ...(media.gifPlayback !== undefined ? { gifPlayback: media.gifPlayback } : {}), ...options }, { userJid, upload: upFn, ...options });
                if (mediaMsg)
                    mediaMsg.message.messageContextInfo = { messageSecret: randomBytes(32), messageAssociation: { associationType: 1, parentMessageKey: albumMsg.key } };
                await relayMessage(jid, mediaMsg.message, { messageId: mediaMsg.key.id });
                if (albumMessageItemDelayMs > 0)
                    await new Promise(r => setTimeout(r, albumMessageItemDelayMs));
            }
            return albumMsg;
        }
        let mediaHandle;
        const fullMsg = await generateWAMessage(jid, content, {
            logger, userJid,
            getUrlInfo: (text) => getUrlInfo(text, { thumbnailWidth: linkPreviewImageThumbnailWidth, fetchOpts: { timeout: 3000, ...(axiosOptions || {}) }, logger, uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined }),
            getProfilePicUrl: sock.profilePictureUrl,
            // CRITICAL: capture .handle from upload → media_id stanza attr
            upload: async (rs, opts) => { const up = await waUploadToServer(rs, { ...opts, newsletter: isJidNewsletter(jid) }); mediaHandle = up.handle; return up; },
            mediaCache: config.mediaCache, options: config.options, messageId: generateMessageIDV2(sock.user?.id), ...options,
        });
        const isDel = 'delete' in content && !!content.delete, isEdit = 'edit' in content && !!content.edit;
        const isPin = 'pin' in content && !!content.pin, isKeep = 'keep' in content && content.keep;
        const isPoll = 'poll' in content && !!content.poll, isAi = 'ai' in content && !!content.ai;
        const additionalAttributes = {};
        const additionalNodes = [];
        if (isDel)
            additionalAttributes.edit = (isJidGroup(content.delete.remoteJid) && !content.delete.fromMe) || isJidNewsletter(jid) ? '8' : '7';
        else if (isEdit)
            additionalAttributes.edit = isJidNewsletter(jid) ? '3' : '1';
        else if (isPin)
            additionalAttributes.edit = '2';
        else if (isKeep)
            additionalAttributes.edit = '6';
        else if (isPoll)
            additionalNodes.push({ tag: 'meta', attrs: { polltype: 'creation' } });
        else if (isAi)
            additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
        // CRITICAL: media_id from CDN handle
        if (mediaHandle)
            additionalAttributes['media_id'] = mediaHandle;
        if ('cachedGroupMetadata' in options)
            console.warn('cachedGroupMetadata in sendMessage are deprecated, now cachedGroupMetadata is part of the socket config.');
        await relayMessage(jid, fullMsg.message, {
            messageId: fullMsg.key.id, useCachedGroupMetadata: options.useCachedGroupMetadata,
            additionalAttributes, additionalNodes: isAi ? additionalNodes : options.additionalNodes,
            statusJidList: options.statusJidList,
        });
        // [wileys-v10-emit-own] emitOwnEvents: store sent message locally.
        // processingMutex may be undefined on some Baileys rc9 builds — guard with
        // direct ev.emit fallback so the message always appears in the client.
        if (config.emitOwnEvents) {
            if (processingMutex) {
                process.nextTick(() => processingMutex.mutex(() => upsertMessage(fullMsg, 'append')));
            }
            else {
                process.nextTick(() => ev.emit('messages.upsert', { messages: [fullMsg], type: 'append' }));
            }
        }
        return fullMsg;
    };
    return {
        ...sock,
        getPrivacyTokens,
        assertSessions: assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        readMessages,
        refreshMediaConn,
        waUploadToServer,
        fetchPrivacySettings,
        getUSyncDevices,
        createParticipantNodes,
        sendPeerDataOperationMessage,
        messageRetryManager: sock.messageRetryManager,
        updateMediaMessage: async (message) => {
            const content = assertMediaContent(message.message);
            const mediaKey = content.mediaKey, meId = authState.creds.me.id;
            const node = await encryptMediaRetryRequest(message.key, mediaKey, meId);
            let error;
            await Promise.all([sendNode(node), waitForMsgMediaUpdate(async (update) => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = await decryptMediaRetryData(result.media, mediaKey, result.key.id);
                                if (media.result !== proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    throw new Boom(`Media re-upload failed by device (${proto.MediaRetryNotification.ResultType[media.result]})`, { data: media, statusCode: getStatusCodeForMediaRetry(media.result) || 404 });
                                }
                                content.directPath = media.directPath;
                                content.url = getUrlFromDirectPath(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })]);
            if (error)
                throw error;
            ev.emit('messages.update', [{ key: message.key, update: { message: message.message } }]);
            return message;
        },
        sendMessage,
    };
};
//# sourceMappingURL=messages-send.js.map