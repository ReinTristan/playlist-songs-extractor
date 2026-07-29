/**
 * Tipos y constantes compartidos del extractor de playlists.
 *
 * Aquí viven los tipos de dominio (videos, pistas, canciones, configuración)
 * y las constantes puras de datos: formatos/columnas de salida, keywords de
 * heurística y la gramática de timestamps. La lógica vive en `extractor.ts`.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PlaylistVideo {
	index: number // posición 1-based dentro de la playlist
	rawTitle: string
	channel: string[] // uno o más canales dueños (colaboraciones de YouTube)
	videoId: string
	url: string
	thumbnail: string
	duration: string
	durationSeconds: number
	availability: 'available' | 'unavailable'
	videoType: 'single' | 'album' | 'mix' | 'unknown'
	isCandidate: boolean
}

/**
 * Forma intermedia de un video tal como sale del `page.evaluate` de
 * `scrapePlaylist`: trae señales crudas del DOM (anchors de canal, texto de
 * la fila de metadata) en vez del `channel` ya resuelto, porque resolverlo
 * requiere `resolveChannelNames` (función pura de Node, sin acceso desde el
 * contexto del browser).
 */
export type RawPlaylistVideo = Omit<PlaylistVideo, 'channel'> & {
	chanAnchorTexts: string[]
	metaRowText: string
}

export interface Track {
	trackIndex: number
	startTimestamp: string
	rawTrackTitle: string
}

export interface ParsedTitle {
	artists: string[]
	featuredArtists: string[]
	songTitle: string
	mixType: string
	genres: string[]
}

export interface Song {
	position: string
	artists: string[]
	featuredArtists: string[]
	songTitle: string
	mixType: string
	genres: string[]
	rawTitle: string
	channel: string[]
	videoType: string
	availability: string
	duration: string
	videoId: string
	url: string
	thumbnail: string
	parentVideoId: string
	startTimestamp: string
}

/**
 * Formatos de archivo que puede generar la extracción (fuente única).
 * Los labels visibles viven en `locales/` (`formatLabel` en `i18n.ts`).
 */
export const FORMATS = ['json', 'csv', 'xlsx'] as const
export type Format = (typeof FORMATS)[number]

/**
 * Modos de orden de canciones (opción experimental, fuente única).
 * Los labels visibles viven en `locales/` (`songOrderLabel` en `i18n.ts`).
 */
export const SONG_ORDERS = [
	'original',
	'reverse',
	'alphabetical-asc',
	'alphabetical-desc',
	'shuffle',
] as const
export type SongOrder = (typeof SONG_ORDERS)[number]

/** Configuración de una extracción, ajustable desde el CLI. */
export interface ExtractConfig {
	fullUrl: string
	allVideos: boolean // true = procesar todos (ignora maxVideos)
	maxVideos: number // límite entero ≥ 1, solo si allVideos es false
	formats: Set<Format>
	expandAlbums: boolean
	columns: (keyof Song)[] // subconjunto de las keys de COLUMNS, en el orden de salida deseado
	songOrder: SongOrder // default 'original' (opción extra, desactivada por defecto)
	excludeUnavailable: boolean // default false (opción extra, desactivada por defecto)
	onProgress?: (message: string) => void // default: console.log
}

export interface YoutubePageHTML extends Window {
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
// Columnas de salida
// ---------------------------------------------------------------------------

/**
 * Columnas de salida en su orden canónico. La `key` es la del dominio (`Song`)
 * y no cambia con el idioma; el header visible se resuelve con `columnHeader`
 * de `i18n.ts` contra `columns.<key>` en `locales/`.
 */
export const COLUMNS: { key: keyof Song; width: number }[] = [
	{ key: 'position', width: 10 },
	{ key: 'artists', width: 28 },
	{ key: 'featuredArtists', width: 22 },
	{ key: 'songTitle', width: 34 },
	{ key: 'mixType', width: 16 },
	{ key: 'genres', width: 18 },
	{ key: 'rawTitle', width: 42 },
	{ key: 'channel', width: 24 },
	{ key: 'videoType', width: 14 },
	{ key: 'availability', width: 14 },
	{ key: 'duration', width: 10 },
	{ key: 'videoId', width: 14 },
	{ key: 'url', width: 44 },
	{ key: 'thumbnail', width: 44 },
	{ key: 'parentVideoId', width: 14 },
	{ key: 'startTimestamp', width: 12 },
]

export type Column = (typeof COLUMNS)[number]

// ---------------------------------------------------------------------------
// Constantes de heurística
// ---------------------------------------------------------------------------

/** Duración (s) a partir de la cual un video se considera candidato a álbum/mix. */
export const LONG_VIDEO_SECONDS = 18 * 60

export const ALBUM_KEYWORDS = [
	'full album',
	'album completo',
	'álbum completo',
	'full ep',
	'the album',
	'disco completo',
]
export const MIX_KEYWORDS = [
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
export const MIX_TYPE_KEYWORDS = [
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
export const GENRE_KEYWORDS = [
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
export const NOISE_PATTERNS: RegExp[] = [
	/\(\s*official(?:\s+music)?(?:\s+lyric)?(?:\s+video|\s+audio)?\s*\)/gi,
	/\[\s*official(?:\s+music)?(?:\s+lyric)?(?:\s+video|\s+audio)?\s*\]/gi,
	/\(\s*(?:music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio|video oficial|audio oficial|video musical|letra)\s*\)/gi,
	/\[\s*(?:music\s+video|lyric\s+video|lyrics?|visuali[sz]er|audio|video oficial|audio oficial|video musical|letra)\s*\]/gi,
	/[([]\s*(?:hd|hq|4k|8k|m\/v|mv|free\s+download|free\s+dl|out\s+now)\s*[)\]]/gi,
]

// ---------------------------------------------------------------------------
// Gramática de timestamps
// ---------------------------------------------------------------------------

/** Gramática compartida de un timestamp "(h:)mm:ss" (fuente de las regex de abajo). */
export const TS_PATTERN = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}'

/** Timestamp al inicio del texto de una pista, con paréntesis/guion opcionales. */
export const LEADING_TS = new RegExp(
	`^[([]?(${TS_PATTERN})[)\\]]?\\s*[-–—.]?\\s*`,
)

/** Línea que abre con un rango de timestamps "ts - ts" (p. ej. "0:00 - 5:36 …"). */
export const RANGE_TS = new RegExp(
	`^[([]?${TS_PATTERN}[)\\]]?\\s*[-–—]\\s*[([]?${TS_PATTERN}[)\\]]?`,
)

/** Primer timestamp en cualquier parte de la línea. */
export const ANY_TS = new RegExp(`(${TS_PATTERN})`)

/** Timestamp al inicio de una pista numerada, delimitado. */
export const NUM_LEAD_TS = new RegExp(
	`^\\s*[([]?(${TS_PATTERN})[)\\]]?(?=\\s|[-–—]|$)`,
)

/** Timestamp al final de una pista numerada. */
export const NUM_TAIL_TS = new RegExp(`\\s*[([]?(${TS_PATTERN})[)\\]]?\\s*$`)
