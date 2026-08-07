import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parse } from 'jsonc-parser';

export function buildDeploymentSteps(config) {
	const database = config?.d1_databases?.find((entry) => entry?.binding === 'DB');
	if (!database) throw new Error('wrangler.jsonc must define the DB binding');

	const migrate = ['d1', 'migrations', 'apply', 'DB', '--remote'];
	const deploy = ['deploy'];
	return typeof database.database_id === 'string' && database.database_id.trim()
		? [migrate, deploy]
		: [deploy, migrate];
}

export async function runDeployment({
	configUrl = new URL('../wrangler.jsonc', import.meta.url),
	run = (args) => spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit' }),
} = {}) {
	const source = await readFile(configUrl, 'utf8');
	const errors = [];
	const config = parse(source, errors, { allowTrailingComma: true });
	if (errors.length) throw new Error('wrangler.jsonc contains invalid JSONC');

	for (const args of buildDeploymentSteps(config)) {
		const result = run(args);
		if (result.error) throw result.error;
		if (result.status !== 0) return result.status ?? 1;
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = await runDeployment();
}
