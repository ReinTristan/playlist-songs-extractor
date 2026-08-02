/**
 * Utilidades puras y genéricas, sin dependencias de Playwright, del menú
 * interactivo ni de los tipos del dominio. Las comparten el CLI, el extractor
 * y el script de debug; varias se testean directamente en tests/.
 */

/** Espera `ms` milisegundos. */
export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

/** Acepta una URL completa o un ID de lista y devuelve la URL normalizada. */
export function normalizeUrl(raw: string): string {
	const v = raw.trim()
	if (!v) return ''
	if (!/youtube\.com|youtu\.be/.test(v)) {
		return `https://youtube.com/playlist?list=${v}`
	}
	return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

/**
 * Interpreta un límite de videos: solo dígitos, entero ≥ 1. Cualquier otra
 * cosa (vacío, "0", negativos, texto) devuelve null.
 *
 * "Todos" ya no se expresa como palabra —eso no escalaba a varios idiomas—
 * sino con el booleano `allVideos` de `ExtractConfig`: en el menú es una
 * selección y en el modo rápido es simplemente omitir el argumento.
 */
export function parsePositiveInt(
	raw: string | undefined | null,
): number | null {
	const t = (raw ?? '').trim()
	if (!/^\d+$/.test(t)) return null
	const n = Number(t)
	return n >= 1 ? n : null
}

/**
 * Separa los `--flags` del resto del argv, en cualquier posición, para que los
 * argumentos posicionales (URL, límite) sigan leyéndose por índice.
 *
 * Acepta `--flag=valor` y `--flag valor`; esta última forma sólo para los
 * nombres listados en `valueFlags`, porque si no un flag booleano se comería
 * el posicional siguiente (`--dedupe "URL"` tomaría la URL como su valor).
 * Los flags sin valor quedan como `true`.
 */
export function parseFlags(
	argv: string[],
	valueFlags: string[] = [],
): { flags: Map<string, string | true>; rest: string[] } {
	const flags = new Map<string, string | true>()
	const rest: string[] = []
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		const inline = arg.match(/^--([^=]+)=(.*)$/)
		if (inline) {
			flags.set(inline[1], inline[2])
			continue
		}
		const bare = arg.match(/^--(.+)$/)
		if (bare) {
			const name = bare[1]
			if (valueFlags.includes(name) && i + 1 < argv.length) {
				flags.set(name, argv[i + 1])
				i++ // consumir el valor
			} else {
				flags.set(name, true)
			}
			continue
		}
		rest.push(arg)
	}
	return { flags, rest }
}

/**
 * Atajo histórico sobre `parseFlags` para el idioma: `--lang=<code>` /
 * `--lang <code>` (o `--locale`). Se resuelve aparte del resto de los flags
 * porque hay que conocer el idioma antes de imprimir cualquier mensaje,
 * incluidos los errores de las otras opciones.
 */
export function parseLangFlag(argv: string[]): {
	lang?: string
	rest: string[]
} {
	const rest: string[] = []
	let lang: string | undefined
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		const inline = arg.match(/^--(?:lang|locale)=(.*)$/)
		if (inline) {
			lang = inline[1]
			continue
		}
		if (/^--(?:lang|locale)$/.test(arg)) {
			lang = argv[i + 1]
			i++ // consumir el valor
			continue
		}
		rest.push(arg)
	}
	return { lang, rest }
}

/** Convierte "h:mm:ss" o "mm:ss" a segundos. */
export function durationToSeconds(duration: string): number {
	const parts = duration.split(':').map((p) => parseInt(p.trim(), 10))
	if (parts.some((n) => Number.isNaN(n)) || parts.length === 0) return 0
	return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** Sanitiza un nombre para usarlo como carpeta/archivo. */
export function sanitizeFilename(name: string): string {
	return (
		name
			.replace(/[<>:"/\\|?*]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120) || 'playlist'
	)
}

/** Devuelve una copia barajada del array (Fisher–Yates), sin mutar el original. */
export function shuffle<T>(arr: T[]): T[] {
	const out = [...arr]
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[out[i], out[j]] = [out[j], out[i]]
	}
	return out
}

//Borrowed from sindresorhus/os-locale, ty
export function osLocale(env = globalThis.process?.env ?? {}) {
	const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE

	if (locale) {
		return locale
			.replace(/[.:].*/, '')
			.replace(/@.*/, '')
			.replace(/_/, '-')
	}

	return new Intl.DateTimeFormat().resolvedOptions().locale
}
