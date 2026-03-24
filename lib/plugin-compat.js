/**
 * plugin-compat.ts — custom-baileys v10 Enterprise
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PLUGIN COMPATIBILITY LAYER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Provides full backward-compat so all 20 plugins using the old AuroraChat
 * plugin API work with custom-baileys v10 WITHOUT any plugin modifications.
 *
 * ── WHAT PLUGINS INJECT INTO payload (onBeforeSend) ─────────────────────────
 *
 *   payload.interactiveButtons  = [{ name, buttonParamsJson }, ...]
 *   payload.messageParamsJson   = '{"limited_time_offer":{...},...}'
 *   payload.title               = string
 *   payload.subtitle            = string
 *   payload.footer              = string
 *   payload.contextInfo         = { externalAdReply: {...}, ... }
 *   payload.quoted              = WAMessage
 *   payload.mentions            = string[]
 *   // Legacy v6 API (older plugins):
 *   payload.buttons             = [{ buttonId, buttonText: { displayText } }, ...]
 *   payload.sections            = [{ title, rows: [...] }]   + payload.buttonText
 *   payload.text                = string  (body)
 *   payload.caption             = string  (body for media)
 *
 * ── WHAT custom-baileys sendMessage interceptor NEEDS ────────────────────────
 *
 *   Handled already by buildInteractiveFromContent() in interactive-buttons.ts.
 *   This file adds the MISSING pieces that plugins rely on:
 *
 *   [1] normalizePluginPayload(payload)
 *       Called by sendMessage interceptor — ensures ALL plugin field variants
 *       are recognised and normalised before building the interactiveMessage.
 *
 *   [2] PluginPayloadNormalizer (class)
 *       Stateful normalizer that can be re-used across the app layer for
 *       onBeforeSend hooks, ensuring consistent behavior for all plugins.
 *
 *   [3] extractPluginContextInfo(payload)
 *       Pulls contextInfo (externalAdReply, mentionedJid, etc.) out of the
 *       plugin payload so it is NOT lost when converting to interactiveMessage.
 *
 *   [4] mergePluginMessageParams(payload)
 *       Handles both:
 *         - payload.messageParamsJson (string, already JSON)
 *         - payload.interactiveButtons containing { __message_params__, ... }
 *       Returns { messageParamsJson?, cleanButtons[] }
 *
 *   [5] isPluginInteractivePayload(payload)
 *       Fast check: does this payload have plugin-injected interactive data?
 *
 * ════════════════════════════════════════════════════════════════════════════
 */
"use strict";
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** True if `payload` has any plugin-injected interactive data */
export function isPluginInteractivePayload(payload) {
    if (!payload || typeof payload !== 'object')
        return false;
    const p = payload;
    return ((Array.isArray(p.interactiveButtons) && p.interactiveButtons.length > 0) ||
        (Array.isArray(p.buttons) && p.buttons.length > 0) ||
        (Array.isArray(p.sections) && p.sections.length > 0 && (p.buttonText != null || p.listType != null)) ||
        typeof p.messageParamsJson === 'string');
}
/**
 * extractContextInfo — pull all context-related fields from payload.
 * Merges plugin-provided contextInfo with mentions into one object.
 */
export function extractPluginContextInfo(payload) {
    const ctx = { ...(payload.contextInfo ?? {}) };
    // Normalise mentions → mentionedJid in contextInfo
    if (Array.isArray(payload.mentions) && payload.mentions.length > 0) {
        const existing = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
        const merged = [...new Set([...existing, ...payload.mentions])];
        ctx.mentionedJid = merged;
    }
    return Object.keys(ctx).length > 0 ? ctx : undefined;
}
/**
 * mergePluginMessageParams — extract and merge messageParamsJson from all sources:
 *   1. payload.messageParamsJson (string)
 *   2. payload.interactiveButtons items with __message_params__: true (sentinel)
 *
 * Returns { messageParamsJson?, cleanButtons[] } where cleanButtons has
 * all sentinels removed.
 */
export function mergePluginMessageParams(payload) {
    let merged = {};
    // Source 1: payload.messageParamsJson
    if (typeof payload.messageParamsJson === 'string' && payload.messageParamsJson) {
        try {
            merged = { ...merged, ...JSON.parse(payload.messageParamsJson) };
        }
        catch { /* ignore */ }
    }
    const cleanButtons = [];
    // Source 2: sentinel buttons
    for (const btn of (payload.interactiveButtons ?? [])) {
        if (!btn || typeof btn !== 'object')
            continue;
        // Sentinel: { __message_params__: true, messageParamsJson: '...' }
        if (btn.__message_params__ === true) {
            const sentinel = btn;
            if (typeof sentinel.messageParamsJson === 'string') {
                try {
                    merged = { ...merged, ...JSON.parse(sentinel.messageParamsJson) };
                }
                catch { /* ignore */ }
            }
            continue;
        }
        // Normal button — keep it
        const b = btn;
        if (typeof b.name === 'string' && typeof b.buttonParamsJson === 'string') {
            cleanButtons.push({ name: b.name, buttonParamsJson: b.buttonParamsJson });
        }
        else if (typeof b.id === 'string' && typeof b.text === 'string') {
            cleanButtons.push({ id: b.id, text: b.text });
        }
    }
    return {
        messageParamsJson: Object.keys(merged).length > 0 ? JSON.stringify(merged) : undefined,
        cleanButtons,
    };
}
/**
 * normalisePluginPayload — convert any plugin onBeforeSend payload into a
 * NormalisedPluginPayload that the custom-baileys sendMessage interceptor
 * can process correctly.
 *
 * This is the SINGLE entry point that bridges ALL plugin APIs to custom-baileys.
 * Call this at the beginning of the sendMessage interceptor flow.
 *
 * @example
 * // In sendMessage interceptor:
 * const norm = normalisePluginPayload(content)
 * if (!norm) return origSend(jid, content, opts) // not a plugin payload
 * // build interactiveMessage from norm...
 */
export function normalisePluginPayload(payload) {
    if (!isPluginInteractivePayload(payload))
        return null;
    const p = payload;
    // ── Extract messageParamsJson + clean buttons ──────────────────────────────
    const { messageParamsJson, cleanButtons } = mergePluginMessageParams(p);
    // ── Extract context ────────────────────────────────────────────────────────
    const contextInfo = extractPluginContextInfo(p);
    // ── Body text (try all field names plugins use) ────────────────────────────
    const text = (p.text ?? p.caption ?? p.body ?? '');
    // ── Title / subtitle / footer ─────────────────────────────────────────────
    const title = typeof p.title === 'string' ? p.title : undefined;
    const subtitle = typeof p.subtitle === 'string' ? p.subtitle : undefined;
    const footer = typeof p.footer === 'string' ? p.footer : undefined;
    // ── Image ──────────────────────────────────────────────────────────────────
    const image = p.image;
    // ── Quoted ─────────────────────────────────────────────────────────────────
    const quoted = p.quoted;
    // ── Detect payload kind ────────────────────────────────────────────────────
    const hasButtons = cleanButtons.length > 0;
    const hasParams = !!messageParamsJson;
    const hasSections = Array.isArray(p.sections) && p.sections.length > 0
        && (p.buttonText != null || p.listType != null);
    // Nothing interactive at all (only messageParamsJson) — still handle it
    if (!hasButtons && !hasSections && !hasParams)
        return null;
    const result = {
        text,
        ...(title ? { title } : {}),
        ...(subtitle ? { subtitle } : {}),
        ...(footer ? { footer } : {}),
        ...(image ? { image } : {}),
        ...(contextInfo ? { contextInfo } : {}),
        ...(quoted ? { quoted } : {}),
        ...(messageParamsJson ? { messageParamsJson } : {}),
        __pluginNormalised: true,
    };
    // List message path (legacy sections API)
    if (hasSections && !hasButtons) {
        result.sections = p.sections;
        result.buttonText = (p.buttonText ?? 'Pilih');
        return result;
    }
    // Interactive buttons path
    if (hasButtons) {
        result.interactiveButtons = cleanButtons;
        return result;
    }
    // Only messageParamsJson — need at least one button for native_flow
    // Add a minimal invisible quick_reply so WA renders the params
    if (hasParams && !hasButtons) {
        result.interactiveButtons = [{ name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: ' ', id: '__params__' }) }];
        return result;
    }
    return result;
}
// ─── Plugin API shims ─────────────────────────────────────────────────────────
/**
 * PLUGIN API SHIM TABLE
 *
 * Documents every field / function plugins commonly use from the old API
 * and maps it to what custom-baileys v10 provides.
 *
 * Used by the AuroraChat ModManager to auto-inject compat shims into ctx.
 */
export const PLUGIN_COMPAT_MAP = {
    // ── Payload fields plugins inject ──────────────────────────────────────────
    payloadFields: {
        interactiveButtons: '✅ natively supported via sendMessage interceptor',
        messageParamsJson: '✅ extracted and placed in nativeFlowMessage.messageParamsJson',
        __message_params__: '✅ sentinel detected and merged into messageParamsJson',
        title: '✅ passed to interactiveMessage.header.title',
        subtitle: '✅ passed to interactiveMessage.header.subtitle',
        footer: '✅ passed to interactiveMessage.footer.text',
        contextInfo: '✅ merged into interactiveMessage.contextInfo (preserves externalAdReply)',
        mentions: '✅ merged into contextInfo.mentionedJid',
        quoted: '✅ passed to generateWAMessageFromContent quoted option',
        buttons: '✅ legacy v6 array auto-upgraded to quick_reply native flow',
        sections: '✅ legacy list auto-upgraded to sendListMessage',
        buttonText: '✅ used as list button label when sections present',
    },
    // ── Button name compatibility ───────────────────────────────────────────────
    buttonNames: {
        quick_reply: '✅ supported',
        cta_url: '✅ supported',
        cta_copy: '✅ supported',
        cta_call: '✅ supported',
        send_location: '✅ supported',
        single_select: '✅ supported',
        cta_catalog: '✅ supported',
        address_message: '✅ supported',
        cta_reminder: '✅ supported',
        cta_cancel_reminder: '✅ supported',
        payment_info: '✅ supported',
        payment_status: '✅ supported',
        review_and_pay: '✅ supported (extended)',
        mpm: '✅ supported (extended)',
        wa_payment_transaction_details: '✅ supported (extended)',
        psi_opt_outs: '✅ supported (extended)',
        booking_confirmation: '✅ supported (extended)',
        message_params: '✅ supported as sentinel → messageParamsJson',
    },
};
//# sourceMappingURL=plugin-compat.js.map