/**
 * Punto de entrada del extractor de playlists de YouTube.
 *
 * Sin argumentos abre el menú interactivo (requiere terminal TTY). Con una URL
 * como primer argumento corre en modo rápido no interactivo:
 *   node src/index.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 *   bun  src/index.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 */

import { fileURLToPath } from 'node:url'
import { defaultConfig, interactiveMenu } from './cli.ts'
import { runExtraction } from './extractor.ts'
import type { ExtractConfig } from './types.ts'
import { normalizeUrl, parseMaxVideos } from './utils.ts'

// ---------------------------------------------------------------------------
// Modo rápido por argumentos (compatibilidad hacia atrás)
// ---------------------------------------------------------------------------

function parseLegacyArgs(): ExtractConfig {
	const config = defaultConfig()
	config.fullUrl = normalizeUrl(process.argv[2])
	const limitArg = process.argv[3] || process.env.PLAYLIST_MAX || ''
	const parsed = parseMaxVideos(limitArg)
	config.maxVideos = parsed ?? Infinity
	return config
}

async function main(): Promise<void> {
	if (process.argv[2]) {
		await runExtraction(parseLegacyArgs())
		return
	}
	if (!process.stdout.isTTY) {
		console.error(
			'Uso: node src/index.ts "URL_DE_PLAYLIST" [maxVideos]\n(sin argumentos y sin terminal interactiva no hay nada que hacer)',
		)
		process.exitCode = 1
		return
	}
	await interactiveMenu()
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const meta = import.meta as ImportMeta & { main?: boolean }
const runDirectly =
	typeof meta.main === 'boolean'
		? meta.main // Bun
		: process.argv[1] !== undefined &&
			process.argv[1] === fileURLToPath(import.meta.url) // Node

if (runDirectly) {
	main().catch((err) => {
		console.error('✖ Error:', err)
		process.exit(1)
	})
}
