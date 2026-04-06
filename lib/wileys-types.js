/**
 * wileys-types.ts
 *
 * Custom types only. Baileys built-in types (WASocket, proto, etc.) are
 * available from Baileys' own './Types' barrel — no re-export needed here.
 *
 * When this file is compiled inside the custom-baileys tsconfig (with paths
 * pointing to baileys lib/index.d.ts), consumers that need WASocket/proto
 * should import from './baileys-compat.js' which re-exports those types.
 *
 * When this file is copied into Baileys src/ as src/wileys-types.ts by
 * apply-patches.ts, it compiles cleanly against Baileys' own Types barrel.
 */
export {};
//# sourceMappingURL=wileys-types.js.map