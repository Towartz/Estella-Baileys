/**
 * patch/wileys-compat-patch.ts
 *
 * ════════════════════════════════════════════════════════════════════════════
 * RUNTIME WILEYS COMPATIBILITY LAYER FOR BAILEYS v7 rc9
 * ════════════════════════════════════════════════════════════════════════════
 *
 * This module patches Baileys rc9 at the source level to restore ALL wileys
 * functions and behaviors that rc9 removed, renamed, or regressed.
 *
 * WHAT THIS PATCHES (source-level via apply-patches.ts):
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WABinary/jid-utils.ts                                                   │
 * │   + lidToJid()         — naive @lid → @s.whatsapp.net                   │
 * │   + getBotJid()        — @bot → BOT_MAP → @s.whatsapp.net (120+ bots)   │
 * │   + isJidUser()        — @s.whatsapp.net alias (rc9 renamed to isPnUser) │
 * │   + jidToLid()         — @s.whatsapp.net → @lid                         │
 * │                                                                         │
 * │ Utils/messages.ts                                                       │
 * │   ~ normalizeMessageContent() — 5 wrappers → 23 (wileys complete set)   │
 * │   + normalizeMessageContentFull() — explicit alias for export           │
 * │                                                                         │
 * │ Utils/process-message.ts                                                │
 * │   + cleanMessage()     — rc9 has but doesn't export from barrel         │
 * │   + isRealMessage()    — rc9 has but doesn't export from barrel         │
 * │   + getChatId()        — rc9 has but doesn't export from barrel         │
 * │   + shouldIncrementChatUnread() — rc9 has but doesn't export            │
 * │   + decryptPollVote()  — export from barrel                             │
 * │                                                                         │
 * │ Utils/history.ts                                                        │
 * │   ~ processHistoryMessage() — add jid field on contacts (wileys compat) │
 * │   ~ processHistoryMessage() — preserve archived/muteEndTime/pinned del  │
 * │                                                                         │
 * │ Socket/messages-recv.ts                                                 │
 * │   + SHARE_PHONE_NUMBER → chats.phoneNumberShare event                   │
 * │   + participant @lid → node.attrs.participant_pn resolution             │
 * │   + remoteJid @lid → node.attrs.sender_pn / peer_recipient_pn           │
 * │   + groupParticipantJidCache with both id and lid keys                  │
 * │   + warmupGroupParticipants() — rate-limited group metadata fetch       │
 * │   + resolveGroupParticipantJid() — async cache-first resolution         │
 * │   + contextInfo.participant @lid → resolved PN                          │
 * │                                                                         │
 * │ Socket/messages-send.ts (FULL REPLACEMENT)                              │
 * │   + media_id + mediatype attrs on relayMessage stanza                   │
 * │   + album message support                                               │
 * │   + biz + bot nodes for interactive/buttons/list                        │
 * │   + mediaHandle.handle → media_id                                       │
 * │                                                                         │
 * │ Socket/chats.ts                                                         │
 * │   + updateDisableLinkPreviewsPrivacy() — already in rc9, export it      │
 * │                                                                         │
 * │ Utils/index.ts (barrel)                                                 │
 * │   + all new/restored exports above                                      │
 * │   + captureEventStream + readAndEmitEventStream                         │
 * │   + makeInMemoryStore                                                   │
 * │                                                                         │
 * │ src/index.ts                                                            │
 * │   + all patch exports added                                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * COMBINED LID RESOLUTION PIPELINE (both rc9 + wileys methods):
 *   1. node.attrs.participant_pn / sender_pn (SYNC, per-message, most accurate)
 *   2. contactLidStore from contacts.upsert / chats.phoneNumberShare (SYNC)
 *   3. groupParticipantJidCache — LID-keyed and id-keyed (SYNC, TTL 10min)
 *   4. signalRepository.lidMapping.getPNForLID() (ASYNC, rc9 authoritative)
 *   5. groupMetadata fetch + warmup (ASYNC, rate-limited 60s)
 *   6. getBotJid() via BOT_MAP (SYNC, for @bot JIDs)
 *   7. lidToJid() naive strip (SYNC, last resort — wrong PN, won't crash)
 */
// ─── This file is a documentation + type anchor ──────────────────────────────
// The actual patches are emitted by apply-patches.ts as direct source writes.
// All TypeScript implementations in this file are the CANONICAL VERSIONS
// that apply-patches.ts reads and injects.
export const PATCH_VERSION = '10.0.0';
export const WILEYS_COMPAT = 'wileys@latest';
export const BAILEYS_TARGET = '@whiskeysockets/baileys@7.0.0-rc.9';
export const PATCH_MANIFEST = [
    { file: 'WABinary/jid-utils.ts', patches: ['lidToJid', 'getBotJid', 'isJidUser', 'jidToLid'] },
    { file: 'Utils/messages.ts', patches: ['normalizeMessageContent-23wrappers', 'normalizeMessageContentFull'] },
    { file: 'Utils/process-message.ts', patches: ['export-cleanMessage', 'export-isRealMessage', 'export-getChatId', 'export-shouldIncrementChatUnread', 'export-decryptPollVote', 'isRealMessage-meId-param'] },
    { file: 'Utils/history.ts', patches: ['contact-jid-field', 'preserve-chat-cleanup'] },
    { file: 'Socket/messages-recv.ts', patches: ['phoneNumberShare-event', 'participant-lid-resolve', 'remoteJid-lid-resolve', 'groupParticipantCache-dual-key', 'warmupGroupParticipants', 'resolveGroupParticipantJid', 'contextInfo-lid-resolve'] },
    { file: 'Socket/messages-send.ts', patches: ['FULL-REPLACEMENT-wileys-port'] },
    { file: 'Utils/index.ts', patches: ['barrel-all-new-exports', 'captureEventStream', 'readAndEmitEventStream'] },
    { file: 'src/index.ts', patches: ['createSocket', 'makeInMemoryStore', 'all-patch-exports'] },
];
//# sourceMappingURL=wileys-compat-patch.js.map