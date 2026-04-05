# Feature.md — Baileys v10 Wileys Enterprise Changes

> Berdasarkan `git diff` antara commit master dan versi yang telah di-patch (custom-baileys v10).

---

## 1. WAProto Refresh

### Versi WhatsApp Web
- Lama: `2.3000.1029496320`
- Baru: `2.3000.1036692702`

---

### 1.1 Pesan Baru di Message (Type-Level)

| Field ID | Message Type | Keterangan |
|----------|-------------|-----------|
| `115` (pergeseran dari 114) | `PollResultSnapshotMessage` | Replaced (field number shift) |
| `116` | `FutureProofMessage newsletterAdminProfileMessage` | Profil admin newsletter |
| `117` | `FutureProofMessage newsletterAdminProfileMessageV2` | Profil admin newsletter v2 |
| `118` | `FutureProofMessage spoilerMessage` | Pesan dengan konten tersembunyi (spoiler) |
| `119` | `PollCreationMessage pollCreationMessageV6` | Poll lanjutan dengan endTime, hideParticipantName, allowAddOption |
| `120` | `ConditionalRevealMessage` | Pesan reveal bersyarat (enkripsi, scheduled message) |
| `121` | `PollAddOptionMessage` | Menambah opsi ke poll yang sudah ada |
| `122` | `EventInviteMessage` | Undangan event (eventId, title, startTime, thumbnail, caption) |
| `123` | `GroupRootKeyShare` | Kunci root grup untuk enkripsi grup |

### 1.2 Message Baru (Top-Level Message Baru)

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
// Perintah bot
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

// Plugin dokumen: text extraction dan OCR
message BotDocumentMessageMetadata {
    optional DocumentPluginType pluginType = 1;
    enum DocumentPluginType {
        TEXT_EXTRACTION = 0;
        OCR_AND_IMAGES = 1;
    }
}

// Group bot — AI bots dalam grup
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

#### MediaDomainInfo (Enum terpisah — menggantikan Message.MediaKeyDomain lama)
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

### 1.3 Field Baru pada Message Internal

#### AudioMessage — field `mediaKeyDomain` DIHAPUS (line 23)
#### DocumentMessage — field `mediaKeyDomain` DIHAPUS (line 22)
Migrasi ke konteks baru via `MediaDomainInfo` di ContextInfo.

#### ImageMessage — field `mediaKeyDomain` DIHAPUS (line 33)
#### StickerMessage — field `mediaKeyDomain` DIHAPUS (line 23)
#### MMSThumbnailMetadata — field `mediaKeyDomain` DIHAPUS (line 8)
#### VideoMessage — field `mediaKeyDomain` DIHAPUS (line 32)

Dulu menggunakan `Message.MediaKeyDomain` enum lokal (UNSET, E2EE_CHAT, STATUS, CAPI, BOT).
Sekarang enum dipindah ke top-level `MediaKeyDomain` dengan naming berbeda.

#### Call Message
```proto
optional MessageContextInfo messageContextInfo = 10;  // BARU
optional uint32 callEntryPoint = 11;  // BARU
```

#### ContactMessage
```proto
optional bool isSelfContact = 18;  // BARU
```

#### InteractiveMessage
```proto
optional BloksWidget bloksWidget = 8;  // BARU

message BloksWidget {
    optional string uuid = 1;
    optional string data = 2;
    optional string type = 3;
}

// Header juga mendapat bloksWidget
message Header {
    optional BloksWidget bloksWidget = 10;  // BARU
}
```

#### FullHistorySyncOnDemandConfig (baru)
```proto
message FullHistorySyncOnDemandConfig {
    optional uint64 historyFromTimestamp = 1;
    optional uint32 historyDurationDays = 2;
}
```

#### FullHistorySyncOnDemandRequestMetadata — field baru
```proto
optional string businessProduct = 2;
optional bytes opaqueClientData = 3;
```

#### PollCreationMessage — field baru
```proto
optional int64 endTime = 9;
optional bool hideParticipantName = 10;
optional bool allowAddOption = 11;
```

#### SecretEncryptedMessage
```proto
optional string remoteKeyId = 5;  // BARU

// Enum SecretEncType baru
MESSAGE_SCHEDULE = 3;
POLL_EDIT = 4;
POLL_ADD_OPTION = 5;
```

#### StickerMessage — field baru
```proto
optional int32 premium = 24;
optional string emojis = 25;
```

#### StickerPackMessage.Sticker — field baru
```proto
optional int32 premium = 7;
```

#### ProtocolMessage — field dan enum baru
```proto
optional AIMediaCollectionMessage aiMediaCollectionMessage = 28;
optional uint32 afterReadDuration = 29;

enum Type {
    AI_MEDIA_COLLECTION_MESSAGE = 31;
    MESSAGE_UNSCHEDULE = 32;
}
```

#### MessageContextInfo — field baru
```proto
optional bytes teeBotMetadata = 17;
```

#### MsgOpaqueData — field baru
```proto
optional string quarantineExtractedText = 48;
optional int64 pollEndTime = 49;
optional bool pollHideVoterNames = 50;
optional bool pollAllowAddOption = 52;
```

#### MessageHistoryMetadata — field baru
```proto
// oldestMessageTimestamp → oldestMessageTimestampInWindow (rename)
optional int64 oldestMessageTimestampInWindow = 2;
optional int64 messageCount = 3;
optional repeated string nonHistoryReceivers = 4;
optional int64 oldestMessageTimestampInBundle = 5;
```

#### PeerDataOperationRequestMessage — field dan sub-message baru
```proto
optional CompanionCanonicalUserNonceFetchRequest companionCanonicalUserNonceFetchRequest = 10;
optional BizBroadcastInsightsContactListRequest bizBroadcastInsightsContactListRequest = 11;
optional BizBroadcastInsightsRefreshRequest bizBroadcastInsightsRefreshRequest = 12;

message FullHistorySyncOnDemandRequest {
    optional FullHistorySyncOnDemandConfig fullHistorySyncOnDemandConfig = 3;  // BARU
}

message GalaxyFlowAction {
    optional string galaxyFlowDownloadRequestId = 4;  // BARU
    optional string agmId = 5;  // BARU
    // Enum baru: DOWNLOAD_RESPONSES = 2;
}
```

#### PeerDataOperationRequestResponseMessage — field dan sub-message baru
```proto
optional FlowResponsesCsvBundle flowResponsesCsvBundle = 11;
optional BizBroadcastInsightsContactListResponse bizBroadcastInsightsContactListResponse = 12;

enum FullHistorySyncOnDemandResponseCode {
    ERROR_MULTI_PROVIDER_NOT_CONFIGURED = 7;  // BARU
}
```

#### PeerDataOperationRequestType — enum baru
```proto
BUSINESS_BROADCAST_INSIGHTS_DELIVERED_TO = 12;
BUSINESS_BROADCAST_INSIGHTS_REFRESH = 13;
```

#### RequestWelcomeMessageMetadata — field dan enum baru
```proto
optional WelcomeTrigger welcomeTrigger = 2;
optional BotAgentMetadata botAgentMetadata = 3;

enum WelcomeTrigger {
    CHAT_OPEN = 0;
    COMPANION_PAIRING = 1;
}
```

#### PaymentInviteMessage — field baru
```proto
optional bool incentiveEligible = 3;
optional string referralId = 4;
optional InviteType inviteType = 5;

enum InviteType {
    DEFAULT = 0;
    MAPPER = 1;
}
```

#### PaymentExtendedMetadata — field DIHAPUS
```proto
// optional string messageParamsJson = 3; — DIHAPUS
```

#### CloudAPIThreadControlNotification — enum baru
```proto
INFO = 3;
```

#### InsightDeliveryState (baru)
```proto
enum InsightDeliveryState {
    SENT = 0;
    DELIVERED = 1;
    READ = 2;
    REPLIED = 3;
    QUICK_REPLIED = 4;
}
```

#### ScheduledMessageMetadata (top-level baru)
```proto
message ScheduledMessageMetadata {
    optional string revealKeyId = 1;
    optional bytes revealKey = 2;
    optional uint64 scheduledTime = 3;
}
```

---

### 1.4 Field Baru pada Message Context (ContextInfo)

| Field | ID | Tipe | Keterangan |
|-------|----|-----|-----------|
| `isSpoiler` | 73 | bool | Penanda pesan spoiler |
| `mediaDomainInfo` | 74 | MediaDomainInfo | Domain key media (E2EE vs non-E2EE) |
| `partiallySelectedContent` | 75 | PartiallySelectedContent | Konteks teks yang dipilih sebagian |
| `afterReadDuration` | 76 | uint32 | Durasi setelah dibaca |

#### Sub-field baru
```proto
// PartiallySelectedContent (baru)
message PartiallySelectedContent {
    optional string text = 1;
}

// StatusAudienceMetadata — field baru
optional string listName = 2;
optional string listEmoji = 3;

// ExternalAdReplyInfo — field baru (strategi AGM)
optional bool containsCtwaFlowsAutoReply = 28;
optional int32 agmThumbnailStrategy = 29;
optional int32 agmTitleStrategy = 30;
optional int32 agmSubtitleStrategy = 31;
optional int32 agmHeaderInteractionStrategy = 32;

// ForwardNewsletterMessageInfo — field baru
optional string profileName = 6;
```

---

### 1.5 Field Baru pada Conversation

| Field | ID | Tipe | Keterangan |
|-------|----|-----|-----------|
| `isMarketingMessageThread` | 55 | bool | Thread pesan marketing |
| `isSenderNewAccount` | 56 | bool | Pengirim baru (akun baru) |
| `afterReadDuration` | 57 | uint32 | Durasi setelah dibaca |

```proto
// EndOfHistoryTransferType — enum value baru
COMPLETE_ON_DEMAND_SYNC_WITH_MORE_MSG_ON_PRIMARY_BUT_NO_ACCESS = 3;
```

---

### 1.6 Device Capabilities — Perubahan

```proto
message DeviceCapabilities {
    optional AiThread aiThread = 6;  // BARU
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
        optional bool companionSupportEnabled = 2;     // BARU
        optional bool campaignSyncEnabled = 3;         // BARU
        optional bool insightsSyncEnabled = 4;          // BARU
        optional int32 recipientLimit = 5;              // BARU
    }
}
```

---

### 1.7 DeviceProps.HistorySyncConfig — Field Baru

| Field | ID | Tipe | Keterangan |
|-------|----|-----|-----------|
| `initialSyncMaxMessagesPerChat` | 20 | uint32 | Batas pesan per chat saat sync awal |
| `supportManusHistory` | 21 | bool | Support history sync Manus |
| `supportHatchHistory` | 22 | bool | Support history sync Hatch |
| `supportedBotChannelFbids` | 23 | repeated string | FBID channel bot yang didukung |
| `supportInlineContacts` | 24 | bool | Support kontak inline |

---

### 1.8 ClientPayload — Field Baru

```proto
optional repeated string pairedPeripherals = 47;
message WebInfo {
    optional string browser = 5;          // BARU
    optional string browserVersion = 6;   // BARU
}

// ProxyConfig — enum baru
MNS_SECONDARY = 6;
SOCKS_PROXY = 7;
```

---

### 1.9 ClientPairingProps — Field Baru

```proto
optional bool isHsThumbnailSyncEnabled = 4;
optional bytes subscriptionSyncPayload = 5;
```

---

### 1.10 HandshakeMessage — Post-Quantum Crypto

```proto
// ClientHello — field baru
optional bytes paddedBytes = 6;
optional bool sendServerHelloPaddedBytes = 7;
optional bool simulateXxkemFs = 8;
optional HandshakePqMode pqMode = 9;
optional bytes extendedEphemeral = 10;

// ServerHello — field baru
optional bytes paddingBytes = 5;
optional bytes extendedCiphertext = 6;

// ClientHello encrypted static — field baru
optional bytes paddedBytes = 4;
optional bool simulateXxkemFs = 5;

// Enum baru: HandshakePqMode (8 mode)
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

### 1.11 HistorySync — Field Baru

```proto
// syncType menjadi optional (dulu required)
optional HistorySyncType syncType = 1;

// Field baru
optional bytes nctSalt = 19;
repeated InlineContact inlineContacts = 20;
optional bool inlineContactsProvided = 21;
```

---

### 1.12 Bot Metadata — Perubahan Besar

#### BotAvatarMetadata DIHAPUS → Diganti dengan BotAgentMetadata
```proto
// DIHAPUS:
// optional BotAvatarMetadata avatarMetadata = 1;

// BARU: 6 field pada BotMetadata
optional BotDocumentMessageMetadata botDocumentMessageMetadata = 34;
optional BotGroupMetadata botGroupMetadata = 35;
optional BotRenderingConfigMetadata botRenderingConfigMetadata = 36;
optional BotInfrastructureDiagnostics botInfrastructureDiagnostics = 37;
optional AIMediaCollectionMetadata aiMediaCollectionMetadata = 38;
optional BotCommandMetadata commandMetadata = 39;
```

#### BotCapabilities — 10 Enum Baru (47 → 61)
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

#### BotMetricsEntryPoint — 9 Enum Baru
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
repeated uint32 overrideMode = 2;  // BARU

// Rename enum
UNKNOWN_MODE → DEFAULT_MODE = 0;
REASONING_MODE → THINK_HARD_MODE = 1;
```

#### BotSessionSource — Enum Baru
```
AI_HOME_SESSION = 7;
```

#### BotProgressIndicatorMetadata
```proto
optional int64 estimatedCompletionTime = 3;  // BARU
```

#### BotSignatureVerificationUseCase — Enum Baru
```
WA_TEE_BOT_MSG = 2;
```

#### BotImagineMetadata
```proto
optional string shortPrompt = 2;  // BARU
```

#### BotMetricsThreadEntryPoint
```proto
optional AIThreadEntryPoint sideChatEntryPoint = 3;  // BARU
```

#### BotModeSelectionMetadata → BotUserSelectionMode Rename
```
UNKNOWN_MODE → DEFAULT_MODE
REASONING_MODE → THINK_HARD_MODE
```

---

### 1.13 AI Thread — Perubahan

#### AIThreadInfo.AIThreadClientInfo
```proto
optional string sourceChatJid = 2;
enum AIThreadType {
    UNKNOWN = 0;
    DEFAULT = 1;
    INCOGNITO = 2;
    SIDE_CHAT = 3;  // BARU
}
```

#### AIHomeState.AIHomeAction — field dan enum baru
```proto
optional string cardTypeId = 8;  // BARU
enum AIHomeActionType {
    PROMPT = 0;
    CREATE_IMAGE = 1;
    ANIMATE_PHOTO = 2;
    ANALYZE_FILE = 3;
    COLLABORATE = 4;  // BARU
}
```

---

### 1.14 ContextInfo — Sub-Message Baru

```proto
// PartiallySelectedContent (baru, id 75)
message PartiallySelectedContent {
    optional string text = 1;
}
```

---

### 1.15 MessageAssociation — Enum Baru

```proto
POLL_ADD_OPTION = 20;
```

---

### 1.16 MutationProps — 10 Enum Baru

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

### 1.17 StatusAttribution — Enum Baru

```
SOUNDCLOUD = 11;
```

---

### 1.18 Perubahan Minor pada Field yang Menjadi Optional

| Field | Lama | Baru |
|-------|------|-----|
| `Conversation.id` | `string id = 1` | `optional string id = 1` |
| `GroupParticipant.userJid` | `string userJid = 1` | `optional string userJid = 1` |
| `HistorySync.syncType` | `HistorySyncType syncType = 1` | `optional HistorySyncType syncType = 1` |
| `LIDMigrationMapping.pn` | `uint64 pn = 1` | `optional uint64 pn = 1` |
| `LIDMigrationMapping.assignedLid` | `uint64 assignedLid = 2` | `optional uint64 assignedLid = 2` |
| `Citation` — semua field | required | optional |
| `VideoEndCard` — semua field | required | optional |

---

### 1.19 File Baru
- `src/Utils/wileys-event-stream.ts` — Event stream capture dan playback untuk debugging/testing

---

## 2. LID/JID Core (src/WABinary/jid-utils.ts)

### Fungsi Baru
| Fungsi | Keterangan |
|--------|-----------|
| `lidToJid(jid)` | Konversi `@lid` → `@s.whatsapp.net` (strip domain LID) |
| `jidToLid(jid)` | Konversi `@s.whatsapp.net` → `@lid` (untuk cache key) |
| `getBotJid(jid)` | Resolusi `@bot` JID ke phone JID melalui BOT_MAP (120+ entri) |
| `isJidUser(jid)` | Alias untuk `isPnUser` — cek apakah JID berakhiran `@s.whatsapp.net` |

---

## 3. Socket Messages Send (src/Socket/messages-send.ts) — FULL REPLACEMENT

File ini **diganti seluruhnya** dengan versi wileys port. Perubahan utama:

- Import `NodeCache` tetap digunakan untuk session caching
- Import WAProto via `createRequire()` (bukan ESM langsung) untuk kompatibilitas
- `relayMessage` menggunakan `authState.keys.transaction(exec, 'relayMessage')`
- Support album messages dengan delay handling
- Support bot nodes dan business nodes dalam relay
- `extractDeviceJids` dipanggil dengan 4 argumen (rc9 signature)
- Media handle via `(up as any).handle` untuk media relay
- `messageRetryManager` diteruskan dari underlying socket
- `getStatusCodeForMediaRetry` argumen di-cast ke number
- `assertSessions` menerima parameter `force?: boolean`

---

## 4. Socket Messages Receive (src/Socket/messages-recv.ts)

### MEX Notification Modernization
- Handler lama `handleMexNewsletterNotification` diganti dengan `handleMexNotification`
- Mendukung dua mode: **Modern GQL** (op_name-based) dan **Legacy Mexican** (<mex> child)
- Modern GQL: parse JSON dari `update` node, route berdasarkan `op_name`
- 15+ op_name types untuk newsletter operations (join, leave, promote, demote, dll.)

### Mex Notification Types Baru
| Op Name | Handler | Keterangan |
|---------|---------|-----------|
| `NotificationUserReachoutTimelockUpdate` | `handleReachoutTimelockNotification` | Timelock restrimasi business commerce |
| `MessageCappingInfoNotification` | `handleMessageCappingNotification` | Limit pesan chat baru |
| Newsletter operations | `handleLegacyMexNewsletterNotification` | Fallback ke struktur lama |

### Call Ack Fix
- Stanza ack untuk tag `call` sekarang meng-copy type dari child node

### Read Receipt Fix
- `sendReceipt` sekarang menggunakan `(msg.key.id ?? '') as string` (fallback string kosong)
- Type ack menggunakan `'read'` sebagai default

---

## 5. Socket Chats (src/Socket/chats.ts)

### App-State Sync Resilience
- Mengimport `HISTORY_SYNC_PAUSED_TIMEOUT_MS` (120 detik) dari Defaults
- Mengimport helper resilience dari app-state sync
- Konstanta `MAX_SYNC_ATTEMPTS` lokal dihapus, menggunakan shared helper

### History Sync Pause Tracking
- State tracking untuk history sync pause
- State tracking untuk blocked collections
- Retry loop mendukung forced snapshot retries
- Retry loop mendukung version repair
- Perbedaan error antara missing-key blocking dan fatal errors
- Events baru: `history-sync.completion` dan `history-sync.paused.status`
- Full app-state sync sekarang membersihkan blocked collections sebelum retry
- Connection update flow: track history stalls dan retry blocked collections

---

## 6. Utils Messages (src/Utils/messages.ts)

### normalizeMessageContent — 5 → 23 Wrappers
**Lama:** Hanya 5 future-proof message types (ephemeralMessage, viewOnceMessage, documentWithCaptionMessage, viewOnceMessageV2, viewOnceMessageV2Extension, editedMessage, associatedChildMessage, groupStatusMessage, groupStatusMessageV2)

**Baru:** 23 wrapper types termasuk: ephemeralMessage, viewOnceMessage, documentWithCaptionMessage, viewOnceMessageV2, viewOnceMessageV2Extension, editedMessage, groupMentionedMessage, botInvokeMessage, lottieStickerMessage, eventCoverImage, statusMentionMessage, pollCreationOptionImageMessage, associatedChildMessage, groupStatusMentionMessage, pollCreationMessageV4, pollCreationMessageV5, statusAddYours, groupStatusMessage, limitSharingMessage, botTaskMessage, questionMessage, groupStatusMessageV2, botForwardedMessage

### Interactive Buttons Handler
- Handler baru di `generateWAMessageContent` sebelum text branch
- Mendukung: `interactiveButtons`, `nativeFlowMessage`, `nativeFlowButtons`
- Fix ghost messages di mana buttons arrive sebagai plain text
- Membangun interactiveMessage dengan body, footer, header, contextInfo

### Status/Broadcast Media
- Media upload sekarang menyimpan full upload result
- Status/broadcast media membaca CDN handle dari upload result
- Status/broadcast media meng-omit `url` ketika WhatsApp returns media handle
- Status/broadcast media skip `mediaKeyTimestamp` ketika WhatsApp returns handle

### Event Invite Message
- Jenis pesan baru: `eventInvite` dengan eventId, eventTitle, startTime, caption, jpegThumbnail, isCanceled

### Advanced Poll Support
- `pollCreationMessageV6` dengan endTime, hideParticipantName, allowAddOption
- `pollAddOptionMessage` untuk menambah opsi poll
- `pollUpdateMessage` untuk vote update pada poll

### TypeScript Fix
- `return content` → `return content ?? undefined` untuk mencegah TS2322

---

## 7. Types (src/Types/)

### Message.ts (src/Types/Message.ts)
- `MessageWithContextInfo` → field baru: `eventInviteMessage`, `pollCreationMessageV6`
- `PollMessageOptions` → field baru: `endDate`, `hideParticipantName`, `allowAddOption`
- `AnyRegularMessageContent` → support `eventInvite`, `pollAddOption`

### Events.ts (src/Types/Events.ts)
- `messaging-history.set` → expose `chunkOrder`
- `messaging-history.status` event typing baru
- `BufferedEventData.historySets` → carry `lidPnMappings` dan `chunkOrder`

### State.ts (src/Types/State.ts) — FILE BARU/EXTENSIVE
| Type | Keterangan |
|------|-----------|
| `ReachoutTimelockState` | State timelock (isActive, timeEnforcementEnds, enforcementType) |
| `ReachoutTimelockEnforcementType` | 17 jenis pelanggaran commerce + DEFAULT + WEB_COMPANION_ONLY |
| `NewChatMessageCappingStatusType` | NONE → FIRST_WARNING → SECOND_WARNING → CAPPED |
| `NewChatMessageCappingMVStatusType` | NOT_ELIGIBLE, NOT_ACTIVE, ACTIVE, ACTIVE_UPGRADE_AVAILABLE |
| `NewChatMessageCappingOTEStatusType` | NOT_ELIGIBLE, ELIGIBLE, ACTIVE_IN_CURRENT_CYCLE, EXHAUSTED |
| `NewChatMessageCapInfo` | Total/used quota, cycle timestamps, ote/mv/capping status |
| `ConnectionState.reachoutTimeLock` | Field baru di ConnectionState |

### index.ts
- Expose `Browsers.android(...)` type

---

## 8. Auth & Crypto

### auth-utils.ts — PQueue → Mutex
- **Dependency removed:** `p-queue`
- Semua queue operations diganti dengan `Mutex` dari `async-mutex`
- Cache mutex wrapper dihapus
- Cache get dan set paths tidak lagi serialize melalui mutex
- Key queues diganti dengan key mutex map
- Helper direct-write queue diganti dengan mutex helper
- Direct writes sekarang menggunakan per-type mutexes
- Comment flow diperbarui untuk mutex flow

### pre-key-manager.ts — PQueue → Mutex
- Import `Mutex` menggantikan `PQueue`
- Menyimpan mutexes menggantikan queues
- Helper `withDeviceMutex` menggunakan `mutex.runExclusive`
- Semua operasi pre-key sekarang menggunakan mutex untuk thread-safety

---

## 9. History (src/Utils/history.ts)

- Import stream pipeline untuk inflate
- Import `createInflate` untuk decompression
- Hoist root participant ke `key.participant`
- `downloadHistory` sekarang inflate history via stream pipeline (bukan Buffer concat)
- Contact `jid` field ditambahkan
- Normalisasi root participant sebelum downstream processing
- Chat objects sekarang reuse objects (bukan clone) untuk efisiensi

---

## 10. Event Buffer (src/Utils/event-buffer.ts)

- Buffered history events sekarang retain `chunkOrder` dan merged `lidPnMappings`
- Consolidated history events sekarang emit `chunkOrder` dan `lidPnMappings`

---

## 11. Messages Media (src/Utils/messages-media.ts)

- `downloadEncryptedContent` — skip `Buffer.concat` ketika tidak ada remainder (optimasi)
- `generateProfilePicture` — keep full image (bukan square-crop) untuk profile uploads

---

## 12. Process Message (src/Utils/process-message.ts)

- `isRealMessage` sekarang menerima optional `meId` (wileys compat)
- `messaging-history.set` sekarang forward history `chunkOrder`
- `cleanMessage` — normalisasi nested reaction/poll keys untuk 1:1 chats

---

## 13. Validate Connection (src/Utils/validate-connection.ts)

- Android user agent platform advertisement ketika `browser[1]` adalah "Android"
- Skip webInfo untuk Android browser payloads
- Map Android browser sessions ke `ANDROID_PHONE` companion props

---

## 14. Defaults (src/Defaults/)

### index.ts
- Export baru: `HISTORY_SYNC_PAUSED_TIMEOUT_MS = 120_000` (same as WA Web's handleChunkProgress / restartPausedTimer)

### baileys-version.json
- Version: `[2, 3000, 1035194821]` → `[2, 3000, 1036692702]`

---

## 15. Browser Utils (src/Utils/browser-utils.ts)

- Export `getPlatformId` untuk platform identification
- Android platform support untuk view-once capable sessions

---

## 16. Chat Utils (src/Utils/chat-utils.ts)

- Repair invalid LTHash state versions
- Export missing-key helpers
- `encodeSyncdPatch` sekarang tag missing app-state keys secara eksplisit
- `decodeSyncdMutations` sekarang surface missing-key state
- `decodeSyncdPatch` sekarang surface missing-key state
- Snapshot/patch verification sekarang surface missing-key state

---

## 17. Generics (src/Utils/generics.ts)

- Hapus timeout stack capture overhead (performance optimization)
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
- Device 99 resolves to hosted.lid pada PN→LID lookup
- LID→PN reverse mapping preserves hosted device 99

### libsignal.ts
- Device 99 migrations sekarang force `hosted.lid` targets
- Logic: `fromDecoded.device === 99 && rawTargetDecoded.server === 'lid'` → `${rawTargetDecoded.user}:99@hosted.lid`

---

## 19. Groups (src/Socket/groups.ts)

- Group metadata sekarang preserve `addressingMode` (LID vs PN)
- `addressingMode: group.attrs.addressing_mode === 'lid' ? LID : PN`

---

## 20. New Patch Files (src/patch/)

| File | Baris | Keterangan |
|------|-------|-----------|
| `wileys-patch.ts` | 45,168 | LID ev.emit intercept + group cache wiring + PN-first incoming fallback |
| `wileys-utils.ts` | 29,540 | Utility functions: normalizeMessageContentFull, extractMessageContent, isRealMessage, shouldIncrementChatUnread, getChatId, fetchLatestWileysVersion, captureEventStream, readAndEmitEventStream, ALL_WA_PATCH_NAMES, META_AI_JID, OFFICIAL_BIZ_JID, dan lainnya |
| `make-in-memory-store.ts` | 31,413 | In-memory store untuk chats & messages dengan WileysStore, WileysChatKey, WileysStoreConfig |
| `status-patch.ts` | 22,503 | WhatsApp Status/story sending dengan 23-wrapper awareness |
| `group-status-patch.ts` | 20,072 | Group status V2 send |
| `interactive-buttons.ts` | 38,532 | Buttons, lists, sections: sendButtons, sendListMessage, sendInteractive, InteractiveMessageOptions |
| `read-receipt-guard.ts` | 627 | Block read receipts via globalThis flag (getAuroraBlockReadReceipts, setAuroraBlockReadReceipts, clearAuroraBlockReadReceipts) |
| `wileys-compat-patch.ts` | 7,384 | Runtime compatibility patches |

---

## 21. New Standalone Files

| File | Baris | Keterangan |
|------|-------|-----------|
| `make-wa-socket.ts` | 27,120 | `createSocket()` — Enhanced WA socket dengan auto-apply patches di runtime |
| `baileys-compat.ts` | 1,935 | Static direct imports dari Baileys modules untuk compat |
| `plugin-compat.ts` | 16,070 | Plugin compatibility layer |
| `wileys-types.ts` | 7,037 | Wileys type definitions |
| `wileys-baileys-types-stub.d.ts` | 1,076 | Type stub untuk @whiskeysockets/baileys |

---

## 22. New Utility Files (src/utils/)

| File | Baris | Keterangan |
|------|-------|-----------|
| `jid.ts` | 19,747 | Comprehensive JID utilities untuk LID/PN resolution dan caching |

---

## 23. Entry Point (src/index.ts)

Export baru di top level:
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
- 16 lines changed untuk accommodate stub resolution

---

## 25. DIFILES (Removed from Tracking)

| File | Keterangan |
|------|-----------|
| `Example/example.ts` | Contoh file dihapus dari tracking |
| `Media/*` | Semua media files (logo, images, audio, video) dihapus dari tracking |

---

## Summary

### Statistik
| Metric | Value |
|--------|-------|
| Files changed | 41 |
| Lines added | +13,701 |
| Lines removed | -3,215 |
| New files created | 12+ |
| New patch steps | 126 |

### Area Utama
1. **WAProto**: Refresh ke versi terbaru dengan 50+ message/field baru
2. **LID/JID**: Sistem resolusi Linked ID vs Phone Number lengkap dengan 120+ BOT_MAP entries
3. **MEX**: Modernization handler untuk 15+ notification types
4. **Message Content**: normalizeMessageContent 5→23 wrappers, interactive buttons, event invite, advanced polls
5. **Auth/Security**: PQueue → Mutex migration, hosted device 99 support, reachout timelock
6. **Media**: Optimasi download, full aspect ratio profile pictures, status/broadcast CDN handle
7. **History**: Stream inflate, LID/PN mappings, root participant hoist
8. **App-State Sync**: Pause tracking, blocked collection retry, version repair
9. **Status & Group Status**: Full support untuk WhatsApp Stories
10. **Interactive Messages**: Buttons, lists, sections, native flow
