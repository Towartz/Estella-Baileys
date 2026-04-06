# Feature.md — Baileys v10 Changes

> Based on `git diff` between master commit and the patched version (custom-baileys v10).

---

## 1. WAProto Refresh

### WhatsApp Web Version
- Old: `2.3000.1029496320`
- New: `2.3000.1036692702`

---

### 1.1 New Message Fields (Type-Level)

| Field ID | Message Type | Description |
|----------|-------------|-----------|
| `115` (shifted from 114) | `PollResultSnapshotMessage` | Replaced (field number shift) |
| `116` | `FutureProofMessage newsletterAdminProfileMessage` | Newsletter admin profile |
| `117` | `FutureProofMessage newsletterAdminProfileMessageV2` | Newsletter admin profile v2 |
| `118` | `FutureProofMessage spoilerMessage` | Message with hidden content (spoiler) |
| `119` | `PollCreationMessage pollCreationMessageV6` | Advanced poll with endTime, hideParticipantName, allowAddOption |
| `120` | `ConditionalRevealMessage` | Conditional reveal message (encryption, scheduled message) |
| `121` | `PollAddOptionMessage` | Add option to existing poll |
| `122` | `EventInviteMessage` | Event invitation (eventId, title, startTime, thumbnail, caption) |
| `123` | `GroupRootKeyShare` | Group root key for group encryption |

### 1.2 New Messages (Top-Level Messages)

#### EventInviteMessage
```proto
message EventInviteMessage {
    optional ContextInfo contextInfo = 1;
    optional string eventId = 2;
    optional string eventTitle = 3;
    optional bytes jpegThumbnail = 4;
    optional int64 startTime = 5;
    optional string caption = 6;
    optional bool isCanceled = 7;
}
```

#### ConditionalRevealMessage
```proto
message ConditionalRevealMessage {
    optional bytes encPayload = 1;
    optional bytes encIv = 2;
    optional ConditionalRevealMessageType conditionalRevealMessageType = 3;
    optional string revealKeyId = 4;
    enum ConditionalRevealMessageType {
        UNKNOWN = 0;
        SCHEDULED_MESSAGE = 1;
    }
}
```

#### PollAddOptionMessage
```proto
message PollAddOptionMessage {
    optional MessageKey pollCreationMessageKey = 1;
    optional Option addOption = 2;
}
```

#### GroupRootKeyShare
```proto
message GroupRootKeyShare {
    repeated GroupRootKeyShareEntry keys = 1;
}
message GroupRootKeyShareEntry {
    optional bytes groupRootKey = 1;
    optional string keyId = 2;
    optional int64 expiryTimestampMs = 3;
}
```

#### AIMediaCollectionMessage / AIMediaCollectionMetadata
```proto
message AIMediaCollectionMessage {
    optional string collectionId = 1;
    optional uint32 expectedMediaCount = 2;
    optional bool hasGlobalCaption = 3;
}
message AIMediaCollectionMetadata {
    optional string collectionId = 1;
    optional uint32 uploadOrderIndex = 2;
}
```

#### Bot Command & Agent & Document & Group
```proto
// Bot command
message BotCommandMetadata {
    optional string commandName = 1;
    optional string commandDescription = 2;
    optional string commandPrompt = 3;
}

// Deep link agent bot
message BotAgentDeepLinkMetadata {
    optional string token = 1;
}
message BotAgentMetadata {
    optional BotAgentDeepLinkMetadata deepLinkMetadata = 1;
}

// Document plugin: text extraction and OCR
message BotDocumentMessageMetadata {
    optional DocumentPluginType pluginType = 1;
    enum DocumentPluginType {
        TEXT_EXTRACTION = 0;
        OCR_AND_IMAGES = 1;
    }
}

// Group bot — AI bots in groups
message BotGroupMetadata {
    repeated BotGroupParticipantMetadata participantsMetadata = 1;
}
message BotGroupParticipantMetadata {
    optional string botFbid = 1;
}
```

#### Bot Infrastructure Diagnostics
```proto
message BotInfrastructureDiagnostics {
    optional BotBackend botBackend = 1;
    repeated string toolsUsed = 2;
    optional bool isThinking = 3;
    enum BotBackend {
        AAPI = 0;
        CLIPPY = 1;
    }
}
```

#### BotRenderingConfigMetadata
```proto
message BotRenderingConfigMetadata {
    optional string bloksVersioningId = 1;
    optional double pixelDensity = 2;
}
```

#### InlineContact
```proto
message InlineContact {
    optional string pnJid = 1;
    optional string lidJid = 2;
    optional string fullName = 3;
    optional string firstName = 4;
    optional string username = 5;
}
```

#### MediaDomainInfo (Separate Enum — replaces old Message.MediaKeyDomain)
```proto
message MediaDomainInfo {
    optional MediaKeyDomain mediaKeyDomain = 1;
    optional bytes e2EeMediaKey = 2;
}
enum MediaKeyDomain {
    MEDIA_KEY_DOMAIN_UNKNOWN = 0;
    MEDIA_KEY_DOMAIN_E2EE = 1;
    MEDIA_KEY_DOMAIN_NON_E2EE = 2;
}
```

### 1.3 New Fields on Internal Messages

#### AudioMessage — field `mediaKeyDomain` REMOVED (line 23)
#### DocumentMessage — field `mediaKeyDomain` REMOVED (line 22)
Migrated to new context via `MediaDomainInfo` in ContextInfo.

#### ImageMessage — field `mediaKeyDomain` REMOVED (line 33)
#### StickerMessage — field `mediaKeyDomain` REMOVED (line 23)
#### MMSThumbnailMetadata — field `mediaKeyDomain` REMOVED (line 8)
#### VideoMessage — field `mediaKeyDomain` REMOVED (line 32)

Previously used `Message.MediaKeyDomain` local enum (UNSET, E2EE_CHAT, STATUS, CAPI, BOT).
Now moved to top-level `MediaKeyDomain` with different naming.

#### Call Message
```proto
optional MessageContextInfo messageContextInfo = 10;  // NEW
optional uint32 callEntryPoint = 11;  // NEW
```

#### ContactMessage
```proto
optional bool isSelfContact = 18;  // NEW
```

#### InteractiveMessage
```proto
optional BloksWidget bloksWidget = 8;  // NEW

message BloksWidget {
    optional string uuid = 1;
    optional string data = 2;
    optional string type = 3;
}

// Header also receives bloksWidget
message Header {
    optional BloksWidget bloksWidget = 10;  // NEW
}
```

#### FullHistorySyncOnDemandConfig (new)
```proto
message FullHistorySyncOnDemandConfig {
    optional uint64 historyFromTimestamp = 1;
    optional uint32 historyDurationDays = 2;
}
```

#### FullHistorySyncOnDemandRequestMetadata — new field
```proto
optional string businessProduct = 2;
optional bytes opaqueClientData = 3;
```

#### PollCreationMessage — new fields
```proto
optional int64 endTime = 9;
optional bool hideParticipantName = 10;
optional bool allowAddOption = 11;
```

#### SecretEncryptedMessage
```proto
optional string remoteKeyId = 5;  // NEW

// New SecretEncType enum values
MESSAGE_SCHEDULE = 3;
POLL_EDIT = 4;
POLL_ADD_OPTION = 5;
```

#### StickerMessage — new fields
```proto
optional int32 premium = 24;
optional string emojis = 25;
```

#### StickerPackMessage.Sticker — new field
```proto
optional int32 premium = 7;
```

#### ProtocolMessage — new fields and enum
```proto
optional AIMediaCollectionMessage aiMediaCollectionMessage = 28;
optional uint32 afterReadDuration = 29;

enum Type {
    AI_MEDIA_COLLECTION_MESSAGE = 31;
    MESSAGE_UNSCHEDULE = 32;
}
```

#### MessageContextInfo — new field
```proto
optional bytes teeBotMetadata = 17;
```

#### MsgOpaqueData — new fields
```proto
optional string quarantineExtractedText = 48;
optional int64 pollEndTime = 49;
optional bool pollHideVoterNames = 50;
optional bool pollAllowAddOption = 52;
```

#### MessageHistoryMetadata — new fields
```proto
// oldestMessageTimestamp → oldestMessageTimestampInWindow (rename)
optional int64 oldestMessageTimestampInWindow = 2;
optional int64 messageCount = 3;
optional repeated string nonHistoryReceivers = 4;
optional int64 oldestMessageTimestampInBundle = 5;
```

#### PeerDataOperationRequestMessage — new fields and sub-messages
```proto
optional CompanionCanonicalUserNonceFetchRequest companionCanonicalUserNonceFetchRequest = 10;
optional BizBroadcastInsightsContactListRequest bizBroadcastInsightsContactListRequest = 11;
optional BizBroadcastInsightsRefreshRequest bizBroadcastInsightsRefreshRequest = 12;

message FullHistorySyncOnDemandRequest {
    optional FullHistorySyncOnDemandConfig fullHistorySyncOnDemandConfig = 3;  // NEW
}

message GalaxyFlowAction {
    optional string galaxyFlowDownloadRequestId = 4;  // NEW
    optional string agmId = 5;  // NEW
    // New enum: DOWNLOAD_RESPONSES = 2;
}
```

#### PeerDataOperationRequestResponseMessage — new fields and sub-messages
```proto
optional FlowResponsesCsvBundle flowResponsesCsvBundle = 11;
optional BizBroadcastInsightsContactListResponse bizBroadcastInsightsContactListResponse = 12;

enum FullHistorySyncOnDemandResponseCode {
    ERROR_MULTI_PROVIDER_NOT_CONFIGURED = 7;  // NEW
}
```

#### PeerDataOperationRequestType — new enum values
```proto
BUSINESS_BROADCAST_INSIGHTS_DELIVERED_TO = 12;
BUSINESS_BROADCAST_INSIGHTS_REFRESH = 13;
```

#### RequestWelcomeMessageMetadata — new fields and enum
```proto
optional WelcomeTrigger welcomeTrigger = 2;
optional BotAgentMetadata botAgentMetadata = 3;

enum WelcomeTrigger {
    CHAT_OPEN = 0;
    COMPANION_PAIRING = 1;
}
```

#### PaymentInviteMessage — new fields
```proto
optional bool incentiveEligible = 3;
optional string referralId = 4;
optional InviteType inviteType = 5;

enum InviteType {
    DEFAULT = 0;
    MAPPER = 1;
}
```

#### PaymentExtendedMetadata — field REMOVED
```proto
// optional string messageParamsJson = 3; — REMOVED
```

#### CloudAPIThreadControlNotification — new enum value
```proto
INFO = 3;
```

#### InsightDeliveryState (new)
```proto
enum InsightDeliveryState {
    SENT = 0;
    DELIVERED = 1;
    READ = 2;
    REPLIED = 3;
    QUICK_REPLIED = 4;
}
```

#### ScheduledMessageMetadata (new top-level)
```proto
message ScheduledMessageMetadata {
    optional string revealKeyId = 1;
    optional bytes revealKey = 2;
    optional uint64 scheduledTime = 3;
}
```

---

### 1.4 New Fields on Message Context (ContextInfo)

| Field | ID | Type | Description |
|-------|----|-----|-----------|
| `isSpoiler` | 73 | bool | Spoiler message flag |
| `mediaDomainInfo` | 74 | MediaDomainInfo | Media key domain (E2EE vs non-E2EE) |
| `partiallySelectedContent` | 75 | PartiallySelectedContent | Partially selected text context |
| `afterReadDuration` | 76 | uint32 | Duration after read |

#### New sub-fields
```proto
// PartiallySelectedContent (new)
message PartiallySelectedContent {
    optional string text = 1;
}

// StatusAudienceMetadata — new field
optional string listName = 2;
optional string listEmoji = 3;

// ExternalAdReplyInfo — new fields (AGM strategy)
optional bool containsCtwaFlowsAutoReply = 28;
optional int32 agmThumbnailStrategy = 29;
optional int32 agmTitleStrategy = 30;
optional int32 agmSubtitleStrategy = 31;
optional int32 agmHeaderInteractionStrategy = 32;

// ForwardNewsletterMessageInfo — new field
optional string profileName = 6;
```

---

### 1.5 New Fields on Conversation

| Field | ID | Type | Description |
|-------|----|-----|-----------|
| `isMarketingMessageThread` | 55 | bool | Marketing message thread |
| `isSenderNewAccount` | 56 | bool | New sender (new account) |
| `afterReadDuration` | 57 | uint32 | Duration after read |

```proto
// EndOfHistoryTransferType — new enum value
COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS = 3;
```

---

### 1.6 Device Capabilities — Changes

```proto
message DeviceCapabilities {
    optional AiThread aiThread = 6;  // NEW
    message AiThread {
        optional SupportLevel supportLevel = 1;
        enum SupportLevel {
            NONE = 0;
            INFRA = 1;
            FULL = 2;
        }
    }

    message BusinessBroadcast {
        optional bool importListEnabled = 1;
        optional bool companionSupportEnabled = 2;     // NEW
        optional bool campaignSyncEnabled = 3;         // NEW
        optional bool insightsSyncEnabled = 4;          // NEW
        optional int32 recipientLimit = 5;              // NEW
    }
}
```

---

### 1.7 DeviceProps.HistorySyncConfig — New Fields

| Field | ID | Type | Description |
|-------|----|-----|-----------|
| `initialSyncMaxMessagesPerChat` | 20 | uint32 | Max messages per chat during initial sync |
| `supportManusHistory` | 21 | bool | Support Manus history sync |
| `supportHatchHistory` | 22 | bool | Support Hatch history sync |
| `supportedBotChannelFbids` | 23 | repeated string | Supported bot channel FBIDs |
| `supportInlineContacts` | 24 | bool | Support inline contacts |

---

### 1.8 ClientPayload — New Fields

```proto
optional repeated string pairedPeripherals = 47;
message WebInfo {
    optional string browser = 5;          // NEW
    optional string browserVersion = 6;   // NEW
}

// ProxyConfig — new enum values
MNS_SECONDARY = 6;
SOCKS_PROXY = 7;
```

---

### 1.9 ClientPairingProps — New Fields

```proto
optional bool isHsThumbnailSyncEnabled = 4;
optional bytes subscriptionSyncPayload = 5;
```

---

### 1.10 HandshakeMessage — Post-Quantum Crypto

```proto
// ClientHello — new fields
optional bytes paddedBytes = 6;
optional bool sendServerHelloPaddedBytes = 7;
optional bool simulateXxkemFs = 8;
optional HandshakePqMode pqMode = 9;
optional bytes extendedEphemeral = 10;

// ServerHello — new fields
optional bytes paddingBytes = 5;
optional bytes extendedCiphertext = 6;

// ClientHello encrypted static — new fields
optional bytes paddedBytes = 4;
optional bool simulateXxkemFs = 5;

// New enum: HandshakePqMode (8 modes)
enum HandshakePqMode {
    HANDSHAKE_PQ_MODE_UNKNOWN = 0;
    XXKEM = 1;
    XXKEM_FS = 2;
    WA_CLASSICAL = 3;
    WA_PQ = 4;
    IKKEM = 5;
    IKKEM_FS = 6;
    XXKEM_2 = 7;
    IKKEM_2 = 8;
}
```

---

### 1.11 HistorySync — New Fields

```proto
// syncType becomes optional (was required)
optional HistorySyncType syncType = 1;

// New fields
optional bytes nctSalt = 19;
repeated InlineContact inlineContacts = 20;
optional bool inlineContactsProvided = 21;
```

---

### 1.12 Bot Metadata — Major Changes

#### BotAvatarMetadata REMOVED → Replaced with BotAgentMetadata
```proto
// REMOVED:
// optional BotAvatarMetadata avatarMetadata = 1;

// NEW: 6 fields on BotMetadata
optional BotDocumentMessageMetadata botDocumentMessageMetadata = 34;
optional BotGroupMetadata botGroupMetadata = 35;
optional BotRenderingConfigMetadata botRenderingConfigMetadata = 36;
optional BotInfrastructureDiagnostics botInfrastructureDiagnostics = 37;
optional AIMediaCollectionMetadata aiMediaCollectionMetadata = 38;
optional BotCommandMetadata commandMetadata = 39;
```

#### BotCapabilities — 10 New Enum Values (47 → 61)
```
RICH_RESPONSE_UR_ZEITGEIST_CITATIONS = 50;
RICH_RESPONSE_UR_ZEITGEIST_CAROUSEL = 51;
AI_IMAGINE_LOADING_INDICATOR = 52;
RICH_RESPONSE_UR_IMAGINE = 53;
AI_IMAGINE_UR_TO_NATIVE_LOADING_INDICATOR = 54;
RICH_RESPONSE_UR_BLOKS_ENABLED = 55;
RICH_RESPONSE_INLINE_LINKS_ENABLED = 56;
RICH_RESPONSE_UR_IMAGINE_VIDEO = 57;
JSON_PATCH_STREAMING = 58;
AI_TAB_FORCE_CLIPPY = 59;
UNIFIED_RESPONSE_EMBEDDED_SCREENS = 60;
AI_SUBSCRIPTION_ENABLED = 61;
```

#### BotMetricsEntryPoint — 9 New Enum Values
```
MEDIA_PICKER_1_ON_1_CHAT = 39;
MEDIA_PICKER_GROUP_CHAT = 40;
ASK_META_AI_NO_SEARCH_RESULTS = 41;
META_AI_SETTINGS = 45;
WEB_INTRO_PANEL = 46;
WEB_NAVIGATION_BAR = 47;
GROUP_MEMBER = 54;
CHATLIST_SEARCH = 55;
NEW_CHAT_LIST = 56;
```

#### BotModeSelectionMetadata
```proto
repeated uint32 overrideMode = 2;  // NEW

// Renamed enum
UNKNOWN_MODE → DEFAULT_MODE = 0;
REASONING_MODE → THINK_HARD_MODE = 1;
```

#### BotSessionSource — New Enum Value
```
AI_HOME_SESSION = 7;
```

#### BotProgressIndicatorMetadata
```proto
optional int64 estimatedCompletionTime = 3;  // NEW
```

#### BotSignatureVerificationUseCase — New Enum Value
```
WA_TEE_BOT_MSG = 2;
```

#### BotImagineMetadata
```proto
optional string shortPrompt = 2;  // NEW
```

#### BotMetricsThreadEntryPoint
```proto
optional AIThreadEntryPoint sideChatEntryPoint = 3;  // NEW
```

#### BotModeSelectionMetadata → BotUserSelectionMode Rename
```
UNKNOWN_MODE → DEFAULT_MODE
REASONING_MODE → THINK_HARD_MODE
```

---

### 1.13 AI Thread — Changes

#### AIThreadInfo.AIThreadClientInfo
```proto
optional string sourceChatJid = 2;
enum AIThreadType {
    UNKNOWN = 0;
    DEFAULT = 1;
    INCOGNITO = 2;
    SIDE_CHAT = 3;  // NEW
}
```

#### AIHomeState.AIHomeAction — new field and enum
```proto
optional string cardTypeId = 8;  // NEW
enum AIHomeActionType {
    PROMPT = 0;
    CREATE_IMAGE = 1;
    ANIMATE_PHOTO = 2;
    ANALYZE_FILE = 3;
    COLLABORATE = 4;  // NEW
}
```

---

### 1.14 ContextInfo — New Sub-Message

```proto
// PartiallySelectedContent (new, id 75)
message PartiallySelectedContent {
    optional string text = 1;
}
```

---

### 1.15 MessageAssociation — New Enum Value

```proto
POLL_ADD_OPTION = 20;
```

---

### 1.16 MutationProps — 10 New Enum Values

```
SETTINGS_SYNC_ACTION = 78;
OUT_CONTACT_ACTION = 79;
NCT_SALT_SYNC_ACTION = 80;
BUSINESS_BROADCAST_CAMPAIGN_ACTION = 81;
BUSINESS_BROADCAST_INSIGHTS_ACTION = 82;
CUSTOMER_DATA_ACTION = 83;
SUBSCRIPTIONS_SYNC_V2_ACTION = 84;
THREAD_PIN_ACTION = 85;
AI_THREAD_DELETE_ACTION = 10003;
```

---

### 1.17 StatusAttribution — New Enum Value

```
SOUNDCLOUD = 11;
```

---

### 1.18 Minor Changes — Fields Made Optional

| Field | Old | New |
|-------|------|-----|
| `Conversation.id` | `string id = 1` | `optional string id = 1` |
| `GroupParticipant.userJid` | `string userJid = 1` | `optional string userJid = 1` |
| `HistorySync.syncType` | `HistorySyncType syncType = 1` | `optional HistorySyncType syncType = 1` |
| `LIDMigrationMapping.pn` | `uint64 pn = 1` | `optional uint64 pn = 1` |
| `LIDMigrationMapping.assignedLid` | `uint64 assignedLid = 2` | `optional uint64 assignedLid = 2` |
| `Citation` — all fields | required | optional |
| `VideoEndCard` — all fields | required | optional |

---

### 1.19 New File
- `src/Utils/wileys-event-stream.ts` — Event stream capture and playback for debugging/testing

---

## 2. LID/JID Core (src/WABinary/jid-utils.ts)

### New Functions
| Function | Description |
|----------|-----------|
| `lidToJid(jid)` | Convert `@lid` → `@s.whatsapp.net` (strip LID domain) |
| `jidToLid(jid)` | Convert `@s.whatsapp.net` → `@lid` (for cache key) |
| `getBotJid(jid)` | Resolve `@bot` JID to phone JID via BOT_MAP (120+ entries) |
| `isJidUser(jid)` | Alias for `isPnUser` — check if JID ends with `@s.whatsapp.net` |

---

## 3. Socket Messages Send (src/Socket/messages-send.ts) — FULL REPLACEMENT

This file is **completely replaced** with the wileys port version. Main changes:

- `NodeCache` import retained for session caching
- WAProto imported via `createRequire()` (not direct ESM) for compatibility
- `relayMessage` uses `authState.keys.transaction(exec, 'relayMessage')`
- Album messages support with delay handling
- Bot nodes and business nodes support in relay
- `extractDeviceJids` called with 4 arguments (rc9 signature)
- Media handle via `(up as any).handle` for media relay
- `messageRetryManager` passed through from underlying socket
- `getStatusCodeForMediaRetry` argument cast to number
- `assertSessions` accepts `force?: boolean` parameter

---

## 4. Socket Messages Receive (src/Socket/messages-recv.ts)

### MEX Notification Modernization
- Old handler `handleMexNewsletterNotification` replaced with `handleMexNotification`
- Supports two modes: **Modern GQL** (op_name-based) and **Legacy Mexican** (<mex> child)
- Modern GQL: parse JSON from `update` node, route by `op_name`
- 15+ op_name types for newsletter operations (join, leave, promote, demote, etc.)

### New Mex Notification Types
| Op Name | Handler | Description |
|---------|---------|-----------|
| `NotificationUserReachoutTimelockUpdate` | `handleReachoutTimelockNotification` | Business commerce timelock restriction |
| `MessageCappingInfoNotification` | `handleMessageCappingNotification` | New chat message limit |
| Newsletter operations | `handleLegacyMexNewsletterNotification` | Fallback to old structure |

### Call Ack Fix
- Stanza ack for `call` tag now copies type from child node

### Read Receipt Fix
- `sendReceipt` now uses `(msg.key.id ?? '') as string` (empty string fallback)
- Type ack uses `'read'` as default

---

## 5. Socket Chats (src/Socket/chats.ts)

### App-State Sync Resilience
- Imports `HISTORY_SYNC_PAUSED_TIMEOUT_MS` (120 seconds) from Defaults
- Imports resilience helpers from app-state sync
- Local `MAX_SYNC_ATTEMPTS` constant removed, uses shared helper

### History Sync Pause Tracking
- State tracking for history sync pause
- State tracking for blocked collections
- Retry loop supports forced snapshot retries
- Retry loop supports version repair
- Error differentiation between missing-key blocking and fatal errors
- New events: `history-sync.completion` and `history-sync.paused.status`
- Full app-state sync now clears blocked collections before retry
- Connection update flow: tracks history stalls and retries blocked collections

---

## 6. Utils Messages (src/Utils/messages.ts)

### normalizeMessageContent — 5 → 23 Wrappers
**Old:** Only 5 future-proof message types (ephemeralMessage, viewOnceMessage, documentWithCaptionMessage, viewOnceMessageV2, viewOnceMessageV2Extension, editedMessage, associatedChildMessage, groupStatusMessage, groupStatusMessageV2)

**New:** 23 wrapper types including: ephemeralMessage, viewOnceMessage, documentWithCaptionMessage, viewOnceMessageV2, viewOnceMessageV2Extension, editedMessage, groupMentionedMessage, botInvokeMessage, lottieStickerMessage, eventCoverImage, statusMentionMessage, pollCreationOptionImageMessage, associatedChildMessage, groupStatusMentionMessage, pollCreationMessageV4, pollCreationMessageV5, statusAddYours, groupStatusMessage, limitSharingMessage, botTaskMessage, questionMessage, groupStatusMessageV2, botForwardedMessage

### Interactive Buttons Handler
- New handler in `generateWAMessageContent` before text branch
- Supports: `interactiveButtons`, `nativeFlowMessage`, `nativeFlowButtons`
- Fixes ghost messages where buttons arrive as plain text
- Builds interactiveMessage with body, footer, header, contextInfo

### Status/Broadcast Media
- Media upload now stores full upload result
- Status/broadcast media reads CDN handle from upload result
- Status/broadcast media omits `url` when WhatsApp returns media handle
- Status/broadcast media skips `mediaKeyTimestamp` when WhatsApp returns handle

### Event Invite Message
- New message type: `eventInvite` with eventId, eventTitle, startTime, caption, jpegThumbnail, isCanceled

### Advanced Poll Support
- `pollCreationMessageV6` with endTime, hideParticipantName, allowAddOption
- `pollAddOptionMessage` to add poll options
- `pollUpdateMessage` for vote updates on polls

### TypeScript Fix
- `return content` → `return content ?? undefined` to prevent TS2322

---

## 7. Types (src/Types/)

### Message.ts (src/Types/Message.ts)
- `MessageWithContextInfo` → new fields: `eventInviteMessage`, `pollCreationMessageV6`
- `PollMessageOptions` → new fields: `endDate`, `hideParticipantName`, `allowAddOption`
- `AnyRegularMessageContent` → support `eventInvite`, `pollAddOption`

### Events.ts (src/Types/Events.ts)
- `messaging-history.set` → expose `chunkOrder`
- New `messaging-history.status` event typing
- `BufferedEventData.historySets` → carry `lidPnMappings` and `chunkOrder`

### State.ts (src/Types/State.ts) — NEW/EXTENSIVE FILE
| Type | Description |
|------|-----------|
| `ReachoutTimelockState` | Timelock state (isActive, timeEnforcementEnds, enforcementType) |
| `ReachoutTimelockEnforcementType` | 17 commerce violation types + DEFAULT + WEB_COMPANION_ONLY |
| `NewChatMessageCappingStatusType` | NONE → FIRST_WARNING → SECOND_WARNING → CAPPED |
| `NewChatMessageCappingMVStatusType` | NOT_ELIGIBLE, NOT_ACTIVE, ACTIVE, ACTIVE_UPGRADE_AVAILABLE |
| `NewChatMessageCappingOTEStatusType` | NOT_ELIGIBLE, ELIGIBLE, ACTIVE_IN_CURRENT_CYCLE, EXHAUSTED |
| `NewChatMessageCapInfo` | Total/used quota, cycle timestamps, ote/mv/capping status |
| `ConnectionState.reachoutTimeLock` | New field in ConnectionState |

### index.ts
- Expose `Browsers.android(...)` type

---

## 8. Auth & Crypto

### auth-utils.ts — PQueue → Mutex
- **Dependency removed:** `p-queue`
- All queue operations replaced with `Mutex` from `async-mutex`
- Cache mutex wrapper removed
- Cache get and set paths no longer serialize through mutex
- Key queues replaced with key mutex map
- Direct-write queue helper replaced with mutex helper
- Direct writes now use per-type mutexes
- Comment flow updated for mutex flow

### pre-key-manager.ts — PQueue → Mutex
- Import `Mutex` replacing `PQueue`
- Stores mutexes replacing queues
- Helper `withDeviceMutex` uses `mutex.runExclusive`
- All pre-key operations now use mutex for thread-safety

---

## 9. History (src/Utils/history.ts)

- Import stream pipeline for inflate
- Import `createInflate` for decompression
- Hoist root participant to `key.participant`
- `downloadHistory` now inflates history via stream pipeline (not Buffer concat)
- Contact `jid` field added
- Normalize root participant before downstream processing
- Chat objects now reuse objects (not clone) for efficiency

---

## 10. Event Buffer (src/Utils/event-buffer.ts)

- Buffered history events now retain `chunkOrder` and merged `lidPnMappings`
- Consolidated history events now emit `chunkOrder` and `lidPnMappings`

---

## 11. Messages Media (src/Utils/messages-media.ts)

- `downloadEncryptedContent` — skip `Buffer.concat` when no remainder (optimization)
- `generateProfilePicture` — keep full image (not square-crop) for profile uploads

---

## 12. Process Message (src/Utils/process-message.ts)

- `isRealMessage` now accepts optional `meId` (wileys compat)
- `messaging-history.set` now forwards history `chunkOrder`
- `cleanMessage` — normalize nested reaction/poll keys for 1:1 chats

---

## 13. Validate Connection (src/Utils/validate-connection.ts)

- Android user agent platform advertisement when `browser[1]` is "Android"
- Skip webInfo for Android browser payloads
- Map Android browser sessions to `ANDROID_PHONE` companion props

---

## 14. Defaults (src/Defaults/)

### index.ts
- New export: `HISTORY_SYNC_PAUSED_TIMEOUT_MS = 120_000` (same as WA Web's handleChunkProgress / restartPausedTimer)

### baileys-version.json
- Version: `[2, 3000, 1035194821]` → `[2, 3000, 1036692702]`

---

## 15. Browser Utils (src/Utils/browser-utils.ts)

- Export `getPlatformId` for platform identification
- Android platform support for view-once capable sessions

---

## 16. Chat Utils (src/Utils/chat-utils.ts)

- Repair invalid LTHash state versions
- Export missing-key helpers
- `encodeSyncdPatch` now explicitly tags missing app-state keys
- `decodeSyncdMutations` now surfaces missing-key state
- `decodeSyncdPatch` now surfaces missing-key state
- Snapshot/patch verification now surfaces missing-key state

---

## 17. Generics (src/Utils/generics.ts)

- Remove timeout stack capture overhead (performance optimization)
- `delayCancellable` stack capture removed
- `delayCancellable` cancel path simplified
- `promiseTimeout` stack capture removed
- `promiseTimeout` timeout Boom simplified

---

## 18. Signal

### lid-mapping.ts
- Import `isHostedLidUser`
- Hosted LID/PN mapping validation
- Hosted.lid reverse lookup accepted
- Device 99 resolves to hosted.lid on PN→LID lookup
- LID→PN reverse mapping preserves hosted device 99

### libsignal.ts
- Device 99 migrations now force `hosted.lid` targets
- Logic: `fromDecoded.device === 99 && rawTargetDecoded.server === 'lid'` → `${rawTargetDecoded.user}:99@hosted.lid`

---

## 19. Groups (src/Socket/groups.ts)

- Group metadata now preserves `addressingMode` (LID vs PN)
- `addressingMode: group.attrs.addressing_mode === 'lid' ? LID : PN`

---

## 20. New Patch Files (src/patch/)

| File | Lines | Description |
|------|-------|-----------|
| `wileys-patch.ts` | 45,168 | LID ev.emit intercept + group cache wiring + PN-first incoming fallback |
| `wileys-utils.ts` | 29,540 | Utility functions: normalizeMessageContentFull, extractMessageContent, isRealMessage, shouldIncrementChatUnread, getChatId, fetchLatestWileysVersion, captureEventStream, readAndEmitEventStream, ALL_WA_PATCH_NAMES, META_AI_JID, OFFICIAL_BIZ_JID, and more |
| `make-in-memory-store.ts` | 31,413 | In-memory store for chats & messages with WileysStore, WileysChatKey, WileysStoreConfig |
| `status-patch.ts` | 22,503 | WhatsApp Status/story sending with 23-wrapper awareness |
| `group-status-patch.ts` | 20,072 | Group status V2 send |
| `interactive-buttons.ts` | 38,532 | Buttons, lists, sections: sendButtons, sendListMessage, sendInteractive, InteractiveMessageOptions |
| `read-receipt-guard.ts` | 627 | Block read receipts via globalThis flag (getAuroraBlockReadReceipts, setAuroraBlockReadReceipts, clearAuroraBlockReadReceipts) |
| `wileys-compat-patch.ts` | 7,384 | Runtime compatibility patches |

---

## 21. New Standalone Files

| File | Lines | Description |
|------|-------|-----------|
| `make-wa-socket.ts` | 27,120 | `createSocket()` — Enhanced WA socket with auto-apply patches at runtime |
| `baileys-compat.ts` | 1,935 | Static direct imports from Baileys modules for compat |
| `plugin-compat.ts` | 16,070 | Plugin compatibility layer |
| `wileys-types.ts` | 7,037 | Wileys type definitions |
| `wileys-baileys-types-stub.d.ts` | 1,076 | Type stub for @whiskeysockets/baileys |

---

## 22. New Utility Files (src/utils/)

| File | Lines | Description |
|------|-------|-----------|
| `jid.ts` | 19,747 | Comprehensive JID utilities for LID/PN resolution and caching |

---

## 23. Entry Point (src/index.ts)

New top-level exports:
- `from './patch/wileys-patch'` — LID/JID resolution functions
- `from './patch/wileys-utils'` — Wileys utility functions
- `from './patch/make-in-memory-store'` — In-memory store
- `from './patch/status-patch'` — Status message support
- `from './patch/group-status-patch'` — Group status support
- `from './patch/interactive-buttons'` — Interactive buttons
- `from './patch/read-receipt-guard'` — Read receipt control
- `from './make-wa-socket'` — createSocket factory

---

## 24. TypeScript Config (tsconfig.build.json)

- Path alias `@whiskeysockets/baileys` → stub + `lib/index.d.ts`
- 16 lines changed to accommodate stub resolution

---

## 25. DIFILES (Removed from Tracking)

| File | Description |
|------|-----------|
| `Example/example.ts` | Example file removed from tracking |
| `Media/*` | All media files (logo, images, audio, video) removed from tracking |

---

## Summary

### Statistics
| Metric | Value |
|--------|-------|
| Files changed | 41 |
| Lines added | +13,701 |
| Lines removed | -3,215 |
| New files created | 12+ |
| New patch steps | 126 |

### Key Areas
1. **WAProto**: Refresh to latest version with 50+ new message/field types
2. **LID/JID**: Complete Linked ID vs Phone Number resolution system with 120+ BOT_MAP entries
3. **MEX**: Modernization handler for 15+ notification types
4. **Message Content**: normalizeMessageContent 5→23 wrappers, interactive buttons, event invite, advanced polls
5. **Auth/Security**: PQueue → Mutex migration, hosted device 99 support, reachout timelock
6. **Media**: Download optimization, full aspect ratio profile pictures, status/broadcast CDN handle
7. **History**: Stream inflate, LID/PN mappings, root participant hoist
8. **App-State Sync**: Pause tracking, blocked collection retry, version repair
9. **Status & Group Status**: Full support for WhatsApp Stories
10. **Interactive Messages**: Buttons, lists, sections, native flow
