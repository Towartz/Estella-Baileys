/**
 * engine-requirements.js
 *
 * Called via the "preinstall" npm script in vendor/my-baileys/package.json.
 * Warns if Node.js is below the recommended version but does NOT exit(1),
 * because AuroraChat Android embeds Node.js v18 via capacitor-nodejs and
 * all APIs used by this Baileys build are present in Node 18.20+.
 *
 * Original guard: if (major < 20) process.exit(1)  ← blocked installs on Node 18
 * Updated guard:  warn-only below 18; error below 16 (genuinely incompatible)
 */

const major = parseInt(process.versions.node.split(".")[0], 10);

if (major < 16) {
	console.error(
		`\n❌ Node.js ${process.versions.node} is too old for this Baileys build.\n` +
		`   Minimum supported: Node.js 16.\n` +
		`   AuroraChat Android ships Node.js 18 — please upgrade your dev toolchain.\n`
	);
	process.exit(1);
}

if (major < 20) {
	console.warn(
		`\n⚠️  Node.js ${process.versions.node} detected.\n` +
		`   Baileys recommends Node.js 20+ for production servers.\n` +
		`   AuroraChat Android embeds Node.js 18 (capacitor-nodejs v1.0.0-beta.9).\n` +
		`   All APIs used by this build are present in Node 18.20+ — proceeding.\n`
	);
	// No process.exit — Node 18 is fully supported by this Android build.
}
