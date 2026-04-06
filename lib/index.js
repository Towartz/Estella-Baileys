import './banner.js';
import makeWASocket from './Socket/index.js';
export * from '../WAProto/index.js';
export * from './Utils/index.js';
export * from './Types/index.js';
export * from './Defaults/index.js';
export * from './WABinary/index.js';
export * from './WAM/index.js';
export * from './WAUSync/index.js';
export { makeWASocket };
export default makeWASocket;
// ── custom-baileys v10: LID / JID ──────────────────────────────────────
export { lidToJid, getBotJid, normalizeJid, isLidUser, isJidLid, isJidUser as isJidUserPatch, isJidBot, isJidMetaAi as isJidMetaAiPatch, parseJid, jidToLid, resolveJidSync, areJidsSameUserFull, toJid, getSenderLid, getSenderPN, patchBaileys, resolveLidToPN, resolveLidFull, cacheGroupParticipants, resolveGroupParticipant, resolveGroupParticipantJid, warmupGroupParticipants, getTextFromMessage, normalizeMessageLid, fixHistorySyncParticipant, initContactStore, getLidContactJid } from './patch/wileys-patch.js';
// ── custom-baileys v10: wileys-utils ────────────────────────────────────
export { META_AI_JID, OFFICIAL_BIZ_JID, isJidMetaAi, isJidBotPhone, getSenderLidFull, extractMessageContent, isRealMessage, shouldIncrementChatUnread, getChatId, cleanMessage, fetchLatestWileysVersion, captureEventStream, readAndEmitEventStream, ALL_WA_PATCH_NAMES, normalizeMessageContentFull as normalizeMessageContentFullUtils } from './patch/wileys-utils.js';
// ── custom-baileys v10: makeInMemoryStore (wileys@latest) ───────────────
export { makeInMemoryStore, waChatKey, waMessageID } from './patch/make-in-memory-store.js';
// ── custom-baileys v10: status ───────────────────────────────────────────
export { patchStatusSend, patchRelayMessageForStatus, patchSendMessageMediaId, getStatusMediaType, STATUS_JID, StatusFont, assertColorARGB, FUTURE_PROOF_WRAPPERS, normalizeMessageContentFull, patchNormalizeMessageContent } from './patch/status-patch.js';
// ── custom-baileys v10: group status ─────────────────────────────────────
export { patchGroupStatusSend, assertGroupStatusV2Ready, isGroupStatusV2Content } from './patch/group-status-patch.js';
// ── custom-baileys v10: interactive buttons ──────────────────────────────
export { getInteractiveResponse, injectInteractiveButtons, btn, InteractiveValidationError, validateAndNormalizeButtons, validateAndNormalizeSections, validateAuthoringButtons } from './patch/interactive-buttons.js';
// ── custom-baileys v10: read receipt guard ───────────────────────────────
export { getAuroraBlockReadReceipts, setAuroraBlockReadReceipts, clearAuroraBlockReadReceipts } from './patch/read-receipt-guard.js';
// ── custom-baileys v10: createSocket ─────────────────────────────────────
export { createSocket, PatchNotAppliedError } from './make-wa-socket.js';
//# sourceMappingURL=index.js.map