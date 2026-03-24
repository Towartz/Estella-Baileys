/**
 * baileys-compat.ts — custom-baileys v10 Enterprise (INSIDE-BAILEYS VERSION)
 * Rewritten by apply-patches.ts — all module paths verified against baileys@7.0.0-rc.9.
 */
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const _dir = dirname(fileURLToPath(import.meta.url));
export const BAILEYS_PATH = _dir;
export { default as makeWASocket } from './Socket/index.js';
export { useMultiFileAuthState } from './Utils/use-multi-file-auth-state.js';
export { fetchLatestBaileysVersion } from './Utils/generics.js';
export { makeCacheableSignalKeyStore } from './Utils/auth-utils.js';
export { DisconnectReason } from './Types/index.js';
export { delay } from './Utils/generics.js';
export { generateWAMessageFromContent, generateWAMessage, generateWAMessageContent, prepareWAMessageMedia, normalizeMessageContent, getContentType, downloadMediaMessage, getDevice, updateMessageWithReaction, updateMessageWithReceipt, updateMessageWithPollUpdate, getAggregateVotesInPollMessage } from './Utils/messages.js';
export { generateMessageIDV2, generateMessageID, getKeyAuthor, toNumber } from './Utils/generics.js';
export { jidNormalizedUser, jidDecode, jidEncode, areJidsSameUser, isJidGroup, isJidBroadcast, isJidStatusBroadcast, isJidNewsletter, isJidUser, isJidBot, isJidMetaAI as isJidMetaAi } from './WABinary/index.js';
export default (await import('./Socket/index.js')).default;
//# sourceMappingURL=baileys-compat.js.map