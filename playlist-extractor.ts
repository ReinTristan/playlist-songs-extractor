/**
 * Extractor de canciones de playlists de YouTube (Parte 1 — Scraper).
 *
 * Uso:
 *   node playlist-extractor.ts "https://www.youtube.com/playlist?list=..."
 *   bun  playlist-extractor.ts "https://www.youtube.com/playlist?list=..."
 *
 * Genera output/<playlist>_<timestamp local>/ con playlist.json, playlist.csv y playlist.xlsx
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dayjs from 'dayjs'
import ExcelJS from 'exceljs'
import { type Browser, chromium, type Page } from 'playwright'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface PlaylistVideo {
	index: number // posición 1-based dentro de la playlist
	rawTitle: string
	channel: string
	videoId: string
	url: string
	thumbnail: string
	duration: string
	durationSeconds: number
	availability: 'available' | 'unavailable'
	videoType: 'single' | 'album' | 'mix' | 'unknown'
	isCandidate: boolean
}

interface Track {
	trackIndex: number
	startTimestamp: string
	rawTrackTitle: string
}

interface ParsedTitle {
	artists: string[]
	featuredArtists: string[]
	songTitle: string
	mixType: string
	genres: string[]
}

interface Song {
	position: string
	artists: string[]
	featuredArtists: string[]
	songTitle: string
	mixType: string
	genres: string[]
	rawTitle: string
	channel: string
	videoType: string
	availability: string
	duration: string
	videoId: string
	url: string
	thumbnail: string
	parentVideoId: string
	startTimestamp: string
}

interface YoutubePageHTML extends Window {
	ytInitialPlayerResponse: {
		videoDetails: {
			shortDescription: string
		}
	}
	ytInitialData: {
		metadata: {
			playlistMetadataRenderer: {
				title: string
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Constantes de heurística
// ---------------------------------------------------------------------------

/** Duración (s) a partir de la cual un video se considera candidato a álbum/mix. */
const LONG_VIDEO_SECONDS = 18 * 60

const ALBUM_KEYWORDS = [
	'full album',
	'album completo',
	'álbum completo',
	'full ep',
	'the album',
	'disco completo',
]
const MIX_KEYWORDS = [
	'mixtape',
	'megamix',
	'dj set',
	'compilation',
	'continuous mix',
	'podcast',
	'live set',
	// Nota: no incluir 'mix' suelto: sobre-clasifica temas de una sola canción
	// como "(Extended Mix)", "(VIP Mix)", "(Original Mix)" (falsos DJ sets).
]

/** Palabras que indican un tipo de mezcla (no la canción original). */
const MIX_TYPE_KEYWORDS = [
	'remix',
	'bootleg',
	'edit',
	'flip',
	'mashup',
	'mash-up',
	'vip',
	'rework',
	'refix',
	'cover',
	'remaster',
	'remastered',
	'extended mix',
	'extended',
	'club mix',
	'radio edit',
	'instrumental',
	'acoustic',
	'acapella',
	'a cappella',
	'slowed',
	'sped up',
	'nightcore',
]

/** Lista blanca de géneros para detectarlos en corchetes/paréntesis del título. */
const GENRE_KEYWORDS = [
	'drum & bass',
	'drum and bass',
	'dnb',
	'd&b',
	'deep house',
	'future house',
	'tech house',
	'progressive house',
	'electro house',
	'bass house',
	'slap house',
	'big room',
	'future bass',
	'melodic dubstep',
	'melodic bass',
	'color bass',
	'colour bass',
	'future garage',
	'uk garage',
	'hard techno',
	'hard house',
	'hardstyle',
	'hardcore',
	'happy hardcore',
	'psytrance',
	'trance',
	'techno',
	'house',
	'dubstep',
	'riddim',
	'trap',
	'edm',
	'synthwave',
	'lo-fi',
	'lofi',
	'chillstep',
	'chillout',
	'ambient',
	'downtempo',
	'breakbeat',
	'jungle',
	'phonk',
	'brazilian phonk',
	'hyperpop',
	'hip hop',
	'hip-hop',
	'rap',
	'r&b',
	'pop',
	'rock',
	'indie',
	'metal',
	'reggaeton',
	'reggae',
	'latin',
	'salsa',
	'cumbia',
	'jazz',
	'funk',
	'soul',
	'disco',
	'garage',
]

/** Etiquetas de "ruido" a quitar del título. */
const NOISE_PATTERNS: RegExp[] = [
	/\(\s*official(?:\s+music)?(?:\s+lyric)?(?:\s+video|\s+audio)?\s*\)/gi,
	/\[\s*official(?:\s+music)?(?:\s+lyric)?(?:\s+video|\s+audio)?\s*\]/gi,
	/\(\s*(?:music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio|video oficial|audio oficial|video musical|letra)\s*\)/gi,
	/\[\s*(?:music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio|video oficial|audio oficial|video musical|letra)\s*\]/gi,
	/[([]\s*(?:hd|hq|4k|8k|m\/v|mv|free\s+download|free\s+dl|out\s+now)\s*[)\]]/gi,
]

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms))

/** Convierte "h:mm:ss" o "mm:ss" a segundos. */
function durationToSeconds(duration: string): number {
	const parts = duration.split(':').map((p) => parseInt(p.trim(), 10))
	if (parts.some((n) => Number.isNaN(n)) || parts.length === 0) return 0
	return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** Sanitiza un nombre para usarlo como carpeta/archivo. */
function sanitizeFilename(name: string): string {
	return (
		name
			.replace(/[<>:"/\\|?*]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120) || 'playlist'
	)
}

function splitArtists(raw: string): string[] {
	return raw
		.split(/\s*(?:,|&|\+|×|\bx\b|\bvs\.?\b|\bft\.?\b|\bwith\b)\s*/i)
		.map((a) => a.trim())
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
	const featRegex =
		/[([]?\s*\b(?:feat|ft|featuring)\b\.?\s*([^)\]\-–—]+?)\s*(?:[)\]]|(?=[-–—]|$))/gi

	working = working.replace(featRegex, (_m, names: string) => {
		splitArtists(names).forEach((a) => {
			featuredArtists.push(a)
		})
		return ' '
	})
	const featWithRegex = /[([]\s*(?:with|con)\s+([^)\]]+?)\s*[)\]]/gi

	working = working.replace(featWithRegex, (_m, names: string) => {
		splitArtists(names).forEach((a) => {
			featuredArtists.push(a)
		})
		return ' '
	})

	// 2) mixType: buscar palabra clave; preferir el contenido del paréntesis/corchete que la contiene.
	const mixTypeAlt = MIX_TYPE_KEYWORDS.map((k) =>
		k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
	).join('|')
	const bracketMix = new RegExp(
		`[\\(\\[]([^()\\[\\]]*\\b(?:${mixTypeAlt})\\b[^()\\[\\]]*)[\\)\\]]`,
		'i',
	)
	const bracketMatch = working.match(bracketMix)
	if (bracketMatch) {
		mixType = bracketMatch[1].trim()
	} else {
		const bareMix = new RegExp(`\\b(${mixTypeAlt})\\b`, 'i')
		const bare = working.match(bareMix)
		if (bare) mixType = bare[1].trim()
	}

	// 3) genres: buscar géneros de la lista blanca dentro de corchetes/paréntesis.
	const bracketContents = working.match(/[([]([^()[\]]+)[)\]]/g) || []
	for (const chunk of bracketContents) {
		const inner = chunk.slice(1, -1).toLowerCase()
		for (const genre of GENRE_KEYWORDS) {
			const g = new RegExp(
				`\\b${genre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
				'i',
			)
			if (g.test(inner) && !genres.some((x) => x.toLowerCase() === genre)) {
				genres.push(genre)
			}
		}
	}

	// 4) Quitar ruido.
	for (const pattern of NOISE_PATTERNS) working = working.replace(pattern, ' ')

	// Quitar corchetes/paréntesis que sólo contienen géneros (ya capturados).
	working = working.replace(/[([]([^()[\]]+)[)\]]/g, (m, inner: string) => {
		const low = inner.trim().toLowerCase()
		return GENRE_KEYWORDS.some((g) => low === g) ? ' ' : m
	})

	working = working.replace(/\s+/g, ' ').trim()

	// 4b) Segmentos separados por "|" (formato común: "Artista - Canción | Género | Label").
	//     Se conserva el segmento con el guion como principal; los demás se revisan por género.
	if (working.includes('|')) {
		const segments = working
			.split('|')
			.map((s) => s.trim())
			.filter(Boolean)
		for (const seg of segments) {
			const low = seg.toLowerCase()
			for (const genre of GENRE_KEYWORDS) {
				const g = new RegExp(
					`\\b${genre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
					'i',
				)
				if (g.test(low) && !genres.some((x) => x.toLowerCase() === genre))
					genres.push(genre)
			}
		}
		working = segments.find((s) => /\s[-–—]\s/.test(s)) || segments[0]
	}

	// 5) Artistas + canción: separar por el primer guion.
	let artists: string[] = []
	let songTitle = working
	const dashMatch = working.match(/^(.*?)\s+[-–—]\s+(.*)$/)
	if (dashMatch) {
		artists = splitArtists(dashMatch[1])
		songTitle = dashMatch[2].trim()
	}

	// Limpieza final del título de la canción.
	songTitle = songTitle
		.replace(/\s*[-–—]\s*$/, '')
		.replace(/\s+/g, ' ')
		.trim()

	// Quitar géneros genéricos contenidos en otro más específico (p. ej. "house" si hay "deep house").
	const refinedGenres = genres.filter(
		(g) =>
			!genres.some(
				(other) =>
					other !== g &&
					new RegExp(
						`\\b${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
						'i',
					).test(other),
			),
	)

	return { artists, featuredArtists, songTitle, mixType, genres: refinedGenres }
}

// ---------------------------------------------------------------------------
// Tracklist (descripción de álbumes/mixes)
// ---------------------------------------------------------------------------

/** Timestamp al inicio del texto de una pista, con paréntesis/guion opcionales. */
const LEADING_TS = /^[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—.]?\s*/

function parseTracklist(description: string): Track[] {
	if (!description) return []
	const lines = description
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)

	// Estrategia A: timestamps (h:)mm:ss
	const timeRe = /((?:\d{1,2}:)?\d{1,2}:\d{2})/
	const tsTracks: Track[] = []
	for (const line of lines) {
		const m = line.match(timeRe)
		if (!m) continue
		let rest = line.replace(m[0], ' ')
		rest = rest
			.replace(/^[\s\-–—.)\][(]+/, '')
			.replace(/[\s\-–—.([]+$/, '')
			.trim()
		rest = rest.replace(/^\d{1,2}\s*[.)-]\s*/, '') // quitar numeración inicial sobrante
		rest = rest.replace(LEADING_TS, '') // quitar timestamp residual (p. ej. rangos "0:00 - 5:36 …")
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
		const m = line.match(/^(\d{1,2})\s*[.)-]\s+(.+)$/)
		if (!m) continue
		// Puede venir un timestamp al inicio ("1. 05:36 Artista - Título") o al final;
		// se captura el que aparezca y se limpia del título.
		let rest = m[2]
		let startTimestamp = ''
		const leadTs = rest.match(/^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*/)
		if (leadTs) {
			startTimestamp = leadTs[1]
			rest = rest.slice(leadTs[0].length)
		} else {
			const tailTs = rest.match(
				/\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*$/,
			)
			if (tailTs) {
				startTimestamp = tailTs[1]
				rest = rest.slice(0, rest.length - tailTs[0].length)
			}
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
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
		await sleep(1200)
		const description = await page.evaluate(() => {
			const w = window as unknown as YoutubePageHTML
			const fromPlayer =
				w?.ytInitialPlayerResponse?.videoDetails?.shortDescription
			if (fromPlayer) return fromPlayer as string
			const el = document.querySelector(
				'#description-inline-expander, #description',
			)
			return el ? (el as HTMLElement).innerText : ''
		})
		return parseTracklist(description)
	} catch (err) {
		console.warn(
			`  ⚠ No se pudo leer la descripción de ${videoId}: ${(err as Error).message}`,
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
): {
	videoType: PlaylistVideo['videoType']
	isCandidate: boolean
} {
	const lower = rawTitle.toLowerCase()
	const isLong = durationSeconds >= LONG_VIDEO_SECONDS
	const hasAlbumKw = ALBUM_KEYWORDS.some((k) => lower.includes(k))
	const hasMixKw = MIX_KEYWORDS.some((k) =>
		new RegExp(`\\b${k}\\b`).test(lower),
	)

	// Sólo los videos largos se abren para extraer tracklist.
	if (isLong) {
		const videoType = hasAlbumKw ? 'album' : 'mix'
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
				await btn.click({ timeout: 5000 }).catch(() => {})
				await sleep(1000)
				return
			}
		}
	} catch {
		/* sin diálogo de consentimiento */
	}
}

async function scrapePlaylist(
	page: Page,
	url: string,
	maxVideos = Infinity,
): Promise<{ title: string; videos: PlaylistVideo[]; channel: string }> {
	await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
	await dismissConsent(page)
	await page
		.waitForSelector('yt-lockup-view-model', { timeout: 30000 })
		.catch(() => {})

	// Scroll incremental hasta que el número de items se estabilice (lazy load),
	// o hasta alcanzar el límite solicitado.
	let stable = 0
	let lastCount = 0
	for (let i = 0; i < 400 && stable < 3; i++) {
		const count = await page.locator('yt-lockup-view-model').count()
		if (count >= maxVideos) break
		if (count === lastCount) stable++
		else stable = 0
		lastCount = count
		await page.evaluate(() =>
			window.scrollTo(0, document.documentElement.scrollHeight),
		)
		await sleep(700)
	}

	const { title, channel } = await page.evaluate(() => {
		const w = window as unknown as YoutubePageHTML
		const fromData = w?.ytInitialData?.metadata?.playlistMetadataRenderer?.title
		const h1 = document.querySelector(
			'yt-dynamic-sizing-formatted-string, #title yt-formatted-string, h1 .ytPageHeaderViewModelTitle',
		)
		const title =
			(fromData as string) ||
			(h1 ? (h1 as HTMLElement).innerText : '') ||
			document.title.replace(/\s*-\s*YouTube\s*$/, '')

		// Canal: primer enlace a un canal dentro del header de la playlist.
		const header =
			document.querySelector(
				'yt-page-header-renderer, ytd-playlist-header-renderer',
			) || document.body
		const ownerAnchor = Array.from(header.querySelectorAll('a')).find((a) =>
			/\/(@|channel\/|c\/|user\/)/.test(
				(a as HTMLAnchorElement).getAttribute('href') || '',
			),
		) as HTMLAnchorElement | undefined
		const channel = (ownerAnchor?.innerText || '').trim()

		return { title, channel }
	})
	const videos: PlaylistVideo[] = await page.evaluate(() => {
		const items = Array.from(document.querySelectorAll('yt-lockup-view-model'))
		return items.map((item, i) => {
			const titleEl = item.querySelector('h3 a') as HTMLAnchorElement | null
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
			const chanAnchor = Array.from(item.querySelectorAll('a')).find((a) =>
				/\/(@|channel\/|c\/|user\/)/.test(
					(a as HTMLAnchorElement).getAttribute('href') || '',
				),
			) as HTMLAnchorElement | undefined
			const channel = (chanAnchor?.innerText || '').trim()
			const badges = Array.from(
				item.querySelectorAll('yt-thumbnail-badge-view-model'),
			).map((b) => (b as HTMLElement).innerText.trim())
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
				channel,
				videoId,
				url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : href,
				thumbnail,
				duration,
				durationSeconds: 0,
				availability: unavailable ? 'unavailable' : 'available',
				videoType: 'single',
				isCandidate: false,
			} as PlaylistVideo
		})
	})

	const limited = Number.isFinite(maxVideos)
		? videos.slice(0, maxVideos)
		: videos

	// Completar campos derivados (fuera del browser).
	for (const v of limited) {
		v.durationSeconds = durationToSeconds(v.duration)
		if (v.availability === 'available') {
			const { videoType, isCandidate } = classifyVideoType(
				v.rawTitle,
				v.durationSeconds,
			)
			v.videoType = videoType
			v.isCandidate = isCandidate
		} else {
			v.videoType = 'unknown'
		}
	}

	return {
		title: title || 'playlist',
		videos: limited,
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
			songTitle: v.rawTitle || '[No disponible]',
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
		artists: parsed.artists.length > 0 ? parsed.artists : [v.channel],
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
		artists: parsed.artists,
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
			for (const t of tracks) songs.push(trackToSong(v, t))
		} else {
			songs.push(videoToSong(v))
		}
	}
	return songs
}

// ---------------------------------------------------------------------------
// Exportadores
// ---------------------------------------------------------------------------

const COLUMNS: { header: string; key: keyof Song; width: number }[] = [
	{ header: 'Posición', key: 'position', width: 10 },
	{ header: 'Artistas', key: 'artists', width: 28 },
	{ header: 'Featured', key: 'featuredArtists', width: 22 },
	{ header: 'Canción', key: 'songTitle', width: 34 },
	{ header: 'Tipo de mezcla', key: 'mixType', width: 16 },
	{ header: 'Géneros', key: 'genres', width: 18 },
	{ header: 'Título original', key: 'rawTitle', width: 42 },
	{ header: 'Canal', key: 'channel', width: 24 },
	{ header: 'Tipo de video', key: 'videoType', width: 14 },
	{ header: 'Disponibilidad', key: 'availability', width: 14 },
	{ header: 'Duración', key: 'duration', width: 10 },
	{ header: 'Video ID', key: 'videoId', width: 14 },
	{ header: 'URL', key: 'url', width: 44 },
	{ header: 'Thumbnail', key: 'thumbnail', width: 44 },
	{ header: 'Video padre', key: 'parentVideoId', width: 14 },
	{ header: 'Timestamp', key: 'startTimestamp', width: 12 },
]

function flattenForTable(song: Song): Record<string, string> {
	const row: Record<string, string> = {}
	for (const col of COLUMNS) {
		const value = song[col.key]
		row[col.key] = Array.isArray(value) ? value.join('; ') : String(value ?? '')
	}
	return row
}

async function writeOutputs({
	songs,
	outDir,
	playListName,
}: {
	songs: Song[]
	outDir: string
	playListName: string
}): Promise<void> {
	await mkdir(outDir, { recursive: true })

	// JSON (arrays nativos).
	await writeFile(
		path.join(outDir, 'playlist.json'),
		JSON.stringify(
			{
				name: playListName,
				total: songs.length,
				songs,
			},
			null,
			2,
		),
		'utf8',
	)

	// Workbook compartido para XLSX y CSV (arrays como texto).
	const wb = new ExcelJS.Workbook()
	const ws = wb.addWorksheet('Canciones')
	ws.columns = COLUMNS.map((c) => ({
		header: c.header,
		key: c.key as string,
		width: c.width,
	}))
	ws.addRows(songs.map(flattenForTable))
	ws.getRow(1).font = { bold: true }
	ws.views = [{ state: 'frozen', ySplit: 1 }]

	await wb.xlsx.writeFile(path.join(outDir, 'playlist.xlsx'))
	await wb.csv.writeFile(path.join(outDir, 'playlist.csv'))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(): { fullUrl: string; maxVideos: number } {
	const url = process.argv[2]
	const isFullUrl = /youtube\.com|youtu\.be/.test(url)
	if (!url) {
		console.error(
			'Uso: node playlist-extractor.ts "<url de la playlist de YouTube>" [maxVideos]',
		)
		process.exit(1)
	}
	const fullUrl = isFullUrl ? url : `https://youtube.com/playlist?list=${url}`
	const limitArg = process.argv[3] || process.env.PLAYLIST_MAX || ''
	const maxVideos =
		limitArg && Number.isFinite(Number(limitArg)) ? Number(limitArg) : Infinity

	return { fullUrl, maxVideos }
}

async function main(): Promise<void> {
	const { fullUrl, maxVideos } = parseArgs()
	console.log('fullUrl', fullUrl)
	let browser: Browser | null = null

	try {
		console.log('▶ Abriendo navegador…')
		browser = await chromium.launch({ headless: true })
		const context = await browser.newContext({
			locale: 'en-US',
			userAgent:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		})
		const page = await context.newPage()

		console.log('▶ Leyendo la playlist…')
		const { title, videos, channel } = await scrapePlaylist(
			page,
			fullUrl,
			maxVideos,
		)
		console.log(`  ✓ ${videos.length} videos encontrados en "${title}"`)

		// Tracklists de candidatos (álbumes/mixes).
		const candidates = videos.filter((v) => v.isCandidate)
		const tracklists = new Map<string, Track[]>()
		if (candidates.length > 0) {
			console.log(
				`▶ Extrayendo tracklists de ${candidates.length} candidato(s) a álbum/mix…`,
			)
			for (const v of candidates) {
				const tracks = await fetchTracklist(page, v.videoId)
				if (tracks.length > 0) {
					tracklists.set(v.videoId, tracks)
					console.log(
						`  ✓ "${v.rawTitle.slice(0, 50)}…" → ${tracks.length} pistas`,
					)
				} else {
					console.log(
						`  · "${v.rawTitle.slice(0, 50)}…" → sin tracklist detectable`,
					)
				}
				await sleep(600) // ser educado con el servidor
			}
		}

		const songs = buildSongRows(videos, tracklists)
		const stamp = dayjs().format('YYYY-MM-DD_HH-mm-ss')
		// Si el título es genérico (p. ej. "Videos"), el canal alcanza para
		// reconocer la carpeta; si no, se antepone el canal al título.
		const genericTitle = /^(videos|playlist|mix|favoritos|favorites)$/i.test(
			title.trim(),
		)
		const playListName = genericTitle ? channel : `${channel}-${title}`
		const outDir = path.join(
			process.cwd(),
			'output',
			`${sanitizeFilename(playListName)}_${stamp}`,
		)
		await writeOutputs({ songs, outDir, playListName })

		console.log(`\n✅ Listo: ${songs.length} canciones exportadas`)
		console.log(
			`   ${path.relative(process.cwd(), outDir)}/  (playlist.json, playlist.csv, playlist.xlsx)`,
		)
	} finally {
		if (browser) await browser.close()
	}
}

// Exporta funciones puras para pruebas; ejecuta main() sólo si se invoca directamente.
export {
	classifyVideoType,
	durationToSeconds,
	parseTitle,
	parseTracklist,
	sanitizeFilename,
}

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
