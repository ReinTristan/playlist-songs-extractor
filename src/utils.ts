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
 * Interpreta el límite de videos: entero ≥ 1, vacío/"todos" = Infinity,
 * cualquier otra cosa = null (inválido).
 */
export function parseMaxVideos(raw: string | undefined | null): number | null {
	const t = (raw ?? '').trim()
	if (t === '' || /^todos$/i.test(t)) return Infinity
	if (!/^\d+$/.test(t)) return null
	const n = Number(t)
	return n >= 1 ? n : null
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
