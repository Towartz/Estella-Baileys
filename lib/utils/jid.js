/**
 * utils/jid.ts
 *
 * ════════════════════════════════════════════════════════════════════════════
 * JID / LID CONVERSION PIPELINE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Provides the single authoritative layer for all JID/LID transformations.
 * Every function is pure, deterministic, and null-safe.
 *
 * JID FORMAT REFERENCE
 * ─────────────────────────────────────────────────────────────────────────
 *  @s.whatsapp.net  — standard user JID         (e.g. 628123@s.whatsapp.net)
 *  @c.us            — legacy user JID            (e.g. 628123@c.us)
 *  @g.us            — group JID                  (e.g. 120363xxx@g.us)
 *  @broadcast       — broadcast list             (e.g. status@broadcast)
 *  @newsletter      — channel/newsletter JID
 *  @lid             — ephemeral privacy JID      (e.g. 12345@lid)
 *  @bot             — Meta AI bot JID            (e.g. 867051@bot)
 *  @temp            — temporary/test JID
 *
 * RESOLUTION PRIORITY (highest first)
 * ─────────────────────────────────────────────────────────────────────────
 *  1. participant_pn / sender_pn attrs from recv node
 *  2. contactLidStore (contacts.upsert / phoneNumberShare)
 *  3. groupParticipantJidCache (TTL 10 min)
 *  4. signalRepository.lidMapping.getPNForLID() — async authoritative
 *  5. groupMetadata fetch + cache repopulation (rate-limited 60s)
 *  6. getBotJid() BOT_MAP lookup (bots only)
 *  7. lidToJid() naive strip — last-resort, may be wrong PN
 */
// ─── JID type enum ────────────────────────────────────────────────────────────
export var JidDomain;
(function (JidDomain) {
    JidDomain["User"] = "s.whatsapp.net";
    JidDomain["LegacyUser"] = "c.us";
    JidDomain["Group"] = "g.us";
    JidDomain["Broadcast"] = "broadcast";
    JidDomain["Newsletter"] = "newsletter";
    JidDomain["Lid"] = "lid";
    JidDomain["Bot"] = "bot";
    JidDomain["Temp"] = "temp";
    JidDomain["Unknown"] = "";
})(JidDomain || (JidDomain = {}));
// ─── BOT_MAP (wileys@latest — kept in sync) ──────────────────────────────────
// Source: wileys/src/WABinary/jid-utils.ts BOT_MAP
// Update when wileys releases new bot entries.
export const BOT_MAP = new Map([
    ['867051314767696', '13135550002'], ['1061492271844689', '13135550005'],
    ['245886058483988', '13135550009'], ['3509905702656130', '13135550012'],
    ['1059680132034576', '13135550013'], ['715681030623646', '13135550014'],
    ['1644971366323052', '13135550015'], ['582497970646566', '13135550019'],
    ['645459357769306', '13135550022'], ['294997126699143', '13135550023'],
    ['1522631578502677', '13135550027'], ['719421926276396', '13135550030'],
    ['1788488635002167', '13135550031'], ['24232338603080193', '13135550033'],
    ['689289903143209', '13135550035'], ['871626054177096', '13135550039'],
    ['362351902849370', '13135550042'], ['1744617646041527', '13135550043'],
    ['893887762270570', '13135550046'], ['1155032702135830', '13135550047'],
    ['333931965993883', '13135550048'], ['853748013058752', '13135550049'],
    ['1559068611564819', '13135550053'], ['890487432705716', '13135550054'],
    ['240254602395494', '13135550055'], ['1578420349663261', '13135550062'],
    ['322908887140421', '13135550065'], ['3713961535514771', '13135550067'],
    ['997884654811738', '13135550070'], ['403157239387035', '13135550081'],
    ['535242369074963', '13135550082'], ['946293427247659', '13135550083'],
    ['3664707673802291', '13135550084'], ['1821827464894892', '13135550085'],
    ['1760312477828757', '13135550086'], ['439480398712216', '13135550087'],
    ['1876735582800984', '13135550088'], ['984025089825661', '13135550089'],
    ['1001336351558186', '13135550090'], ['3739346336347061', '13135550091'],
    ['3632749426974980', '13135550092'], ['427864203481615', '13135550093'],
    ['1434734570493055', '13135550094'], ['992873449225921', '13135550095'],
    ['813087747426445', '13135550096'], ['806369104931434', '13135550098'],
    ['1220982902403148', '13135550099'], ['1365893374104393', '13135550100'],
    ['686482033622048', '13135550200'], ['1454999838411253', '13135550201'],
    ['718584497008509', '13135550202'], ['743520384213443', '13135550301'],
    ['1147715789823789', '13135550302'], ['1173034540372201', '13135550303'],
    ['974785541030953', '13135550304'], ['1122200255531507', '13135550305'],
    ['899669714813162', '13135550306'], ['631880108970650', '13135550307'],
    ['435816149330026', '13135550308'], ['1368717161184556', '13135550309'],
    ['7849963461784891', '13135550310'], ['3609617065968984', '13135550312'],
    ['356273980574602', '13135550313'], ['1043447920539760', '13135550314'],
    ['1052764336525346', '13135550315'], ['2631118843732685', '13135550316'],
    ['510505411332176', '13135550317'], ['1945664239227513', '13135550318'],
    ['1518594378764656', '13135550319'], ['1378821579456138', '13135550320'],
    ['490214716896013', '13135550321'], ['1028577858870699', '13135550322'],
    ['308915665545959', '13135550323'], ['845884253678900', '13135550324'],
    ['995031308616442', '13135550325'], ['2787365464763437', '13135550326'],
    ['1532790990671645', '13135550327'], ['302617036180485', '13135550328'],
    ['723376723197227', '13135550329'], ['8393570407377966', '13135550330'],
    ['1931159970680725', '13135550331'], ['401073885688605', '13135550332'],
    ['2234478453565422', '13135550334'], ['814748673882312', '13135550335'],
    ['26133635056281592', '13135550336'], ['1439804456676119', '13135550337'],
    ['889851503172161', '13135550338'], ['1018283232836879', '13135550339'],
    ['1012781386779537', '13135559000'], ['823280953239532', '13135559001'],
    ['1597090934573334', '13135559002'], ['485965054020343', '13135559003'],
    ['1033381648363446', '13135559004'], ['491802010206446', '13135559005'],
    ['1017139033184870', '13135559006'], ['499638325922174', '13135559008'],
    ['468946335863664', '13135559009'], ['1570389776875816', '13135559010'],
    ['1004342694328995', '13135559011'], ['1012240323971229', '13135559012'],
    ['392171787222419', '13135559013'], ['952081212945019', '13135559016'],
    ['444507875070178', '13135559017'], ['1274819440594668', '13135559018'],
    ['1397041101147050', '13135559019'], ['425657699872640', '13135559020'],
    ['532292852562549', '13135559021'], ['705863241720292', '13135559022'],
    ['476449815183959', '13135559023'], ['488071553854222', '13135559024'],
    ['468693832665397', '13135559025'], ['517422564037340', '13135559026'],
    ['819805466613825', '13135559027'], ['1847708235641382', '13135559028'],
    ['716282970644228', '13135559029'], ['521655380527741', '13135559030'],
    ['476193631941905', '13135559031'], ['485600497445562', '13135559032'],
    ['440217235683910', '13135559033'], ['523342446758478', '13135559034'],
    ['514784864360240', '13135559035'], ['505790121814530', '13135559036'],
    ['420008964419580', '13135559037'], ['492141680204555', '13135559038'],
    ['388462787271952', '13135559039'], ['423473920752072', '13135559040'],
    ['489574180468229', '13135559041'], ['432360635854105', '13135559042'],
    ['477878201669248', '13135559043'], ['351656951234045', '13135559044'],
    ['430178036732582', '13135559045'], ['434537312944552', '13135559046'],
    ['1240614300631808', '13135559047'], ['473135945605128', '13135559048'],
    ['423669800729310', '13135559049'], ['3685666705015792', '13135559050'],
    ['504196509016638', '13135559051'], ['346844785189449', '13135559052'],
    ['504823088911074', '13135559053'], ['402669415797083', '13135559054'],
    ['490939640234431', '13135559055'], ['875124128063715', '13135559056'],
    ['468788962654605', '13135559057'], ['562386196354570', '13135559058'],
    ['372159285928791', '13135559059'], ['531017479591050', '13135559060'],
    ['1328873881401826', '13135559061'], ['1608363646390484', '13135559062'],
    ['1229628561554232', '13135559063'], ['348802211530364', '13135559064'],
    ['3708535859420184', '13135559065'], ['415517767742187', '13135559066'],
    ['479330341612638', '13135559067'], ['480785414723083', '13135559068'],
    ['387299107507991', '13135559069'], ['333389813188944', '13135559070'],
    ['391794130316996', '13135559071'], ['457893470576314', '13135559072'],
    ['435550496166469', '13135559073'], ['1620162702100689', '13135559074'],
    ['867491058616043', '13135559075'], ['816224117357759', '13135559076'],
    ['334065176362830', '13135559077'], ['489973170554709', '13135559078'],
    ['491811473512352', '13165550064'],
]);
// Reverse map: phone → bot LID user (for getSenderPN reverse lookup)
const PHONE_TO_BOT_MAP = new Map([...BOT_MAP.entries()].map(([k, v]) => [v, k]));
// ─── JID type predicates ──────────────────────────────────────────────────────
/** @s.whatsapp.net user */
export const isJidUser = (jid) => typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
/** @c.us legacy user */
export const isJidLegacyUser = (jid) => typeof jid === 'string' && jid.endsWith('@c.us');
/** @lid ephemeral privacy JID */
export const isJidLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
/** @g.us group */
export const isJidGroup = (jid) => typeof jid === 'string' && jid.endsWith('@g.us');
/** @broadcast list */
export const isJidBroadcast = (jid) => typeof jid === 'string' && jid.endsWith('@broadcast');
/** status@broadcast */
export const isJidStatusBroadcast = (jid) => jid === 'status@broadcast';
/** @newsletter channel */
export const isJidNewsletter = (jid) => typeof jid === 'string' && jid.endsWith('@newsletter');
/** @bot Meta AI */
export const isJidBot = (jid) => typeof jid === 'string' && jid.endsWith('@bot');
/** Any user-like JID (user, lid, legacy, bot) — never group/broadcast/newsletter */
export const isJidUserLike = (jid) => isJidUser(jid) || isJidLid(jid) || isJidLegacyUser(jid) || isJidBot(jid);
// ─── JID parser ───────────────────────────────────────────────────────────────
const JID_RE = /^(?:(\d+):(\d+)@|)([^@]+)@(.+)$/;
/**
 * parseJid — fully decode a JID string into its components.
 * Handles device:agent prefix (e.g. 1234:5@s.whatsapp.net).
 * Returns undefined for null / empty / malformed input.
 */
export function parseJid(jid) {
    if (!jid)
        return undefined;
    const m = JID_RE.exec(jid);
    if (!m) {
        // bare user (no @domain) — treat as user
        if (/^\d+$/.test(jid))
            return { user: jid, domain: JidDomain.User, device: undefined, agent: undefined, jid: `${jid}@s.whatsapp.net` };
        return undefined;
    }
    return {
        user: m[3],
        domain: m[4],
        device: m[2] ?? undefined,
        agent: m[1] !== undefined ? Number(m[1]) : undefined,
        jid,
    };
}
// ─── JID normalization ────────────────────────────────────────────────────────
/**
 * normalizeJid — canonical normalization.
 *
 * Rules (applied in order):
 *  1. null/undefined → undefined
 *  2. @c.us → @s.whatsapp.net
 *  3. device:agent@ prefix stripped (only user part retained)
 *  4. group JIDs kept as-is (no stripping)
 *  5. @lid / @bot / @broadcast / @newsletter → kept as-is
 */
export function normalizeJid(jid) {
    if (!jid)
        return undefined;
    // Legacy domain swap
    if (jid.endsWith('@c.us'))
        return jid.replace('@c.us', '@s.whatsapp.net');
    // Strip device:agent prefix from user JIDs
    const atIdx = jid.indexOf('@');
    if (atIdx > 0) {
        const user = jid.slice(0, atIdx);
        const domain = jid.slice(atIdx + 1);
        if (user.includes(':') && (domain === 's.whatsapp.net' || domain === 'lid')) {
            const bare = user.split(':')[0];
            return `${bare}@${domain}`;
        }
    }
    return jid;
}
/**
 * normalizeJidUser — normalizeJid + assert result is a @s.whatsapp.net JID.
 * Returns undefined if the result is not a user JID.
 */
export function normalizeJidUser(jid) {
    const n = normalizeJid(jid);
    return n && isJidUser(n) ? n : undefined;
}
// ─── LID ↔ JID bidirectional conversion ──────────────────────────────────────
/**
 * lidToJid — NAIVE @lid → @s.whatsapp.net strip.
 *
 * ⚠️  This is a LAST RESORT — the user part of a @lid JID is NOT the phone
 * number. Use the resolution pipeline (resolveLidToPN) for correct results.
 * This function exists only for cases where no resolution store is available.
 */
export function lidToJid(jid) {
    if (!jid)
        return undefined;
    return isJidLid(jid) ? jid.replace('@lid', '@s.whatsapp.net') : jid;
}
/**
 * jidToLid — convert a @s.whatsapp.net JID to canonical @lid form.
 * Used for cache key construction; does NOT guarantee the @lid is registered.
 */
export function jidToLid(jid) {
    if (!jid)
        return undefined;
    if (isJidLid(jid))
        return jid;
    const n = normalizeJid(jid);
    if (!n || !isJidUser(n))
        return undefined;
    return n.replace('@s.whatsapp.net', '@lid');
}
// ─── BOT JID conversion ───────────────────────────────────────────────────────
/**
 * getBotJid — map @bot JID → real phone @s.whatsapp.net JID via BOT_MAP.
 * Returns the original JID unchanged if not a bot or not in map.
 */
export function getBotJid(jid) {
    if (!jid)
        return undefined;
    if (!isJidBot(jid))
        return jid;
    const user = jid.slice(0, jid.indexOf('@'));
    const mapped = BOT_MAP.get(user);
    return mapped ? `${mapped}@s.whatsapp.net` : jid;
}
/**
 * phoneToBotJid — reverse BOT_MAP lookup: phone number → @bot JID.
 * Returns undefined if not a known bot phone.
 */
export function phoneToBotJid(phone) {
    if (!phone)
        return undefined;
    const bare = phone.replace('@s.whatsapp.net', '').replace('@c.us', '');
    const user = PHONE_TO_BOT_MAP.get(bare);
    return user ? `${user}@bot` : undefined;
}
/**
 * resolveJidSync — synchronous JID resolution (no async lookups).
 *
 * Covers: passthrough, normalization, @c.us → @s.whatsapp.net,
 * @bot → BOT_MAP, @lid naive strip.
 *
 * For full async resolution (signalRepository / groupMetadata) use the
 * LID pipeline in wileys-patch.ts.
 */
export function resolveJidSync(jid) {
    if (!jid)
        return undefined;
    // Bot map
    if (isJidBot(jid)) {
        const mapped = getBotJid(jid);
        return { jid: mapped, source: jid, via: 'bot_map', resolved: mapped !== jid };
    }
    // Normalize (@c.us, device:agent strip)
    const normalized = normalizeJid(jid);
    if (!normalized)
        return undefined;
    if (normalized !== jid)
        return { jid: normalized, source: jid, via: 'normalize', resolved: true };
    // Lid naive strip (last resort)
    if (isJidLid(jid)) {
        const stripped = lidToJid(jid);
        return { jid: stripped, source: jid, via: 'naive_strip', resolved: true };
    }
    // Already canonical
    return { jid, source: jid, via: 'passthrough', resolved: false };
}
// ─── areJidsSameUser ──────────────────────────────────────────────────────────
/**
 * areJidsSameUserFull — compare JIDs across all formats.
 *
 * Correctly handles:
 *  - @c.us vs @s.whatsapp.net
 *  - device:agent prefix
 *  - @lid vs @s.whatsapp.net — uses BOT_MAP for @bot JIDs
 *    (NOTE: @lid → PN naive comparison is best-effort)
 */
export function areJidsSameUserFull(a, b) {
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    const na = normalizeJid(isJidBot(a) ? getBotJid(a) : a);
    const nb = normalizeJid(isJidBot(b) ? getBotJid(b) : b);
    if (!na || !nb)
        return false;
    const ua = na.split('@')[0];
    const ub = nb.split('@')[0];
    return ua === ub;
}
// ─── JID encode / decode helpers ─────────────────────────────────────────────
/**
 * encodeJid — build a JID string from parts.
 * device and agent are optional.
 */
export function encodeJid(user, domain, device, agent) {
    if (agent !== undefined && device !== undefined)
        return `${agent}:${device}@${domain}`;
    if (device !== undefined)
        return `${user}:${device}@${domain}`;
    return `${user}@${domain}`;
}
/**
 * toJid — coerce any id form to a @s.whatsapp.net JID.
 * - @lid     → naive strip (last resort)
 * - @bot     → BOT_MAP lookup
 * - bare num → num@s.whatsapp.net
 * - JID      → normalized
 */
export function toJid(id) {
    if (!id)
        return '';
    // Use direct string checks instead of type-predicate functions —
    // calling isJidBot(s)/isJidLid(s) (which assert `jid is string`) causes
    // TS to narrow the false-branch to Exclude<string, string> = never,
    // making subsequent branches unreachable.
    if (id.endsWith('@bot'))
        return getBotJid(id) ?? id;
    if (id.endsWith('@lid'))
        return lidToJid(id) ?? id;
    if (id.includes('@'))
        return normalizeJid(id) ?? id;
    return `${id}@s.whatsapp.net`;
}
//# sourceMappingURL=jid.js.map