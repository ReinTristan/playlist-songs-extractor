/**
 * Punto de entrada del extractor de playlists de YouTube.
 *
 * Sin argumentos abre el menú interactivo (requiere terminal TTY). Con una URL
 * como primer argumento corre en modo rápido no interactivo:
 *   node src/index.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 *   bun  src/index.ts "https://www.youtube.com/playlist?list=..." [maxVideos]
 *
 * El idioma se resuelve antes de imprimir nada: `--lang=<code>` (o `--locale`)
 * y `PLAYLIST_LANG` sirven en ambos modos; en el interactivo, la primera vez se
 * pregunta y la elección queda guardada con `conf`.
 */

import { fileURLToPath } from 'node:url'
import { defaultConfig, interactiveMenu, promptFirstRunLocale } from './cli.ts'
import { getSavedLocale, hasSavedLocale } from './config.ts'
import { runExtraction } from './extractor.ts'
import {
	changeLocale,
	initI18n,
	resolveLocale,
	supportedLocales,
	t,
} from './i18n.ts'
import type { ExtractConfig } from './types.ts'
import {
	normalizeUrl,
	osLocale,
	parseLangFlag,
	parsePositiveInt,
} from './utils.ts'

// ---------------------------------------------------------------------------
// Modo rápido por argumentos (compatibilidad hacia atrás)
// ---------------------------------------------------------------------------

/**
 * Arma la config del modo rápido. Omitir el límite significa "todos"; si se
 * pasa y no es un entero ≥ 1, devuelve el valor ofensivo para que main() corte
 * con un error en vez de procesar la playlist entera por un typo.
 */
function buildQuickConfig(
	positional: string[],
): { config: ExtractConfig } | { invalidLimit: string } {
	const config = defaultConfig()
	config.fullUrl = normalizeUrl(positional[0])

	const rawLimit = (positional[1] || process.env.PLAYLIST_MAX || '').trim()
	if (!rawLimit) return { config }

	const parsed = parsePositiveInt(rawLimit)
	if (parsed === null) return { invalidLimit: rawLimit }
	config.maxVideos = parsed
	config.allVideos = false
	return { config }
}

async function main(): Promise<void> {
	const { lang, rest } = parseLangFlag(process.argv.slice(2))
	const { locale, invalid } = resolveLocale({
		cli: lang,
		env: process.env.PLAYLIST_LANG,
		saved: getSavedLocale(),
		system: osLocale(),
	})
	// Antes de imprimir cualquier texto, incluidos los errores de abajo.
	await initI18n(locale)

	if (invalid) {
		console.error(
			t('errors.invalidLang', {
				value: invalid,
				available: supportedLocales().join(', '),
			}),
		)
		process.exitCode = 1
		return
	}

	if (rest[0]) {
		const result = buildQuickConfig(rest)
		if ('invalidLimit' in result) {
			console.error(t('errors.invalidLimit', { value: result.invalidLimit }))
			process.exitCode = 1
			return
		}
		await runExtraction(result.config)
		return
	}

	if (!process.stdout.isTTY) {
		console.error(t('errors.usage'))
		process.exitCode = 1
		return
	}

	// Primer arranque: se pregunta por el idioma y la respuesta se persiste.
	// Un `--lang` puntual no se guarda: es un override de una sola corrida.
	if (!hasSavedLocale()) {
		await changeLocale(await promptFirstRunLocale(locale))
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
		console.error(t('errors.fatal'), err)
		process.exit(1)
	})
}
