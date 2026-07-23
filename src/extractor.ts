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

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import dayjs from 'dayjs'
import ExcelJS from 'exceljs'
import { type Browser, chromium, type Page } from 'playwright'
import {
	ALBUM_KEYWORDS,
	ANY_TS,
	COLUMNS,
	type Column,
	type ExtractConfig,
	type Format,
	GENRE_KEYWORDS,
	LEADING_TS,
	LONG_VIDEO_SECONDS,
	MIX_KEYWORDS,
	MIX_TYPE_KEYWORDS,
	NOISE_PATTERNS,
	NUM_LEAD_TS,
	NUM_TAIL_TS,
	type ParsedTitle,
	type PlaylistVideo,
	RANGE_TS,
	type RawPlaylistVideo,
	type Song,
	type SongOrder,
	type Track,
	type YoutubePageHTML,
} from './types.ts'
import { durationToSeconds, sanitizeFilename, shuffle, sleep } from './utils.ts'

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function splitArtists(raw: string): string[] {
	return raw
		.split(/\s*(?:,|&|\+|×|\bx\b|\bvs\.?\b|\bft\.?\b|\bwith\b)\s*/i)
		.map((a) => a.trim())
		.filter(Boolean)
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
		...new Set(anchorTexts.map((t) => t.trim()).filter(Boolean)),
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
	const featRegex =
		/[([]?\s*\b(?:feat|ft|featuring)\b\.?\s*([^)\]]+?)\s*(?:[)\]]|(?=\s[-–—]\s|$))/gi

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
			.replace(/^[\s\-–—.)\][(]+/, '')
			.replace(/[\s\-–—.([]+$/, '')
			.trim()
		rest = rest.replace(/^\d{1,2}\s*[.)-]\s*/, '') // quitar numeración inicial sobrante
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
		const m = line.match(/^(\d{1,2})\s*[.)-]\s+(.+)$/)
		if (!m) continue
		// Puede venir un timestamp al inicio ("1. 05:36 Artista - Título") o al final;
		// se captura el que aparezca y se limpia del título.
		let rest = m[2]
		let startTimestamp = ''
		const leadTs = rest.match(NUM_LEAD_TS)
		if (leadTs) {
			startTimestamp = leadTs[1]
			rest = rest
				.slice(leadTs[0].length)
				.replace(/^\s*[-–—]\s*/, '')
				.trim()
		} else {
			const tailTs = rest.match(NUM_TAIL_TS)
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
		(await page.locator('ytd-playlist-video-list-renderer').count()) > 0
	const scopeSelectors = hasListRenderer
		? ['ytd-playlist-video-list-renderer']
		: ['yt-item-section-renderer', 'ytd-item-section-renderer']
	const itemTags = ['yt-lockup-view-model', 'ytd-playlist-video-renderer']
	const playlistSection = () => page.locator(scopeSelectors.join(', ')).first()
	await page
		.waitForSelector(
			scopeSelectors
				.flatMap((s) => itemTags.map((t) => `${s} ${t}`))
				.join(', '),
			{ timeout: 30000 },
		)
		.catch(() => {})

	// Scroll incremental hasta que el número de items se estabilice (lazy load),
	// o hasta alcanzar el límite solicitado.
	let stable = 0
	let lastCount = 0
	for (let i = 0; i < 400 && stable < 3; i++) {
		const count = await playlistSection()
			.locator('yt-lockup-view-model, ytd-playlist-video-renderer')
			.count()
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
		const header = document.querySelector(
			'yt-page-header-renderer, ytd-playlist-header-renderer',
		)
		const ownerAnchor = header
			? (Array.from(header.querySelectorAll('a')).find((a) =>
					/\/(@|channel\/|c\/|user\/)/.test(
						(a as HTMLAnchorElement).getAttribute('href') || '',
					),
				) as HTMLAnchorElement | undefined)
			: undefined
		const channel = (ownerAnchor?.innerText || '').trim()

		return { title, channel }
	})

	const videos: RawPlaylistVideo[] = await page.evaluate(() => {
		// El primer "item-section-renderer" es la playlist real; los que le
		// siguen son secciones de recomendados que no deben incluirse. Si existe
		// ytd-playlist-video-list-renderer (variante Polymer vieja), se prioriza
		// ese scope más estricto porque ahí las sugerencias no se cuelan aunque
		// compartan section con el contenido real. Si no se encuentra nada
		// (cambio de markup de YouTube), se cae al documento completo para no
		// romper la extracción.
		const listRenderer = document.querySelector(
			'ytd-playlist-video-list-renderer',
		)
		const section =
			document.querySelector('yt-item-section-renderer') ||
			document.querySelector('ytd-item-section-renderer')
		const root = listRenderer ?? section ?? document
		const items = Array.from(
			root.querySelectorAll(
				'yt-lockup-view-model, ytd-playlist-video-renderer',
			),
		)
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
			// Canal(es): en videos normales hay un <a> al canal; en videos de
			// "colaboración" (varios canales dueños) YouTube no pone ningún
			// anchor y en cambio escribe los nombres como texto plano (p. ej.
			// "Alan Walker and Au/Ra") en la primera fila de metadata. Se
			// capturan ambas señales crudas acá; resolveChannelNames (función
			// pura de Node) decide cuál usar y cómo separarlas.
			const chanAnchorTexts = Array.from(item.querySelectorAll('a'))
				.filter((a) =>
					/\/(@|channel\/|c\/|user\/)/.test(
						(a as HTMLAnchorElement).getAttribute('href') || '',
					),
				)
				.map((a) => (a as HTMLAnchorElement).innerText.trim())
				.filter(Boolean)
			const metaRowText = (
				item.querySelector('.ytContentMetadataViewModelMetadataRow')
					?.textContent || ''
			).trim()
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
	})

	const limited = Number.isFinite(maxVideos)
		? videos.slice(0, maxVideos)
		: videos

	// Completar campos derivados (fuera del browser), incluyendo la
	// resolución final de channel (requiere resolveChannelNames, que no
	// existe dentro del contexto del browser en page.evaluate).
	const finalVideos: PlaylistVideo[] = limited.map((v) => {
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
			for (const t of tracks) songs.push(trackToSong(v, t))
		} else {
			songs.push(videoToSong(v))
		}
	}
	return songs
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
	// Columnas elegidas, en el orden elegido por el usuario.
	const byKey = new Map(COLUMNS.map((c) => [c.key, c]))
	const selectedColumns = columns.map((k) => byKey.get(k) ?? COLUMNS[0])
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
		const ws = wb.addWorksheet('Canciones')
		ws.columns = selectedColumns.map((c) => ({
			header: c.header,
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
		maxVideos,
		formats,
		expandAlbums,
		columns,
		songOrder,
		excludeUnavailable,
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
			log('▶ Abriendo navegador…')
			ownBrowser = await chromium.launch({ headless: true })
			browser = ownBrowser
		}
		const context = await browser.newContext({
			locale: 'en-US',
			userAgent:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
		})
		try {
			const page = await context.newPage()

			log('▶ Leyendo la playlist…')
			const { title, videos, channel } = await scrapePlaylist(
				page,
				fullUrl,
				maxVideos,
			)
			log(`  ✓ ${videos.length} videos encontrados en "${title}"`)

			// Tracklists de candidatos (álbumes/mixes), solo si está habilitado.
			const candidates = expandAlbums ? videos.filter((v) => v.isCandidate) : []
			const tracklists = new Map<string, Track[]>()
			if (candidates.length > 0) {
				log(
					`▶ Extrayendo tracklists de ${candidates.length} candidato(s) a álbum/mix…`,
				)
				for (const v of candidates) {
					const tracks = await fetchTracklist(page, v.videoId)
					if (tracks.length > 0) {
						tracklists.set(v.videoId, tracks)
						log(`  ✓ "${v.rawTitle.slice(0, 50)}…" → ${tracks.length} pistas`)
					} else {
						log(`  · "${v.rawTitle.slice(0, 50)}…" → sin tracklist detectable`)
					}
					await sleep(600) // ser educado con el servidor
				}
			}

			let songs = buildSongRows(videos, tracklists)
			if (excludeUnavailable) {
				songs = songs.filter((s) => s.availability !== 'unavailable')
			}
			songs = applySongOrder(songs, songOrder)
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
			await writeOutputs({ songs, outDir, playListName, formats, columns })

			const files = [...formats].map((f) => `playlist.${f}`).join(', ')
			log(`\n✅ Listo: ${songs.length} canciones exportadas`)
			log(`   ${path.relative(process.cwd(), outDir)}/  (${files})`)
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
	applySongOrder,
	classifyVideoType,
	parseTitle,
	parseTracklist,
	resolveChannelNames,
	trackToSong,
	videoToSong,
}
