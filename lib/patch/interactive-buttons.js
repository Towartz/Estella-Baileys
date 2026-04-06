/**
 * patch/interactive-buttons.ts
 *
 * ════════════════════════════════════════════════════════════════════════════
 * INTERACTIVE BUTTONS v5 — STANDALONE (v10)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Port of wileys interactive button system for Baileys v7 rc9.
 * v10 adds clean ESM imports and is usable without any source patching.
 *
 * All button types confirmed by gifted-btns runtime deobfuscation:
 *   quick_reply, cta_url, cta_copy, cta_call, send_location,
 *   single_select, cta_catalog, address_message, cta_reminder,
 *   cta_cancel_reminder, payment_info, payment_status
 *
 * PROTOCOL:
 *   Private chat  → [biz{native_flow}, bot{biz_bot:'1'}]
 *   Group chat    → [biz{native_flow}]
 *   List (private)→ [biz{list},        bot{biz_bot:'1'}]
 *   List (group)  → [biz{list}]
 *
 * ════════════════════════════════════════════════════════════════════════════
 */
import { generateWAMessageFromContent, normalizeMessageContent, prepareWAMessageMedia, isJidGroup, isJidBroadcast, isJidNewsletter, isJidStatusBroadcast, } from '../baileys-compat.js';
import { normalisePluginPayload, extractPluginContextInfo, mergePluginMessageParams, isPluginInteractivePayload, } from '../plugin-compat.js';
// ─── Valid button names ────────────────────────────────────────────────────────
const VALID_BUTTON_NAMES = new Set([
    // Standard native flow (confirmed by gifted-btns)
    'quick_reply', 'cta_url', 'cta_copy', 'cta_call', 'send_location',
    'single_select', 'cta_catalog', 'address_message', 'cta_reminder',
    'cta_cancel_reminder', 'payment_info', 'payment_status',
    // Extended business types (used by multi-button-builder plugin)
    'review_and_pay', 'mpm', 'wa_payment_transaction_details',
    'psi_opt_outs', 'booking_confirmation', 'message_params',
]);
const BUTTON_REQUIRED_PARAMS = {
    quick_reply: ['display_text', 'id'],
    cta_url: ['display_text', 'url'],
    cta_copy: ['display_text', 'copy_code'],
    cta_call: ['display_text', 'phone_number'],
    send_location: [],
    single_select: ['title', 'sections'],
    cta_catalog: ['display_text'],
    address_message: ['display_text'],
    cta_reminder: ['display_text'],
    cta_cancel_reminder: ['display_text'],
    payment_info: ['display_text'],
    payment_status: ['display_text'],
    // Extended business types — validation handled by the plugin/caller
    review_and_pay: [],
    mpm: [],
    wa_payment_transaction_details: [],
    psi_opt_outs: [],
    booking_confirmation: [],
    message_params: [],
};
// ─── Error ────────────────────────────────────────────────────────────────────
export class InteractiveValidationError extends Error {
    constructor(message, opts = {}) {
        super(message);
        this.type = 'InteractiveValidationError';
        this.context = opts.context;
        this.errors = opts.errors ?? [];
        this.warnings = opts.warnings ?? [];
        this.payload = opts.payload;
    }
    toJSON() {
        return { type: this.type, message: this.message, context: this.context, errors: this.errors, warnings: this.warnings };
    }
    toHumanString() {
        const lines = [`[${this.type}] ${this.message}${this.context ? ` (context: ${this.context})` : ''}`];
        if (this.errors.length) {
            lines.push('Errors:');
            this.errors.forEach(e => lines.push('  ✗ ' + e));
        }
        if (this.warnings.length) {
            lines.push('Warnings:');
            this.warnings.forEach(w => lines.push('  ⚠ ' + w));
        }
        if (this.payload)
            lines.push('Payload:', JSON.stringify(this.payload, null, 2));
        return lines.join('\n');
    }
}
// ─── btn helpers ──────────────────────────────────────────────────────────────
export const btn = {
    quickReply: (text, id) => ({
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: text, id }),
    }),
    url: (text, url, merchantUrl) => ({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({ display_text: text, url, merchant_url: merchantUrl ?? url }),
    }),
    copy: (text, code) => ({
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({ display_text: text, copy_code: code }),
    }),
    call: (text, phoneNumber) => ({
        name: 'cta_call',
        buttonParamsJson: JSON.stringify({ display_text: text, phone_number: phoneNumber }),
    }),
    location: (text = '📍 Kirim Lokasi') => ({
        name: 'send_location',
        buttonParamsJson: JSON.stringify({ display_text: text }),
    }),
    select: (buttonTitle, sections) => ({
        name: 'single_select',
        buttonParamsJson: JSON.stringify({ title: buttonTitle, sections }),
    }),
    catalog: (text, businessPhone) => ({
        name: 'cta_catalog',
        buttonParamsJson: JSON.stringify({ display_text: text, business_phone_number: businessPhone }),
    }),
    address: (text, savedContactName) => ({
        name: 'address_message',
        buttonParamsJson: JSON.stringify({ display_text: text, saved_contact_name: savedContactName ?? '' }),
    }),
    reminder: (text) => ({
        name: 'cta_reminder',
        buttonParamsJson: JSON.stringify({ display_text: text }),
    }),
    cancelReminder: (text) => ({
        name: 'cta_cancel_reminder',
        buttonParamsJson: JSON.stringify({ display_text: text }),
    }),
    paymentInfo: (text) => ({
        name: 'payment_info',
        buttonParamsJson: JSON.stringify({ display_text: text }),
    }),
    paymentStatus: (text) => ({
        name: 'payment_status',
        buttonParamsJson: JSON.stringify({ display_text: text }),
    }),
};
// ─── Validation ───────────────────────────────────────────────────────────────
export function validateAndNormalizeButtons(raw) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(raw) || raw.length === 0) {
        errors.push('buttons must be a non-empty array');
        return { valid: false, errors, warnings, normalized: [] };
    }
    const normalized = raw.map((b, i) => {
        if (!b || typeof b !== 'object') {
            errors.push(`Button[${i}]: must be an object`);
            return b;
        }
        if ('id' in b && 'text' in b && !('name' in b)) {
            return btn.quickReply(b.text, b.id);
        }
        if (!('name' in b) || typeof b.name !== 'string') {
            errors.push(`Button[${i}]: missing or non-string 'name'`);
            return b;
        }
        if (typeof b.buttonParamsJson !== 'string') {
            errors.push(`Button[${i}]: 'buttonParamsJson' must be a string`);
            return b;
        }
        const name = b.name;
        const bpj = b.buttonParamsJson;
        if (!VALID_BUTTON_NAMES.has(name)) {
            warnings.push(`Button[${i}]: unknown type '${name}'`);
        }
        let params;
        try {
            params = JSON.parse(bpj);
        }
        catch (e) {
            errors.push(`Button[${i}]: invalid JSON: ${e.message}`);
            return b;
        }
        for (const key of BUTTON_REQUIRED_PARAMS[name] ?? []) {
            if (!(key in params) || params[key] == null || params[key] === '') {
                errors.push(`Button[${i}] (${name}): missing required param '${key}'`);
            }
        }
        return { name, buttonParamsJson: bpj };
    });
    return { valid: errors.length === 0, errors, warnings, normalized };
}
export function validateAuthoringButtons(raw) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(raw) || raw.length === 0) {
        return { valid: false, errors: ['buttons must be a non-empty array'], warnings, cleaned: [] };
    }
    const cleaned = raw.map((b, i) => {
        if (!b || typeof b !== 'object') {
            errors.push(`Button[${i}]: must be an object`);
            return b;
        }
        if ('id' in b && 'text' in b && !('name' in b)) {
            if (!String(b.id))
                errors.push(`Button[${i}]: 'id' must be non-empty`);
            if (!String(b.text))
                errors.push(`Button[${i}]: 'text' must be non-empty`);
            return b;
        }
        if (!('name' in b) || typeof b.name !== 'string') {
            errors.push(`Button[${i}]: missing 'name'`);
            return b;
        }
        const name = b.name;
        if (!('buttonParamsJson' in b)) {
            errors.push(`Button[${i}] (${name}): missing buttonParamsJson`);
            return b;
        }
        let bpjStr;
        const bpj = b.buttonParamsJson;
        if (typeof bpj === 'object' && bpj !== null) {
            warnings.push(`Button[${i}] (${name}): buttonParamsJson was object — auto-stringified`);
            bpjStr = JSON.stringify(bpj);
        }
        else
            bpjStr = String(bpj);
        let params;
        try {
            params = JSON.parse(bpjStr);
        }
        catch (e) {
            errors.push(`Button[${i}] (${name}): invalid JSON`);
            return { name, buttonParamsJson: bpjStr };
        }
        for (const key of BUTTON_REQUIRED_PARAMS[name] ?? []) {
            if (!(key in params) || params[key] == null || params[key] === '') {
                errors.push(`Button[${i}] (${name}): missing '${key}'`);
            }
        }
        if (name === 'single_select') {
            if (!Array.isArray(params.sections) || params.sections.length === 0) {
                errors.push(`Button[${i}] (single_select): sections must be non-empty array`);
            }
        }
        return { name, buttonParamsJson: bpjStr };
    });
    return { valid: errors.length === 0, errors, warnings, cleaned };
}
export function validateAndNormalizeSections(sections) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(sections) || sections.length === 0) {
        return { valid: false, errors: ['sections must be a non-empty array'], warnings, normalized: [] };
    }
    const normalized = sections.map((sec, si) => {
        if (!sec.rows?.length) {
            errors.push(`Section[${si}]: rows must be non-empty`);
            return sec;
        }
        const rows = sec.rows.map((row, ri) => {
            if (!row.title)
                errors.push(`Section[${si}].Row[${ri}]: missing 'title'`);
            if (!row.id) {
                warnings.push(`Section[${si}].Row[${ri}]: missing 'id' — auto-assigned`);
                return { ...row, id: `${si}_${ri}` };
            }
            return row;
        });
        return { ...sec, rows };
    });
    return { valid: errors.length === 0, errors, warnings, normalized };
}
// ─── Protocol node builders ───────────────────────────────────────────────────
function buildAdditionalNodes(jid, isList = false, botNode = true) {
    const isGroup = isJidGroup(jid);
    const isBroadcast = isJidStatusBroadcast(jid) || isJidBroadcast(jid);
    const isNewsletter = isJidNewsletter(jid);
    const isPrivate = !isGroup && !isBroadcast && !isNewsletter;
    const bizContent = isList
        ? [{ tag: 'list', attrs: { type: 'product_list', v: '2' } }]
        : [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' },
                content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }];
    const bizNode = { tag: 'biz', attrs: {}, content: bizContent };
    if (isPrivate && botNode) {
        return [bizNode, { tag: 'bot', attrs: { biz_bot: '1' } }];
    }
    return [bizNode];
}
function mergeAdditionalNodes(existing, toAdd) {
    const out = [...(existing ?? [])];
    for (const node of toAdd) {
        if (node.tag === 'biz' && out.some((n) => n.tag === 'biz'))
            continue;
        if (node.tag === 'bot' && out.some((n) => n.tag === 'bot' && n.attrs?.biz_bot === '1'))
            continue;
        out.push(node);
    }
    return out;
}
function detectInteractiveType(message) {
    const normalized = normalizeMessageContent(message);
    const type = normalized ? Object.keys(normalized)[0] : undefined;
    if (type === 'listMessage')
        return 'list';
    if (type === 'interactiveMessage' || type === 'buttonsMessage')
        return 'interactive';
    return null;
}
// ─── Image header ─────────────────────────────────────────────────────────────
async function attachImageHeader(sock, interactiveMsg, image) {
    if (!image)
        return;
    try {
        const prepared = await prepareWAMessageMedia({ image }, { upload: sock.waUploadToServer, logger: sock.logger });
        const imageMessage = prepared.imageMessage;
        if (!imageMessage)
            return;
        interactiveMsg.header = {
            title: interactiveMsg.header?.title ?? '',
            subtitle: interactiveMsg.header?.subtitle ?? '',
            hasMediaAttachment: true,
            imageMessage,
        };
    }
    catch (err) {
        throw new InteractiveValidationError(`Failed to prepare image: ${err.message}`, { context: 'image_header' });
    }
}
// ─── Proto builders ───────────────────────────────────────────────────────────
function buildInteractiveProto(content, buttons) {
    // messageParamsJson MUST be inside nativeFlowMessage — NOT in additionalAttributes
    const msg = {
        nativeFlowMessage: {
            buttons: buttons.map(b => ({ name: b.name, buttonParamsJson: b.buttonParamsJson })),
            messageParamsJson: content.messageParamsJson ?? '',
        },
    };
    const bodyText = content.text ?? content.caption;
    if (bodyText)
        msg.body = { text: bodyText };
    if (content.footer)
        msg.footer = { text: content.footer };
    const title = content.title ?? '';
    const subtitle = content.subtitle ?? '';
    if (title || subtitle) {
        msg.header = { title, subtitle, hasMediaAttachment: false };
    }
    // Preserve ALL contextInfo fields (externalAdReply, mentionedJid etc.)
    const baseCtx = content.contextInfo ?? {};
    const mentions = content.mentions;
    if (Object.keys(baseCtx).length > 0 || mentions?.length) {
        msg.contextInfo = {
            ...baseCtx,
            ...(mentions?.length ? { mentionedJid: mentions } : {}),
        };
    }
    return msg;
}
function buildWAMessage(jid, interactiveMsg, userJid, quoted) {
    // Pass { interactiveMessage } alone — WAMessageContent fields are mutually exclusive.
    // Adding conversation:'' alongside interactiveMessage corrupts the proto: WA picks
    // conversation (lower field number) and silently drops the interactive payload.
    // v8 reference: buildWAMessage passes { interactiveMessage } only → confirmed working.
    const content = { interactiveMessage: interactiveMsg };
    return generateWAMessageFromContent(jid, content, {
        userJid,
        timestamp: new Date(),
        ...(quoted ? { quoted } : {}),
    });
}
// ─── Parse response ────────────────────────────────────────────────────────────
export function getInteractiveResponse(msg) {
    const m = msg?.message;
    const ir = m?.interactiveResponseMessage;
    if (ir?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const params = JSON.parse(ir.nativeFlowResponseMessage.paramsJson);
            return {
                id: params.id ?? params.body ?? '',
                displayText: params.display_text ?? params.title ?? '',
                type: ir.nativeFlowResponseMessage?.name ?? 'quick_reply',
                raw: params,
            };
        }
        catch { /* skip */ }
    }
    const br = m?.buttonsResponseMessage;
    if (br)
        return { id: br.selectedButtonId ?? '', displayText: br.selectedDisplayText ?? '', type: 'buttons_response', raw: br };
    const lr = m?.listResponseMessage;
    if (lr)
        return { id: lr.singleSelectReply?.selectedRowId ?? '', displayText: lr.title ?? '', type: 'list_response', raw: lr };
    const tr = m?.templateButtonReplyMessage;
    if (tr)
        return { id: tr.selectedId ?? '', displayText: tr.selectedDisplayText ?? '', type: 'template_reply', raw: tr };
    return null;
}
/**
 * Detect whether a sendMessage content payload carries button data.
 */
function detectButtonPayload(content) {
    if (!content || typeof content !== 'object')
        return null;
    // Plugin / native flow: { interactiveButtons: [...] }
    if (Array.isArray(content.interactiveButtons) && content.interactiveButtons.length > 0) {
        return 'plugin';
    }
    // Legacy list
    if (Array.isArray(content.sections) && content.sections.length > 0 &&
        (content.listType != null || content.buttonText != null)) {
        return 'legacy-list';
    }
    // Legacy buttons array
    if (Array.isArray(content.buttons) && content.buttons.length > 0) {
        return 'legacy-buttons';
    }
    return null;
}
/**
 * Normalise any raw button object to { name, buttonParamsJson }.
 * Handles full native flow, shorthand {id,text}, and legacy v6 {buttonId,buttonText}.
 */
function normalizeRawButton(b, idx) {
    if (!b || typeof b !== 'object')
        return null;
    // Sentinel from message_params — caller handles separately
    if (b.__message_params__)
        return null;
    // Full native flow: { name, buttonParamsJson }
    if (typeof b.name === 'string' && b.name && typeof b.buttonParamsJson === 'string') {
        return { name: b.name, buttonParamsJson: b.buttonParamsJson };
    }
    // Shorthand {id, text} → quick_reply
    if (b.id != null && b.text != null) {
        return btn.quickReply(String(b.text), String(b.id));
    }
    // Legacy v6: { buttonId, buttonText: { displayText } | string }
    if (b.buttonId != null || b.buttonText != null) {
        const id = String(b.buttonId ?? idx);
        const text = typeof b.buttonText === 'object'
            ? b.buttonText?.displayText ?? `Button ${idx + 1}`
            : String(b.buttonText ?? `Button ${idx + 1}`);
        return btn.quickReply(text, id);
    }
    return null;
}
/**
 * Build SendButtonsContent / SendListContent from any plugin or legacy payload.
 */
function buildInteractiveFromContent(content, style) {
    const bodyText = content.text ?? content.caption ?? content.body ?? '';
    const footer = content.footer ?? '';
    const title = content.title ?? '';
    const subtitle = content.subtitle ?? '';
    // ── List ───────────────────────────────────────────────────────────
    if (style === 'legacy-list') {
        const rawSections = content.sections ?? [];
        const sections = rawSections.map((sec, si) => ({
            title: sec.title ?? sec.name ?? `Section ${si + 1}`,
            rows: (sec.rows ?? sec.options ?? []).map((row, ri) => ({
                id: String(row.rowId ?? row.id ?? `${si}_${ri}`),
                title: String(row.title ?? row.name ?? row.displayText ?? `Row ${ri + 1}`),
                description: row.description ?? row.desc ?? undefined,
            })),
        }));
        return {
            kind: 'list',
            data: {
                text: bodyText,
                footer,
                title,
                buttonText: content.buttonText ?? content.listTitle ?? 'Select',
                sections,
            },
        };
    }
    // ── Buttons (plugin / legacy / mixed) ──────────────────────────────
    const rawButtons = content.interactiveButtons ?? content.buttons ?? [];
    // Extract messageParamsJson from sentinel entries
    let messageParamsJson;
    const existingMpj = content.messageParamsJson; // may already be set by plugin
    if (existingMpj)
        messageParamsJson = existingMpj;
    const normalizedButtons = [];
    for (let i = 0; i < rawButtons.length; i++) {
        const raw = rawButtons[i];
        if (raw === undefined)
            continue;
        // Sentinel: __message_params__ — merge into messageParamsJson
        if (raw.__message_params__ && raw.messageParamsJson) {
            try {
                const parsed = JSON.parse(raw.messageParamsJson);
                const existing = messageParamsJson ? JSON.parse(messageParamsJson) : {};
                messageParamsJson = JSON.stringify({ ...existing, ...parsed });
            }
            catch { /* ignore */ }
            continue;
        }
        const normalized = normalizeRawButton(raw, i);
        if (normalized)
            normalizedButtons.push(normalized);
    }
    if (normalizedButtons.length === 0 && !messageParamsJson)
        return null;
    return {
        kind: 'buttons',
        data: {
            text: bodyText,
            footer,
            title,
            subtitle,
            buttons: normalizedButtons.length > 0 ? normalizedButtons : [btn.quickReply('OK', 'ok')],
            image: content.image ?? undefined,
        },
        messageParamsJson,
    };
}
// ─── Main inject ──────────────────────────────────────────────────────────────
export function injectInteractiveButtons(sock, options = {}) {
    const autoInject = options.autoInjectNodes ?? true;
    const botNode = options.privateChatBotNode ?? true;
    const strict = options.strictValidation ?? true;
    if (sock.__interactiveButtonsPatched)
        return;
    sock.__interactiveButtonsPatched = true;
    // Auto inject biz/bot nodes via relayMessage wrapper
    if (autoInject && typeof sock.relayMessage === 'function') {
        const origRelay = sock.relayMessage.bind(sock);
        sock.relayMessage = async (jid, message, opts = {}) => {
            const kind = detectInteractiveType(message);
            if (kind)
                opts.additionalNodes = mergeAdditionalNodes(opts.additionalNodes, buildAdditionalNodes(jid, kind === 'list', botNode));
            return origRelay(jid, message, opts);
        };
    }
    // sendInteractiveMessage
    sock.sendInteractiveMessage = async (jid, content, options = {}) => {
        const v = validateAndNormalizeButtons(content.interactiveButtons);
        if (v.warnings.length)
            console.warn('[interactive-buttons]', v.warnings);
        if (!v.valid && strict)
            throw new InteractiveValidationError('sendInteractiveMessage: invalid buttons', { context: 'sendInteractiveMessage', errors: v.errors, warnings: v.warnings, payload: content.interactiveButtons });
        const im = buildInteractiveProto(content, v.normalized);
        if (options.contextInfo)
            im.contextInfo = { ...(im.contextInfo ?? {}), ...options.contextInfo };
        await attachImageHeader(sock, im, content.image);
        const msg = buildWAMessage(jid, im, sock.user?.id ?? jid, options.quoted);
        const relayAttrs = { ...(options.additionalAttributes ?? {}) };
        delete relayAttrs.messageParamsJson;
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes: buildAdditionalNodes(jid, false, botNode), additionalAttributes: relayAttrs, statusJidList: options.statusJidList, useCachedGroupMetadata: options.useCachedGroupMetadata });
        // [wileys-v10-emit-own] Mirror sendMessage's emitOwnEvents: store the sent message
        // locally immediately. Without this the message only appears if WA echoes it back
        // correctly — which it doesn't for interactiveMessage (echoes as empty conversation).
        if (typeof sock.upsertMessage === 'function') {
            process.nextTick(() => sock.upsertMessage(msg, 'append'));
        }
        return msg;
    };
    // sendButtons
    sock.sendButtons = async (jid, data, options = {}) => {
        const v = validateAndNormalizeButtons(data.buttons);
        if (v.warnings.length)
            console.warn('[interactive-buttons]', v.warnings);
        if (!v.valid && strict)
            throw new InteractiveValidationError('sendButtons: invalid buttons', { context: 'sendButtons', errors: v.errors, warnings: v.warnings, payload: data.buttons });
        const im = buildInteractiveProto(data, v.normalized);
        if (options.contextInfo)
            im.contextInfo = { ...(im.contextInfo ?? {}), ...options.contextInfo };
        await attachImageHeader(sock, im, data.image);
        const msg = buildWAMessage(jid, im, sock.user?.id ?? jid, options.quoted);
        const relayAttrs = { ...(options.additionalAttributes ?? {}) };
        delete relayAttrs.messageParamsJson;
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes: buildAdditionalNodes(jid, false, botNode), additionalAttributes: relayAttrs, statusJidList: options.statusJidList, useCachedGroupMetadata: options.useCachedGroupMetadata });
        // [wileys-v10-emit-own] Same as sendInteractiveMessage above
        if (typeof sock.upsertMessage === 'function') {
            process.nextTick(() => sock.upsertMessage(msg, 'append'));
        }
        return msg;
    };
    // sendListMessage
    sock.sendListMessage = async (jid, data, options = {}) => {
        const sv = validateAndNormalizeSections(data.sections);
        if (sv.warnings.length)
            console.warn('[interactive-buttons]', sv.warnings);
        if (!sv.valid && strict)
            throw new InteractiveValidationError('sendListMessage: invalid sections', { context: 'sendListMessage', errors: sv.errors, warnings: sv.warnings, payload: data.sections });
        const im = buildInteractiveProto({ text: data.text, footer: data.footer, title: data.title }, [btn.select(data.buttonText, sv.normalized)]);
        if (options.contextInfo)
            im.contextInfo = { ...(im.contextInfo ?? {}), ...options.contextInfo };
        const msg = buildWAMessage(jid, im, sock.user?.id ?? jid, options.quoted);
        const relayAttrs = { ...(options.additionalAttributes ?? {}) };
        delete relayAttrs.messageParamsJson;
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id, additionalNodes: buildAdditionalNodes(jid, true, botNode), additionalAttributes: relayAttrs, statusJidList: options.statusJidList, useCachedGroupMetadata: options.useCachedGroupMetadata });
        // [wileys-v10-emit-own] Same as sendInteractiveMessage above
        if (typeof sock.upsertMessage === 'function') {
            process.nextTick(() => sock.upsertMessage(msg, 'append'));
        }
        return msg;
    };
    sock.getInteractiveResponse = getInteractiveResponse;
    // ── sendMessage universal interceptor ───────────────────────────────────
    // Handles ALL plugin payload styles via plugin-compat.ts normalisePluginPayload.
    // IMPORTANT: always delegates to sock.sendButtons / sock.sendListMessage
    //            (NOT sock.relayMessage directly) so the biz/bot relayMessage wrapper
    //            fires and Baileys emitOwnEvents emits messages.upsert correctly.
    if (typeof sock.sendMessage === 'function') {
        const origSend = sock.sendMessage.bind(sock);
        sock.sendMessage = async (jid, content, opts = {}) => {
            try {
                // ── Normalise via plugin-compat (handles all 20+ plugin formats) ─
                const norm = normalisePluginPayload(content);
                if (!norm)
                    return origSend(jid, content, opts);
                // ── Safety guard ──────────────────────────────────────────────
                const hasButtons = Array.isArray(norm.interactiveButtons) && norm.interactiveButtons.length > 0;
                const hasSections = Array.isArray(norm.sections) && norm.sections.length > 0;
                if (!hasButtons && !hasSections && !norm.messageParamsJson)
                    return origSend(jid, content, opts);
                // ── Relay options ─────────────────────────────────────────────
                const relayOpts = {
                    quoted: opts.quoted ?? norm.quoted ?? content.quoted,
                    additionalAttributes: { ...(opts.additionalAttributes ?? {}) },
                    additionalNodes: opts.additionalNodes,
                    statusJidList: opts.statusJidList,
                    useCachedGroupMetadata: opts.useCachedGroupMetadata,
                    // externalAdReply and other context forwarded to buildInteractiveProto
                    contextInfo: norm.contextInfo,
                };
                // messageParamsJson goes into proto via data object, NOT additionalAttributes
                delete relayOpts.additionalAttributes.messageParamsJson;
                console.log(`[interactive-buttons] ⬆  plugin → interactiveMessage (${jid})`);
                // ── List path ─────────────────────────────────────────────────
                if (hasSections && !hasButtons) {
                    return sock.sendListMessage(jid, {
                        text: norm.text,
                        footer: norm.footer ?? '',
                        title: norm.title ?? '',
                        buttonText: norm.buttonText ?? 'Pilih',
                        sections: norm.sections,
                    }, relayOpts);
                }
                // ── Buttons path ──────────────────────────────────────────────
                return sock.sendButtons(jid, {
                    text: norm.text,
                    footer: norm.footer ?? '',
                    title: norm.title ?? '',
                    subtitle: norm.subtitle ?? '',
                    image: norm.image,
                    buttons: (norm.interactiveButtons ?? []),
                    // messageParamsJson → buildInteractiveProto → nativeFlowMessage.messageParamsJson
                    ...(norm.messageParamsJson ? { messageParamsJson: norm.messageParamsJson } : {}),
                }, relayOpts);
            }
            catch (err) {
                // SAFETY: never break normal sendMessage
                console.warn('[interactive-buttons] interceptor fallback:', err?.message ?? err);
                return origSend(jid, content, opts);
            }
        };
        console.log('[interactive-buttons v5] sendMessage interceptor ✓  (plugin + legacy + native)');
    }
    console.log('[interactive-buttons v5] sendButtons, sendInteractiveMessage, sendListMessage ✓  (standalone mode)');
}
//# sourceMappingURL=interactive-buttons.js.map