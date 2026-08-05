/**
 * Extractor de canciones de playlists de YouTube (core / scraper).
 *
 * Este módulo expone la lógica de extracción (`runExtraction`) y las funciones
 * puras de parseo. El arranque (CLI interactivo y modo argv) vive en `cli.ts`;
 * los tipos y constantes compartidos, en `types.ts`.
 *
 * Genera output/<playlist>_<timestamp local>/ con los formatos seleccionados
 * (playlist.json, playlist.csv, playlist.xlsx).
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import dayjs from 'dayjs'
import ExcelJS from 'exceljs'
import { type Browser, chromium, type Page } from 'playwright'
import { columnHeader, t } from './i18n.ts'
import {
	ALBUM_KEYWORDS,
	ANY_TS,
	CHANNEL_HREF_SOURCE,
	COLUMNS,
	CONSENT_CLICK_TIMEOUT_MS,
	CONSENT_SETTLE_MS,
	CONTENT_TIMEOUT_MS,
	type Column,
	DASH_CHARS,
	DASH_CLASS,
	DESCRIPTION_SETTLE_MS,
	DESKTOP_USER_AGENT,
	type ExtractConfig,
	type Format,
	GENERIC_PLAYLIST_TITLES,
	GENRE_KEYWORDS,
	LEADING_TS,
	LONG_VIDEO_SECONDS,
	MIX_KEYWORDS,
	MIX_TYPE_KEYWORDS,
	NOISE_PATTERNS,
	NUM_LEAD_TS,
	NUM_TAIL_TS,
	type ParsedTitle,
	PLAYLIST_NAV_TIMEOUT_MS,
	type PlaylistVideo,
	POLITE_SLEEP_MS,
	RANGE_TS,
	type RawPlaylistVideo,
	SCROLL_MAX_ITERATIONS,
	SCROLL_SLEEP_MS,
	SCROLL_STABLE_ROUNDS,
	type Song,
	type SongOrder,
	TRACK_NUMBER_PATTERN,
	type Track,
	VIDEO_NAV_TIMEOUT_MS,
	type VideoType,
	type YoutubePageHTML,
	YT_SCOPE_SELECTORS,
	YT_SELECTORS,
} from './types.ts'
import {
	durationToSeconds,
	escapeRegex,
	sanitizeFilename,
	shuffle,
	sleep,
} from './utils.ts'

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Separadores de artistas, en dos clases:
//  - Símbolos (, & + × *): se aceptan con o sin espacios alrededor.
//  - Tokens de palabra (x, vs/vs., w/, with, and): exigen espacio a ambos lados
//    para NO partir nombres ("Sandstorm" por "and", "Maxwell" por "x", etc.).
// No se separa por "/" suelto a propósito, para preservar "Au/Ra", "AC/DC".
// Nota: separar por " and " es agresivo (parte "Chase and Status"), pero es el
// criterio que el proyecto ya usa para canales de colaboración y lo que se busca
// acá: priorizar separar todos los artistas de un título con muchos separadores.
// Regex derivadas de DASH_CLASS (types.ts). Se construyen una sola vez a nivel
// de módulo: son constantes, y las que llevan /g se usan siempre con
// String.replace, que resetea lastIndex en cada llamada.
const FEAT_RE = new RegExp(
	`[([]?\\s*\\b(?:feat|ft|featuring)\\b\\.?\\s*([^)\\]]+?)\\s*(?:[)\\]]|(?=\\s${DASH_CLASS}\\s|$))`,
	'gi',
)
const FEAT_WITH_RE = /[([]\s*(?:with|con)\s+([^)\]]+?)\s*[)\]]/gi
/** Separador principal "artista - canción" (el guion tiene prioridad). */
const DASH_SPLIT_RE = new RegExp(`^(.*?)\\s+${DASH_CLASS}\\s+(.*)$`)
/** Separador alternativo cuando no hay guion. */
const SLASH_PIPE_SPLIT_RE = /^(.*?)\s+[/|]\s+(.*)$/
/** Guion con espacios, para detectar el segmento principal entre pipes. */
const SPACED_DASH_RE = new RegExp(`\\s${DASH_CLASS}\\s`)
/** Separador colgado al final del título ya limpio. */
const TRAILING_SEPARATOR_RE = new RegExp(`\\s*[${DASH_CHARS}/|]\\s*$`)
/** Basura al inicio/final de una línea de tracklist. */
const TRACK_LINE_LEAD_JUNK_RE = new RegExp(`^[\\s${DASH_CHARS}.)\\][(]+`)
const TRACK_LINE_TAIL_JUNK_RE = new RegExp(`[\\s${DASH_CHARS}.([]+$`)
/** Numeración sobrante al inicio del texto de una pista. */
const TRACK_NUMBER_LEAD_RE = new RegExp(`^${TRACK_NUMBER_PATTERN}\\s*`)
/** Línea numerada de una tracklist: "1. ", "12) ", "100 - ". */
const NUMBERED_LINE_RE = new RegExp(`^(\\d{1,3})\\s*[.)${DASH_CHARS}]\\s+(.+)$`)
/** Guion que sobra entre el timestamp inicial y el título de la pista. */
const LEADING_DASH_RE = new RegExp(`^\\s*${DASH_CLASS}\\s*`)

/**
 * Géneros de la whitelist ya compilados a RegExp. `parseTitle` los prueba en
 * bucle contra cada corchete y cada segmento de cada título, así que
 * construirlos por llamada era compilar ~60 regex por canción. El Map además
 * sirve de índice para preguntar si un texto *es* exactamente un género.
 */
const GENRE_MATCHERS = new Map<string, RegExp>(
	GENRE_KEYWORDS.map((g) => [g, new RegExp(`\\b${escapeRegex(g)}\\b`, 'i')]),
)

/** Contenido de un paréntesis/corchete, sin anidar (pasos 3 y 4 de parseTitle). */
const BRACKET_CONTENT_RE = /[([]([^()[\]]+)[)\]]/g

/** Alternancia de MIX_TYPE_KEYWORDS, base de las tres regex que siguen. */
const MIX_TYPE_ALT = MIX_TYPE_KEYWORDS.map((k) => escapeRegex(k)).join('|')
/** Descriptor de mezcla dentro de un paréntesis/corchete: "(Nero Remix)". */
const BRACKET_MIX_RE = new RegExp(
	`[\\(\\[]([^()\\[\\]]*\\b(?:${MIX_TYPE_ALT})\\b[^()\\[\\]]*)[\\)\\]]`,
	'i',
)
/** Descriptor de mezcla en el último segmento tras un guion: "- Extended Mix". */
const TAIL_MIX_RE = new RegExp(
	`\\s*${DASH_CLASS}\\s*([^${DASH_CHARS}]*\\b(?:${MIX_TYPE_ALT})\\b[^${DASH_CHARS}]*)$`,
	'i',
)
/** Keyword de mezcla suelta, sin delimitador alguno. */
const BARE_MIX_RE = new RegExp(`\\b(${MIX_TYPE_ALT})\\b`, 'i')

function splitArtists(raw: string): string[] {
	return raw
		.split(/\s*[,&+×*]\s*|\s+(?:x|vs\.?|w\/|with|and)\s+/gi)
		.map((a) => a.trim())
		.filter(Boolean)
}

/**
 * Acumula en `into` los géneros de la whitelist presentes en `text`, sin
 * repetir. Lo comparten el paso 3 de `parseTitle` (contenido de los corchetes)
 * y el 4b (segmentos separados por pipe), que hacían exactamente lo mismo
 * contra fuentes de texto distintas.
 */
function collectGenres(text: string, into: string[]): void {
	for (const [genre, re] of GENRE_MATCHERS) {
		if (re.test(text) && !into.some((x) => x.toLowerCase() === genre))
			into.push(genre)
	}
}

/** Parte un título por "|" en segmentos limpios; `[]` si no hay ningún pipe. */
function splitPipeSegments(working: string): string[] {
	if (!working.includes('|')) return []
	return working
		.split('|')
		.map((s) => s.trim())
		.filter(Boolean)
}

/**
 * Decide con qué segmento se queda el título tras separarlo por pipes.
 *
 * Si alguno trae un guion es el formato NCS ("Artista - Canción | Género |
 * Label"): ese segmento es el contenido y los demás son metadata que el paso
 * 4b ya leyó. Si ninguno lo trae, el pipe *es* el separador artista/canción,
 * así que se descartan los segmentos que son puro género (ya capturados) y se
 * devuelven los demás con el pipe intacto para que el paso 5 los separe.
 */
function pickPipeMainSegment(segments: string[]): string {
	const dashSeg = segments.find((s) => SPACED_DASH_RE.test(s))
	if (dashSeg) return dashSeg
	const content = segments.filter((s) => !GENRE_MATCHERS.has(s.toLowerCase()))
	return (content.length ? content : segments).join(' | ')
}

/**
 * Resuelve el/los nombre(s) de canal de un video a partir de dos señales
 * crudas leídas del DOM. Prioriza los anchors de canal (caso normal); si no
 * hay ninguno (videos de "colaboración" con varios canales dueños, donde
 * YouTube no pone links y en cambio escribe los nombres como texto plano,
 * p. ej. "Alan Walker and Au/Ra" o con coma de Oxford "A, B, and C"), separa
 * ese texto por " and "/",".
 */
function resolveChannelNames(
	anchorTexts: string[],
	metaRowText: string,
): string[] {
	const fromAnchors = [
		...new Set(anchorTexts.map((name) => name.trim()).filter(Boolean)),
	]
	if (fromAnchors.length > 0) return fromAnchors
	const text = metaRowText.trim()
	if (!text) return []
	return text
		.split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
		.map((s) => s.trim())
		.filter(Boolean)
}

// ---------------------------------------------------------------------------
// Parseo de título
// ---------------------------------------------------------------------------

function parseTitle(raw: string): ParsedTitle {
	let working = raw.trim()
	const featuredArtists: string[] = []
	const genres: string[] = []
	let mixType = 'original'

	// 1) Featured: feat./ft./featuring en cualquier lugar; with/con sólo dentro de paréntesis.
	//    El terminador es un lookahead para NO consumir el guion separador principal:
	//    en "Artista feat. Invitado - Canción" el " - " debe sobrevivir al paso 5.
	//    Se tolera "feat."/"ft." pegado al nombre sin espacio ("feat.Ddark").
	working = working.replace(FEAT_RE, (_m, names: string) => {
		splitArtists(names).forEach((a) => {
			featuredArtists.push(a)
		})
		return ' '
	})

	working = working.replace(FEAT_WITH_RE, (_m, names: string) => {
		splitArtists(names).forEach((a) => {
			featuredArtists.push(a)
		})
		return ' '
	})

	// 2) mixType: buscar palabra clave; preferir el contenido del paréntesis/corchete que la contiene.
	//    El texto que lo contiene se anota en `mixTypeText` pero NO se borra
	//    todavía: el paso 3 necesita ver ese paréntesis para pescar géneros que
	//    vengan adentro ("(Deep House Remix)"). Se borra en el paso 4.
	let mixTypeText = ''
	const bracketMatch = working.match(BRACKET_MIX_RE)
	if (bracketMatch) {
		mixType = bracketMatch[1].trim()
		mixTypeText = bracketMatch[0]
	} else {
		// Sin paréntesis, sólo se considera "descriptor de mezcla" el último
		// segmento tras un guion ("Artista - Canción - Extended Mix"), y sólo
		// si antes queda otro guion: con uno solo, ese último segmento *es* el
		// título de la canción ("Artist - Cover Me In Sunshine") y borrarlo se
		// llevaría puesta la canción entera.
		const tail = working.match(TAIL_MIX_RE)
		const head = tail ? working.slice(0, tail.index) : ''
		if (tail && SPACED_DASH_RE.test(head)) {
			mixType = tail[1].trim()
			mixTypeText = tail[0]
		} else {
			const bare = working.match(BARE_MIX_RE)
			if (bare) mixType = bare[1].trim()
		}
	}

	// 3) genres: buscar géneros de la lista blanca dentro de corchetes/paréntesis.
	for (const chunk of working.match(BRACKET_CONTENT_RE) || [])
		collectGenres(chunk.slice(1, -1), genres)

	// 4) Quitar ruido.
	for (const pattern of NOISE_PATTERNS) working = working.replace(pattern, ' ')

	// El descriptor de mezcla ya está en `mixType` y sus géneros ya se
	// capturaron: repetirlo dentro de songTitle sólo ensucia el export.
	if (mixTypeText) working = working.replace(mixTypeText, ' ')

	// Quitar corchetes/paréntesis que sólo contienen géneros (ya capturados).
	working = working.replace(BRACKET_CONTENT_RE, (m, inner: string) =>
		GENRE_MATCHERS.has(inner.trim().toLowerCase()) ? ' ' : m,
	)

	working = working.replace(/\s+/g, ' ').trim()

	// 4b) Segmentos separados por "|" (formato común: "Artista - Canción | Género | Label").
	//     Todos aportan géneros; sólo uno sobrevive como contenido.
	const segments = splitPipeSegments(working)
	if (segments.length > 0) {
		for (const seg of segments) collectGenres(seg, genres)
		working = pickPipeMainSegment(segments)
	}

	// 5) Artistas + canción: separar por el separador principal.
	//    El guion es prioritario (se prueba primero); si no hay, se aceptan slash
	//    o pipe como alternativa, exigiendo espacios alrededor para no partir
	//    nombres con "/" interno sin espacios (p. ej. "Au/Ra", "AC/DC").
	let artists: string[] = []
	let songTitle = working
	const primaryMatch =
		working.match(DASH_SPLIT_RE) ?? working.match(SLASH_PIPE_SPLIT_RE)
	if (primaryMatch) {
		artists = splitArtists(primaryMatch[1])
		songTitle = primaryMatch[2].trim()
	}

	// Limpieza final del título de la canción.
	songTitle = songTitle
		.replace(TRAILING_SEPARATOR_RE, '')
		.replace(/\s+/g, ' ')
		.trim()

	// Quitar géneros genéricos contenidos en otro más específico (p. ej. "house" si hay "deep house").
	const refinedGenres = genres.filter((g) => {
		const re = GENRE_MATCHERS.get(g)
		if (!re) return true
		return !genres.some((other) => other !== g && re.test(other))
	})

	return { artists, featuredArtists, songTitle, mixType, genres: refinedGenres }
}

// ---------------------------------------------------------------------------
// Tracklist (descripción de álbumes/mixes)
// ---------------------------------------------------------------------------

function parseTracklist(description: string): Track[] {
	if (!description) return []
	const lines = description
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)

	// Estrategia A: timestamps (h:)mm:ss
	const tsTracks: Track[] = []
	for (const line of lines) {
		const m = line.match(ANY_TS)
		if (!m) continue
		let rest = line.replace(m[0], ' ')
		rest = rest
			.replace(TRACK_LINE_LEAD_JUNK_RE, '')
			.replace(TRACK_LINE_TAIL_JUNK_RE, '')
			.trim()
		rest = rest.replace(TRACK_NUMBER_LEAD_RE, '') // quitar numeración inicial sobrante
		// Quitar timestamp residual solo si la línea original era un rango "ts - ts"
		// (si no, un título que es una hora, p. ej. "11:11", se perdería).
		if (RANGE_TS.test(line)) {
			rest = rest.replace(LEADING_TS, '')
		}
		if (rest.length >= 2) {
			tsTracks.push({
				trackIndex: tsTracks.length + 1,
				startTimestamp: m[1],
				rawTrackTitle: rest,
			})
		}
	}
	if (tsTracks.length >= 3) return tsTracks

	// Estrategia B: numerados "1. ", "1) ", "1 - "
	const numTracks: Track[] = []
	for (const line of lines) {
		const m = line.match(NUMBERED_LINE_RE)
		if (!m) continue
		// Puede venir un timestamp al inicio ("1. 05:36 Artista - Título"), al
		// final ("1. Artista - Título 3:45") o en ambos lados (inicio y duración).
		// Se limpian los dos de forma independiente y el inicial manda como
		// `startTimestamp` por ser el que marca dónde empieza la pista.
		let rest = m[2]
		let startTimestamp = ''
		const leadTs = rest.match(NUM_LEAD_TS)
		if (leadTs) {
			startTimestamp = leadTs[1]
			rest = rest.slice(leadTs[0].length).replace(LEADING_DASH_RE, '').trim()
		}
		const tailTs = rest.match(NUM_TAIL_TS)
		if (tailTs) {
			if (!startTimestamp) startTimestamp = tailTs[1]
			rest = rest.slice(0, rest.length - tailTs[0].length)
		}
		rest = rest.trim()
		if (rest.length >= 2) {
			numTracks.push({
				trackIndex: numTracks.length + 1,
				startTimestamp,
				rawTrackTitle: rest,
			})
		}
	}
	if (numTracks.length >= 3) return numTracks

	return []
}

async function fetchTracklist(page: Page, videoId: string): Promise<Track[]> {
	const url = `https://www.youtube.com/watch?v=${videoId}`
	try {
		await page.goto(url, {
			waitUntil: 'domcontentloaded',
			timeout: VIDEO_NAV_TIMEOUT_MS,
		})
		await sleep(DESCRIPTION_SETTLE_MS)
		const description = await page.evaluate((descriptionSelector) => {
			const w = window as unknown as YoutubePageHTML
			const fromPlayer =
				w?.ytInitialPlayerResponse?.videoDetails?.shortDescription
			if (fromPlayer) return fromPlayer as string
			const el = document.querySelector(descriptionSelector)
			return el ? (el as HTMLElement).innerText : ''
		}, YT_SELECTORS.description)
		return parseTracklist(description)
	} catch (err) {
		console.warn(
			t('extract.descriptionFailed', {
				videoId,
				message: (err as Error).message,
			}),
		)
		return []
	}
}

// ---------------------------------------------------------------------------
// Clasificación de tipo de video
// ---------------------------------------------------------------------------

function classifyVideoType(
	rawTitle: string,
	durationSeconds: number,
	longVideoSeconds: number = LONG_VIDEO_SECONDS,
): {
	videoType: VideoType
	isCandidate: boolean
} {
	const lower = rawTitle.toLowerCase()
	const isLong = durationSeconds >= longVideoSeconds
	const hasAlbumKw = ALBUM_KEYWORDS.some((k) => lower.includes(k))
	const hasMixKw = MIX_KEYWORDS.some((k) =>
		new RegExp(`\\b${k}\\b`).test(lower),
	)

	// Sólo los videos largos se abren para extraer tracklist: si no aparece
	// ninguna, el video cae solo a canción única. Pero "largo" no alcanza para
	// *etiquetarlo* álbum o mix — un extended o un concierto de 25 minutos sin
	// ninguna keyword no es ninguna de las dos cosas, y salía mal en el export.
	if (isLong) {
		const videoType = hasAlbumKw ? 'album' : hasMixKw ? 'mix' : 'single'
		return { videoType, isCandidate: true }
	}
	// Videos cortos con keyword de álbum/mix igual se etiquetan, pero sin expandir.
	if (hasAlbumKw) return { videoType: 'album', isCandidate: false }
	if (hasMixKw) return { videoType: 'mix', isCandidate: false }
	return { videoType: 'single', isCandidate: false }
}

// ---------------------------------------------------------------------------
// Scraping de la página de playlist
// ---------------------------------------------------------------------------

async function dismissConsent(page: Page): Promise<void> {
	try {
		const selectors = [
			'button[aria-label*="Accept all" i]',
			'button[aria-label*="Aceptar todo" i]',
			'button[aria-label*="Accept the use" i]',
			'tp-yt-paper-button:has-text("Accept all")',
			'button:has-text("Accept all")',
			'button:has-text("Aceptar todo")',
		]
		for (const sel of selectors) {
			const btn = page.locator(sel).first()
			if (
				(await btn.count()) > 0 &&
				(await btn.isVisible().catch(() => false))
			) {
				await btn.click({ timeout: CONSENT_CLICK_TIMEOUT_MS }).catch(() => {})
				await sleep(CONSENT_SETTLE_MS)
				return
			}
		}
	} catch {
		/* sin diálogo de consentimiento */
	}
}

/** `limit === null` = sin límite (todos los videos de la playlist). */
async function scrapePlaylist(
	page: Page,
	url: string,
	limit: number | null = null,
	longVideoSeconds: number = LONG_VIDEO_SECONDS,
): Promise<{ title: string; videos: PlaylistVideo[]; channel: string }> {
	const response = await page.goto(url, {
		waitUntil: 'domcontentloaded',
		timeout: PLAYLIST_NAV_TIMEOUT_MS,
	})
	// Playwright no tira error ante un 4xx/5xx: sin este chequeo, una playlist
	// borrada/privada se "scrapea" bien, encuentra 0 videos y escribe una
	// carpeta de salida vacía como si todo hubiera salido bien.
	if (!response?.ok()) {
		throw new Error(
			t('errors.pageStatus', { status: response?.status() ?? 0, url }),
		)
	}
	await dismissConsent(page)

	// Esperar el contenido ANTES de decidir el scope: `locator.count()` no
	// auto-espera, y `domcontentloaded` dispara antes de que YouTube hidrate
	// sus custom elements. Preguntando primero, en una máquina lenta el
	// list-renderer todavía no existe y se caía al scope permisivo — justo el
	// que puede arrastrar videos recomendados.
	await page
		.waitForSelector(
			YT_SCOPE_SELECTORS.map((s) => `${s} ${YT_SELECTORS.items}`).join(', '),
			{ timeout: CONTENT_TIMEOUT_MS },
		)
		.catch(() => {})

	// La página de una playlist agrupa su contenido en varios
	// "item-section-renderer": el primero suele ser la playlist en sí, los
	// siguientes son secciones de videos/playlists recomendados que YouTube
	// agrega debajo. Pero en playlists cortas, YouTube puede meter esas
	// sugerencias como hermanas del contenido real dentro del MISMO section
	// (variante Polymer vieja) — ahí, el contenido real está anidado en
	// ytd-playlist-video-list-renderer, que las sugerencias no comparten. Si
	// ese contenedor existe, se prioriza sobre el heurístico de "primer
	// section" para no arrastrar esos falsos positivos.
	const hasListRenderer =
		(await page.locator(YT_SELECTORS.listRenderer).count()) > 0
	const scopeSelector = hasListRenderer
		? YT_SELECTORS.listRenderer
		: YT_SELECTORS.sections
	const playlistSection = () => page.locator(scopeSelector).first()

	// Scroll incremental hasta que el número de items se estabilice (lazy load),
	// o hasta alcanzar el límite solicitado.
	let stable = 0
	let lastCount = 0
	for (
		let i = 0;
		i < SCROLL_MAX_ITERATIONS && stable < SCROLL_STABLE_ROUNDS;
		i++
	) {
		const count = await playlistSection().locator(YT_SELECTORS.items).count()
		if (limit !== null && count >= limit) break
		if (count === lastCount) stable++
		else stable = 0
		lastCount = count
		await page.evaluate(() =>
			window.scrollTo(0, document.documentElement.scrollHeight),
		)
		await sleep(SCROLL_SLEEP_MS)
	}

	// Los selectores viajan como argumento: dentro de page.evaluate no existen
	// los imports de Node, y la regex tiene que cruzar como string porque los
	// argumentos se serializan a JSON.
	const domArgs = { sel: YT_SELECTORS, channelHref: CHANNEL_HREF_SOURCE }

	const { title, channel } = await page.evaluate(({ sel, channelHref }) => {
		const w = window as unknown as YoutubePageHTML
		const fromData = w?.ytInitialData?.metadata?.playlistMetadataRenderer?.title
		const h1 = document.querySelector(sel.title)
		const title =
			(fromData as string) ||
			(h1 ? (h1 as HTMLElement).innerText : '') ||
			document.title.replace(/\s*-\s*YouTube\s*$/, '')

		// Canal: primer enlace a un canal dentro del header de la playlist.
		const channelHrefRe = new RegExp(channelHref)
		const header = document.querySelector(sel.header)
		const ownerAnchor = header
			? (Array.from(header.querySelectorAll('a')).find((a) =>
					channelHrefRe.test(
						(a as HTMLAnchorElement).getAttribute('href') || '',
					),
				) as HTMLAnchorElement | undefined)
			: undefined
		const channel = (ownerAnchor?.innerText || '').trim()

		return { title, channel }
	}, domArgs)

	const videos: RawPlaylistVideo[] = await page.evaluate(
		({ sel, channelHref }) => {
			// El primer "item-section-renderer" es la playlist real; los que le
			// siguen son secciones de recomendados que no deben incluirse. Si existe
			// ytd-playlist-video-list-renderer (variante Polymer vieja), se prioriza
			// ese scope más estricto porque ahí las sugerencias no se cuelan aunque
			// compartan section con el contenido real. Si no se encuentra nada
			// (cambio de markup de YouTube), se cae al documento completo para no
			// romper la extracción.
			const channelHrefRe = new RegExp(channelHref)
			const listRenderer = document.querySelector(sel.listRenderer)
			const section = sel.sectionsByPreference.reduce<Element | null>(
				(found, s) => found ?? document.querySelector(s),
				null,
			)
			const root = listRenderer ?? section ?? document
			const items = Array.from(root.querySelectorAll(sel.items))
			return items.map((item, i) => {
				const titleEl = item.querySelector(
					sel.itemTitleLink,
				) as HTMLAnchorElement | null
				const rawTitle = (
					titleEl?.getAttribute('title') ||
					titleEl?.innerText ||
					''
				).trim()
				const href = titleEl?.href || ''
				let videoId = ''
				try {
					videoId = new URL(href).searchParams.get('v') || ''
				} catch {
					/* href no parseable */
				}
				// Canal(es): en videos normales hay un <a> al canal; en videos de
				// "colaboración" (varios canales dueños) YouTube no pone ningún
				// anchor y en cambio escribe los nombres como texto plano (p. ej.
				// "Alan Walker and Au/Ra") en la primera fila de metadata. Se
				// capturan ambas señales crudas acá; resolveChannelNames (función
				// pura de Node) decide cuál usar y cómo separarlas.
				const chanAnchorTexts = Array.from(item.querySelectorAll('a'))
					.filter((a) =>
						channelHrefRe.test(
							(a as HTMLAnchorElement).getAttribute('href') || '',
						),
					)
					.map((a) => (a as HTMLAnchorElement).innerText.trim())
					.filter(Boolean)
				const metaRowText = (
					item.querySelector(sel.metadataRow)?.textContent || ''
				).trim()
				const badges = Array.from(item.querySelectorAll(sel.durationBadge)).map(
					(b) => (b as HTMLElement).innerText.trim(),
				)
				const duration = badges.find((b) => /^\d{1,2}(:\d{2})+$/.test(b)) || ''
				const img = item.querySelector('img') as HTMLImageElement | null
				const thumbnail = videoId
					? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
					: img?.src || img?.getAttribute('data-thumb') || ''
				const lowTitle = rawTitle.toLowerCase()
				const unavailable =
					!videoId ||
					/\[private video\]|\[deleted video\]|video no disponible|\[unavailable\]/.test(
						lowTitle,
					) ||
					rawTitle === ''
				return {
					index: i + 1,
					rawTitle,
					chanAnchorTexts,
					metaRowText,
					videoId,
					url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : href,
					thumbnail,
					duration,
					durationSeconds: 0,
					availability: unavailable ? 'unavailable' : 'available',
					videoType: 'single',
					isCandidate: false,
				} as RawPlaylistVideo
			})
		},
		domArgs,
	)

	const limited = limit !== null ? videos.slice(0, limit) : videos

	// Completar campos derivados (fuera del browser), incluyendo la
	// resolución final de channel (requiere resolveChannelNames, que no
	// existe dentro del contexto del browser en page.evaluate).
	const finalVideos: PlaylistVideo[] = limited.map((v) => {
		v.durationSeconds = durationToSeconds(v.duration)
		if (v.availability === 'available') {
			const { videoType, isCandidate } = classifyVideoType(
				v.rawTitle,
				v.durationSeconds,
				longVideoSeconds,
			)
			v.videoType = videoType
			v.isCandidate = isCandidate
		} else {
			v.videoType = 'unknown'
		}
		const { chanAnchorTexts, metaRowText, ...rest } = v
		return {
			...rest,
			channel: resolveChannelNames(chanAnchorTexts, metaRowText),
		}
	})

	return {
		title: title || 'playlist',
		videos: finalVideos,
		channel: channel || 'Channel',
	}
}

// ---------------------------------------------------------------------------
// Aplanado a filas de canciones
// ---------------------------------------------------------------------------

function videoToSong(v: PlaylistVideo): Song {
	if (v.availability === 'unavailable') {
		return {
			position: String(v.index),
			artists: [],
			featuredArtists: [],
			songTitle: v.rawTitle || t('output.unavailableTitle'),
			mixType: '',
			genres: [],
			rawTitle: v.rawTitle,
			channel: v.channel,
			videoType: v.videoType,
			availability: v.availability,
			duration: v.duration,
			videoId: v.videoId,
			url: v.url,
			thumbnail: v.thumbnail,
			parentVideoId: '',
			startTimestamp: '',
		}
	}
	const parsed = parseTitle(v.rawTitle)
	return {
		position: String(v.index),
		artists: parsed.artists.length > 0 ? parsed.artists : v.channel,
		featuredArtists: parsed.featuredArtists,
		songTitle: parsed.songTitle,
		mixType: parsed.mixType,
		genres: parsed.genres,
		rawTitle: v.rawTitle,
		channel: v.channel,
		videoType: v.videoType,
		availability: v.availability,
		duration: v.duration,
		videoId: v.videoId,
		url: v.url,
		thumbnail: v.thumbnail,
		parentVideoId: '',
		startTimestamp: '',
	}
}

function trackToSong(v: PlaylistVideo, track: Track): Song {
	const parsed = parseTitle(track.rawTrackTitle)
	const url = track.startTimestamp
		? `${v.url}&t=${durationToSeconds(track.startTimestamp)}`
		: v.url
	return {
		position: `${v.index}.${track.trackIndex}`,
		artists: parsed.artists.length > 0 ? parsed.artists : v.channel,
		featuredArtists: parsed.featuredArtists,
		songTitle: parsed.songTitle,
		mixType: parsed.mixType,
		genres: parsed.genres,
		rawTitle: track.rawTrackTitle,
		channel: v.channel,
		videoType: v.videoType,
		availability: 'available',
		duration: '',
		videoId: v.videoId,
		url,
		thumbnail: v.thumbnail,
		parentVideoId: v.videoId,
		startTimestamp: track.startTimestamp,
	}
}

function buildSongRows(
	videos: PlaylistVideo[],
	tracklists: Map<string, Track[]>,
): Song[] {
	const songs: Song[] = []
	for (const v of videos) {
		const tracks = tracklists.get(v.videoId)
		if (v.isCandidate && tracks && tracks.length > 0) {
			for (const track of tracks) songs.push(trackToSong(v, track))
		} else {
			songs.push(videoToSong(v))
		}
	}
	return songs
}

/**
 * Descarta canciones repetidas conservando la primera aparición.
 *
 * La clave es `videoId` + `startTimestamp` y no sólo el videoId: las pistas de
 * un álbum/mix expandido comparten el video de origen y se perderían todas
 * menos la primera. Las canciones sin videoId (videos privados/borrados) nunca
 * se deduplican entre sí: no hay con qué distinguirlas.
 */
function dedupeSongs(songs: Song[]): Song[] {
	const seen = new Set<string>()
	return songs.filter((s) => {
		if (!s.videoId) return true
		const key = `${s.videoId}|${s.startTimestamp}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

/**
 * Aplica los filtros opcionales de la config (`null` = sin filtrar). El filtro
 * de género acepta una canción si tiene *alguno* de los géneros pedidos.
 */
function applySongFilters(
	songs: Song[],
	filters: {
		videoTypeFilter: VideoType[] | null
		genreFilter: string[] | null
		excludeUnavailable: boolean
	},
): Song[] {
	const { videoTypeFilter, genreFilter, excludeUnavailable } = filters
	const wantedGenres = genreFilter?.map((g) => g.toLowerCase()) ?? null
	return songs.filter((s) => {
		if (excludeUnavailable && s.availability === 'unavailable') return false
		if (videoTypeFilter && !videoTypeFilter.includes(s.videoType as VideoType))
			return false
		if (
			wantedGenres &&
			!s.genres.some((g) => wantedGenres.includes(g.toLowerCase()))
		)
			return false
		return true
	})
}

const byTitleAsc = (a: Song, b: Song): number =>
	a.songTitle.localeCompare(b.songTitle, undefined, { sensitivity: 'base' })

/** Aplica el orden elegido (opción extra) y renumera `position` si ya no es el original. */
function applySongOrder(songs: Song[], order: SongOrder): Song[] {
	if (order === 'original') return songs
	let ordered: Song[]
	switch (order) {
		case 'reverse':
			ordered = songs.toReversed()
			break
		case 'alphabetical-asc':
			ordered = songs.toSorted((a, b) => byTitleAsc(a, b))
			break
		case 'alphabetical-desc':
			ordered = songs.toSorted((a, b) => byTitleAsc(b, a))
			break
		case 'shuffle':
			ordered = shuffle(songs)
			break
	}
	return ordered.map((s, i) => ({ ...s, position: String(i + 1) }))
}

// ---------------------------------------------------------------------------
// Exportadores
// ---------------------------------------------------------------------------

function flattenForTable(
	song: Song,
	columns: Column[],
): Record<string, string> {
	const row: Record<string, string> = {}
	for (const col of columns) {
		const value = song[col.key]
		row[col.key] = Array.isArray(value) ? value.join('; ') : String(value ?? '')
	}
	return row
}

/** Proyecta una canción a solo las keys seleccionadas (para el JSON). */
function projectSong(song: Song, columns: Column[]): Partial<Song> {
	const out: Partial<Song> = {}
	for (const col of columns) {
		;(out[col.key] as Song[keyof Song]) = song[col.key]
	}
	return out
}

/**
 * Evita pisar una corrida anterior: el timestamp tiene resolución de un
 * segundo, y `mkdir(recursive)` no falla si la carpeta ya existe, así que dos
 * extracciones seguidas de la misma playlist sobrescribían los archivos de la
 * primera sin decir nada. Devuelve la ruta libre (`…_2`, `…_3`, …).
 */
function uniqueOutDir(base: string): string {
	let candidate = base
	for (let n = 2; existsSync(candidate); n++) candidate = `${base}_${n}`
	return candidate
}

async function writeOutputs({
	songs,
	outDir,
	playListName,
	formats,
	columns,
}: {
	songs: Song[]
	outDir: string
	playListName: string
	formats: Set<Format>
	columns: (keyof Song)[]
}): Promise<void> {
	// Columnas elegidas, en el orden elegido por el usuario. Una key que no
	// existe se descarta en vez de sustituirse: antes caía a COLUMNS[0] y
	// producía una columna "position" duplicada sin avisar de nada.
	const byKey = new Map(COLUMNS.map((c) => [c.key, c]))
	const selectedColumns = columns
		.map((k) => byKey.get(k))
		.filter((c): c is Column => c !== undefined)
	if (selectedColumns.length === 0)
		throw new Error(
			'writeOutputs: ninguna de las columnas pedidas existe en COLUMNS',
		)
	await mkdir(outDir, { recursive: true })

	// JSON (arrays nativos), proyectado a las columnas elegidas.
	if (formats.has('json')) {
		await writeFile(
			path.join(outDir, 'playlist.json'),
			JSON.stringify(
				{
					name: playListName,
					total: songs.length,
					songs: songs.map((s) => projectSong(s, selectedColumns)),
				},
				null,
				2,
			),
			'utf8',
		)
	}

	// Workbook compartido para XLSX y CSV (arrays como texto).
	if (formats.has('xlsx') || formats.has('csv')) {
		const wb = new ExcelJS.Workbook()
		const ws = wb.addWorksheet(t('output.sheetName'))
		// Header traducido, key canónica: lo visible cambia con el idioma, los
		// datos no.
		ws.columns = selectedColumns.map((c) => ({
			header: columnHeader(c.key),
			key: c.key as string,
			width: c.width,
		}))
		ws.addRows(songs.map((s) => flattenForTable(s, selectedColumns)))
		ws.getRow(1).font = { bold: true }
		ws.views = [{ state: 'frozen', ySplit: 1 }]

		if (formats.has('xlsx'))
			await wb.xlsx.writeFile(path.join(outDir, 'playlist.xlsx'))
		if (formats.has('csv'))
			await wb.csv.writeFile(path.join(outDir, 'playlist.csv'))
	}
}

// ---------------------------------------------------------------------------
// Extracción (orquestación)
// ---------------------------------------------------------------------------

/**
 * Ejecuta una extracción completa según `config`: abre el navegador, lee la
 * playlist, (opcionalmente) expande álbumes/mixes y escribe los archivos.
 * Devuelve el número de canciones y la carpeta de salida.
 *
 * Si se pasa `sharedBrowser` se reutiliza (y no se cierra aquí); si no, se
 * lanza un Chromium propio que se cierra al terminar.
 */
export async function runExtraction(
	config: ExtractConfig,
	sharedBrowser?: Browser,
): Promise<{ count: number; outDir: string }> {
	const {
		fullUrl,
		allVideos,
		maxVideos,
		formats,
		expandAlbums,
		columns,
		songOrder,
		excludeUnavailable,
		longVideoSeconds,
		dedupe,
		videoTypeFilter,
		genreFilter,
	} = config
	if (!fullUrl.trim())
		throw new Error('runExtraction: fullUrl no puede estar vacío')
	if (formats.size === 0)
		throw new Error(
			'runExtraction: formats no puede estar vacío (elige al menos json, csv o xlsx)',
		)
	if (columns.length === 0)
		throw new Error(
			'runExtraction: columns no puede estar vacío (elige al menos una columna)',
		)
	const log = config.onProgress ?? console.log

	let ownBrowser: Browser | null = null
	try {
		let browser: Browser
		if (sharedBrowser) {
			browser = sharedBrowser
		} else {
			log(t('extract.openingBrowser'))
			ownBrowser = await chromium.launch({ headless: true })
			browser = ownBrowser
		}
		const context = await browser.newContext({
			locale: 'en-US',
			userAgent: DESKTOP_USER_AGENT,
		})
		try {
			const page = await context.newPage()

			log(t('extract.reading'))
			const { title, videos, channel } = await scrapePlaylist(
				page,
				fullUrl,
				allVideos ? null : maxVideos,
				longVideoSeconds,
			)
			log(t('extract.found', { count: videos.length, title }))
			// Sin videos no hay nada que exportar: escribir igual dejaba carpetas
			// con `total: 0` que parecían una corrida exitosa.
			if (videos.length === 0) throw new Error(t('errors.emptyPlaylist'))

			// Tracklists de candidatos (álbumes/mixes), solo si está habilitado.
			const candidates = expandAlbums ? videos.filter((v) => v.isCandidate) : []
			const tracklists = new Map<string, Track[]>()
			if (candidates.length > 0) {
				log(t('extract.candidates', { count: candidates.length }))
				for (const v of candidates) {
					const tracks = await fetchTracklist(page, v.videoId)
					const title = v.rawTitle.slice(0, 50)
					if (tracks.length > 0) {
						tracklists.set(v.videoId, tracks)
						log(t('extract.tracks', { count: tracks.length, title }))
					} else {
						log(t('extract.noTracklist', { title }))
					}
					await sleep(POLITE_SLEEP_MS) // ser educado con el servidor
				}
			}

			// Dedupe antes de filtrar (más barato), y el orden al final para que
			// la renumeración de `position` refleje lo que realmente se exporta.
			let songs = buildSongRows(videos, tracklists)
			if (dedupe) songs = dedupeSongs(songs)
			songs = applySongFilters(songs, {
				videoTypeFilter,
				genreFilter,
				excludeUnavailable,
			})
			songs = applySongOrder(songs, songOrder)
			const stamp = dayjs().format('YYYY-MM-DD_HH-mm-ss')
			// Si el título es genérico (p. ej. "Videos"), el canal alcanza para
			// reconocer la carpeta; si no, se antepone el canal al título.
			const genericTitle = GENERIC_PLAYLIST_TITLES.test(title.trim())
			const playListName = genericTitle ? channel : `${channel}-${title}`
			const outDir = uniqueOutDir(
				path.join(
					process.cwd(),
					'output',
					`${sanitizeFilename(playListName)}_${stamp}`,
				),
			)
			await writeOutputs({ songs, outDir, playListName, formats, columns })

			const files = [...formats].map((f) => `playlist.${f}`).join(', ')
			log(t('extract.done', { count: songs.length }))
			log(
				t('extract.outputPath', {
					dir: path.relative(process.cwd(), outDir),
					files,
				}),
			)
			return { count: songs.length, outDir }
		} finally {
			await context.close()
		}
	} finally {
		if (ownBrowser) await ownBrowser.close()
	}
}

// Exporta funciones puras para pruebas.
export {
	applySongFilters,
	applySongOrder,
	buildSongRows,
	classifyVideoType,
	dedupeSongs,
	flattenForTable,
	parseTitle,
	parseTracklist,
	projectSong,
	resolveChannelNames,
	trackToSong,
	videoToSong,
}
