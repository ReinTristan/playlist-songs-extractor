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
import {
	COLUMNS,
	type ExtractConfig,
	FORMATS,
	SONG_ORDERS,
	VIDEO_TYPES,
} from './types.ts'
import {
	normalizeUrl,
	osLocale,
	parseFlags,
	parseLangFlag,
	parsePositiveInt,
} from './utils.ts'

// ---------------------------------------------------------------------------
// Modo rápido por argumentos (compatibilidad hacia atrás)
// ---------------------------------------------------------------------------

/**
 * Flags que aceptan `--flag valor` además de `--flag=valor`. Los booleanos
 * quedan afuera a propósito: si no, `--dedupe "URL"` se comería la URL.
 */
const VALUE_FLAGS = [
	'lang',
	'locale',
	'formats',
	'columns',
	'song-order',
	'long-video-minutes',
	'video-types',
	'genres',
]

/** Flags booleanos, sin valor. */
const BOOLEAN_FLAGS = ['no-expand', 'expand', 'dedupe', 'exclude-unavailable']

/** Error de parseo de un flag, listo para imprimir. */
type FlagError = { message: string }

/** Parte "a,b,c" y valida cada valor contra la lista permitida. */
function parseList<T extends string>(
	raw: string,
	allowed: readonly T[],
	flag: string,
): T[] | FlagError {
	const values = raw
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean)
	const invalid = values.find((v) => !allowed.includes(v as T))
	if (invalid || values.length === 0) {
		return {
			message: t('errors.invalidFlagValue', {
				flag: `--${flag}`,
				value: invalid ?? raw,
				available: allowed.join(', '),
			}),
		}
	}
	return values as T[]
}

/**
 * Aplica los flags sobre una config ya armada. Devuelve el primer error
 * encontrado, para cortar antes de abrir el navegador.
 */
function applyFlags(
	config: ExtractConfig,
	flags: Map<string, string | true>,
): FlagError | null {
	for (const [name, value] of flags) {
		// `--lang`/`--locale` ya los consumió parseLangFlag antes de i18n.
		if (name === 'lang' || name === 'locale') continue
		if (!VALUE_FLAGS.includes(name) && !BOOLEAN_FLAGS.includes(name)) {
			return { message: t('errors.unknownFlag', { flag: `--${name}` }) }
		}
		const str = typeof value === 'string' ? value : ''

		switch (name) {
			case 'formats': {
				const parsed = parseList(str, FORMATS, name)
				if ('message' in parsed) return parsed
				config.formats = new Set(parsed)
				break
			}
			case 'columns': {
				const parsed = parseList(
					str,
					COLUMNS.map((c) => c.key),
					name,
				)
				if ('message' in parsed) return parsed
				config.columns = parsed
				break
			}
			case 'song-order': {
				const parsed = parseList(str, SONG_ORDERS, name)
				if ('message' in parsed) return parsed
				config.songOrder = parsed[0]
				break
			}
			case 'video-types': {
				const parsed = parseList(str, VIDEO_TYPES, name)
				if ('message' in parsed) return parsed
				config.videoTypeFilter = parsed
				break
			}
			case 'genres': {
				const genres = str
					.split(',')
					.map((g) => g.trim())
					.filter(Boolean)
				if (genres.length === 0) {
					return {
						message: t('errors.invalidFlagValue', {
							flag: `--${name}`,
							value: str,
							available: t('prompts.genreFilterPlaceholder'),
						}),
					}
				}
				config.genreFilter = genres
				break
			}
			case 'long-video-minutes': {
				const minutes = parsePositiveInt(str)
				if (minutes === null) {
					return { message: t('errors.invalidLimit', { value: str }) }
				}
				config.longVideoSeconds = minutes * 60
				break
			}
			case 'expand':
				config.expandAlbums = true
				break
			case 'no-expand':
				config.expandAlbums = false
				break
			case 'dedupe':
				config.dedupe = true
				break
			case 'exclude-unavailable':
				config.excludeUnavailable = true
				break
		}
	}
	return null
}

/**
 * Arma la config del modo rápido. Omitir el límite significa "todos"; si se
 * pasa y no es un entero ≥ 1, devuelve el valor ofensivo para que main() corte
 * con un error en vez de procesar la playlist entera por un typo.
 */
function buildQuickConfig(
	positional: string[],
	flags: Map<string, string | true>,
): { config: ExtractConfig } | { invalidLimit: string } | FlagError {
	const config = defaultConfig()
	config.fullUrl = normalizeUrl(positional[0])

	const rawLimit = (positional[1] || process.env.PLAYLIST_MAX || '').trim()
	if (rawLimit) {
		const parsed = parsePositiveInt(rawLimit)
		if (parsed === null) return { invalidLimit: rawLimit }
		config.maxVideos = parsed
		config.allVideos = false
	}

	const flagError = applyFlags(config, flags)
	if (flagError) return flagError
	return { config }
}

async function main(): Promise<void> {
	// El idioma se resuelve aparte y primero: los errores de los demás flags ya
	// tienen que salir traducidos.
	const { lang } = parseLangFlag(process.argv.slice(2))
	const { flags, rest } = parseFlags(process.argv.slice(2), VALUE_FLAGS)
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
		const result = buildQuickConfig(rest, flags)
		if ('invalidLimit' in result) {
			console.error(t('errors.invalidLimit', { value: result.invalidLimit }))
			process.exitCode = 1
			return
		}
		if ('message' in result) {
			console.error(result.message)
			process.exitCode = 1
			return
		}
		try {
			await runExtraction(result.config)
		} catch (err) {
			// Una playlist inexistente/privada es un final esperable, no un crash:
			// mensaje claro y exit 1, sin el stack de `errors.fatal`.
			console.error(t('extract.failed', { message: (err as Error).message }))
			process.exitCode = 1
		}
		return
	}

	// Se piden ambos extremos: con stdout a una terminal pero stdin redirigido
	// (`node src/index.ts < archivo`), @clack/prompts no tiene de dónde leer.
	if (!process.stdout.isTTY || !process.stdin.isTTY) {
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
