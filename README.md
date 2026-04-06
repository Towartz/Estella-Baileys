<h1 align='center'>Estella Baileys</h1>

<div align='center'>

[![npm version](https://img.shields.io/npm/v/@towartz/baileys.svg?style=flat-square)](https://www.npmjs.com/package/@towartz/baileys)
[![npm downloads](https://img.shields.io/npm/dt/@towartz/baileys?style=flat-square)](https://www.npmjs.com/package/@towartz/baileys)
[![license](https://img.shields.io/npm/l/@towartz/baileys?style=flat-square)](https://github.com/Towartz/Estella-Baileys/blob/main/LICENSE)

</div>

<div align='center'>A modified WhatsApp WebSockets library with extended features: LID/JID resolution, interactive buttons, list messages, status sending, and more.</div>

<img width="1820" height="1024" alt="image" src="https://github.com/user-attachments/assets/3084528d-1ede-4e3f-870c-7ee1b37d30d7" />

<p align='center'>
  <img src='https://github-readme-stats.vercel.app/api?username=Towartz&show_icons=true&theme=tokyonight' width='48%' />
  <img src='https://github-readme-stats.vercel.app/api/top-langs/?username=Towartz&hide=css,html&theme=tokyonight&layout=compact' width='48%' />
</p>

---

## Features

- **LID/JID Resolution** — Full Linked ID ↔ Phone Number conversion with 120+ BOT_MAP entries
- **Interactive Buttons** — Send buttons, list messages, and native flow messages
- **WhatsApp Status** — Send stories/status with full wrapper support
- **Group Status V2** — Advanced group status messaging
- **Event Invitations** — Send event invite messages
- **Advanced Polls** — Polls with end time, hidden voters, and add-option support
- **Read Receipt Control** — Block/manage read receipts globally
- **Post-Quantum Crypto** — Latest handshake modes (XXKEM, IKKEM, etc.)
- **Bot Integration** — Full bot metadata, commands, and group bot support
- **Mutex Auth** — Thread-safe authentication (PQueue → Mutex migration)
- **Stream History** — Efficient history sync via stream pipeline

## Install

```bash
npm install @towartz/baileys
# or
yarn add @towartz/baileys
# or
pnpm add @towartz/baileys
```

> **Requires Node.js >= 20.0.0**

## Quick Start

### Connect with QR Code

```ts
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@towartz/baileys'
import { Boom } from '@hapi/boom'

const { state, saveCreds } = await useMultiFileAuthState('auth_info')

const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
})

sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
        if (shouldReconnect) connectToWhatsApp()
    } else if (connection === 'open') {
        console.log('Connected!')
    }
})

sock.ev.on('creds.update', saveCreds)

sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
        if (m.key.fromMe) continue
        await sock.sendMessage(m.key.remoteJid!, { text: 'Hello!' })
    }
})
```

### Connect with Pairing Code

```ts
const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
})

if (!sock.authState.creds.registered) {
    const code = await sock.requestPairingCode('6281234567890')
    console.log('Pairing code:', code)
}
```

## Extended Features

### Interactive Buttons

```ts
// Using sendButtons helper
await sock.sendButtons(jid, 'Choose an option:', [
    { id: 'btn1', text: 'Button 1' },
    { id: 'btn2', text: 'Button 2' },
    { id: 'btn3', text: 'Button 3' }
])

// Or via sendMessage
await sock.sendMessage(jid, {
    text: 'Choose an option:',
    footer: 'Powered by Estella Baileys',
    buttons: [
        { buttonId: 'btn1', buttonText: { displayText: 'Option 1' }, type: 1 },
        { buttonId: 'btn2', buttonText: { displayText: 'Option 2' }, type: 1 }
    ],
    headerType: 1
})
```

### List Message

```ts
await sock.sendListMessage(jid, {
    title: 'Menu List',
    body: 'Select an option below',
    footerText: 'Estella Baileys',
    buttonText: 'Tap Here',
    sections: [
        {
            title: 'Main Menu',
            rows: [
                { title: 'Feature 1', description: 'Description 1', rowId: 'feat1' },
                { title: 'Feature 2', description: 'Description 2', rowId: 'feat2' }
            ]
        }
    ]
})
```

### Send WhatsApp Status

```ts
// Text status
await sock.sendStatus(jid, 'status@broadcast', {
    text: 'My status update!',
    backgroundColor: '#0000FF',
    font: 1
})

// Image status
await sock.sendStatus(jid, 'status@broadcast', {
    image: { url: './image.jpg' },
    caption: 'My photo status'
})
```

### Block Read Receipts

```ts
import { setAuroraBlockReadReceipts } from '@towartz/baileys'

// Enable — no one will see you read their messages
setAuroraBlockReadReceipts(true)

// Disable
setAuroraBlockReadReceipts(false)
```

### LID/JID Utilities

```ts
import { lidToJid, jidToLid, getBotJid, isJidUser } from '@towartz/baileys'

// Convert LID to phone JID
const phoneJid = lidToJid('1234567890@lid')
// → '1234567890@s.whatsapp.net'

// Convert phone JID to LID
const lidJid = jidToLid('1234567890@s.whatsapp.net')
// → '1234567890@lid'

// Check if valid user JID
isJidUser('1234567890@s.whatsapp.net') // true
```

### Advanced Poll

```ts
await sock.sendMessage(jid, {
    poll: {
        name: 'What is your favorite color?',
        values: ['Red', 'Blue', 'Green'],
        selectableCount: 1,
        // Extended options
        endTime: Math.floor(Date.now() / 1000) + 86400, // 24 hours
        hideParticipantName: true,
        allowAddOption: true
    }
})
```

### Event Invitation

```ts
await sock.sendMessage(jid, {
    eventInvite: {
        eventId: 'event_123',
        eventTitle: 'My Event',
        startTime: Math.floor(Date.now() / 1000) + 3600,
        caption: 'Join my event!',
        jpegThumbnail: Buffer.from('...'),
        isCanceled: false
    }
})
```

## Common Usage

### Sending Messages

```ts
// Text
await sock.sendMessage(jid, { text: 'Hello!' })

// Image
await sock.sendMessage(jid, {
    image: { url: './photo.jpg' },
    caption: 'Check this out!'
})

// Video
await sock.sendMessage(jid, {
    video: { url: './video.mp4' },
    caption: 'Watch this',
    gifPlayback: false
})

// Audio
await sock.sendMessage(jid, {
    audio: { url: './song.mp3' },
    mimetype: 'audio/mp4'
})

// Document
await sock.sendMessage(jid, {
    document: { url: './file.pdf' },
    mimetype: 'application/pdf',
    fileName: 'document.pdf'
})

// Location
await sock.sendMessage(jid, {
    location: {
        degreesLatitude: -6.2088,
        degreesLongitude: 106.8456
    }
})

// Contact
await sock.sendMessage(jid, {
    contacts: {
        displayName: 'John Doe',
        contacts: [{ vcard: 'BEGIN:VCARD\n...' }]
    }
})

// Reaction
await sock.sendMessage(jid, {
    react: { text: '❤️', key: message.key }
})
```

### Group Management

```ts
// Create group
const group = await sock.groupCreate('My Group', ['1234@s.whatsapp.net'])

// Add/Remove participants
await sock.groupParticipantsUpdate(jid, ['1234@s.whatsapp.net'], 'add')

// Promote/Demote admin
await sock.groupParticipantsUpdate(jid, ['1234@s.whatsapp.net'], 'promote')

// Change group name
await sock.groupUpdateSubject(jid, 'New Name')

// Change group description
await sock.groupUpdateDescription(jid, 'New description')

// Get invite link
const code = await sock.groupInviteCode(jid)
```

### Privacy

```ts
// Block/Unblock
await sock.updateBlockStatus(jid, 'block')
await sock.updateBlockStatus(jid, 'unblock')

// Privacy settings
await sock.updateLastSeenPrivacy('all')
await sock.updateOnlinePrivacy('all')
await sock.updateProfilePicturePrivacy('contacts')
```

## API Reference

| Feature | Import | Description |
|---------|--------|-------------|
| `makeWASocket` | `@towartz/baileys` | Create WhatsApp socket |
| `useMultiFileAuthState` | `@towartz/baileys` | Multi-file auth state |
| `sendButtons` | `@towartz/baileys` | Send interactive buttons |
| `sendListMessage` | `@towartz/baileys` | Send list message |
| `sendStatus` | `@towartz/baileys` | Send WhatsApp status |
| `setAuroraBlockReadReceipts` | `@towartz/baileys` | Toggle read receipt blocking |
| `lidToJid` | `@towartz/baileys` | Convert LID to phone JID |
| `jidToLid` | `@towartz/baileys` | Convert phone JID to LID |
| `getBotJid` | `@towartz/baileys` | Resolve bot JID |
| `downloadMediaMessage` | `@towartz/baileys` | Download media from message |
| `getContentType` | `@towartz/baileys` | Get message content type |
| `getDevice` | `@towartz/baileys` | Get sender device info |

## Project Structure

```
src/
├── patch/
│   ├── wileys-patch.ts          # LID/JID resolution
│   ├── wileys-utils.ts          # Utility functions
│   ├── make-in-memory-store.ts  # In-memory store
│   ├── status-patch.ts          # Status sending
│   ├── group-status-patch.ts    # Group status V2
│   ├── interactive-buttons.ts   # Buttons & lists
│   ├── read-receipt-guard.ts    # Read receipt control
│   └── wileys-compat-patch.ts   # Runtime compatibility
├── utils/
│   └── jid.ts                   # JID utilities
├── make-wa-socket.ts            # Socket factory
├── baileys-compat.ts            # Baileys compatibility
└── plugin-compat.ts             # Plugin layer
```

## Changelog

### v10
- WAProto refresh to `2.3000.1036692702`
- Full LID/JID resolution system with 120+ BOT_MAP entries
- MEX notification modernization (15+ notification types)
- normalizeMessageContent: 5 → 23 wrappers
- Interactive buttons, list messages, native flow
- Event invitation messages
- Advanced poll support (endTime, hideVoters, addOption)
- Post-quantum handshake modes
- PQueue → Mutex migration for thread safety
- Stream-based history inflation
- Read receipt blocking
- Status & Group Status V2 sending
- Bot metadata, commands, and group bot support

## Disclaimer

This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with WhatsApp or any of its subsidiaries or affiliates.

The maintainers do not condone the use of this application in practices that violate the Terms of Service of WhatsApp. Use at your own discretion. Do not spam people. We discourage any stalkerware, bulk or automated messaging usage.

## License

MIT — Copyright (c) 2025 Towartz
