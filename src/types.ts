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

/**
 * Un video tal como lo entrega una *fuente* (`sources/`): sólo señales crudas,
 * nada derivado. El canal viene sin resolver —los anchors por un lado, el texto
 * de la fila de metadata por el otro— porque elegir entre ambos es trabajo de
 * `resolveChannelNames`, que vive en la capa de procesamiento y no tiene acceso
 * al contexto del browser.
 *
 * `availability` sí la decide la fuente, aunque parezca heurística: los títulos
 * literales "[Private video]"/"[Deleted video]" son un artefacto de cómo YouTube
 * renderiza la página, y la API los reporta por otro camino. Cada fuente lo
 * detecta a su manera y entrega la respuesta ya normalizada.
 */
export interface RawPlaylistVideo {
	index: number // posición 1-based dentro de la playlist
	rawTitle: string
	chanAnchorTexts: string[] // textos de los anchors de canal (caso normal)
	metaRowText: string // texto plano de metadata (videos de colaboración)
	videoId: string
	url: string
	thumbnail: string
	duration: string
	availability: 'available' | 'unavailable'
}

/**
 * Un video ya procesado por `toPlaylistVideos`: lo crudo (menos las señales sin
 * resolver) más lo que se deriva de ello. Todo lo que se agrega acá se calcula
 * igual venga de donde venga el video, así que no depende de la fuente.
 */
export interface PlaylistVideo
	extends Omit<RawPlaylistVideo, 'chanAnchorTexts' | 'metaRowText'> {
	channel: string[] // uno o más canales dueños (colaboraciones de YouTube)
	durationSeconds: number
	videoType: VideoType
	isCandidate: boolean
}

/**
 * Lo que devuelve cualquier fuente al pedirle una playlist. Es el único contrato
 * que comparten el scraping de hoy y la YouTube Data API del futuro: datos
 * crudos, sin interpretar.
 */
export interface PlaylistPayload {
	title: string
	channel: string
	videos: RawPlaylistVideo[]
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

/** Tipo de video tal como lo clasifica `classifyVideoType` (fuente única). */
export const VIDEO_TYPES = ['single', 'album', 'mix', 'unknown'] as const
export type VideoType = (typeof VIDEO_TYPES)[number]

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
	longVideoSeconds: number // umbral de "video largo" (default LONG_VIDEO_SECONDS)
	dedupe: boolean // default false: descarta canciones repetidas
	videoTypeFilter: VideoType[] | null // null = sin filtrar
	genreFilter: string[] | null // null = sin filtrar
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
// Separadores
// ---------------------------------------------------------------------------

/**
 * Guiones aceptados como separador "artista - canción".
 *
 * No alcanza con el guion ASCII y los de tipografía (en dash, em dash): hay
 * fuentes/copy-paste que traen HYPHEN (U+2010), NON-BREAKING HYPHEN (U+2011),
 * FIGURE DASH (U+2012) o MINUS SIGN (U+2212), visualmente idénticos. Si falta
 * alguno, el título entero queda como nombre de canción sin artista.
 *
 * El `-` va escapado para poder interpolar esta cadena en cualquier posición
 * de un `[...]` sin que se lea como rango (`[.)-‐]` sería el rango
 * `)`–`‐`, que se traga dígitos y letras).
 */
export const DASH_CHARS = '\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212'

/** Clase de caracteres lista para interpolar en una regex. */
export const DASH_CLASS = `[${DASH_CHARS}]`

/** Numeración de una pista en una tracklist ("1.", "12)", "100 - "). */
export const TRACK_NUMBER_PATTERN = `\\d{1,3}\\s*[.)${DASH_CHARS}]`

// ---------------------------------------------------------------------------
// Gramática de timestamps
// ---------------------------------------------------------------------------

/** Gramática compartida de un timestamp "(h:)mm:ss" (fuente de las regex de abajo). */
export const TS_PATTERN = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}'

/** Timestamp al inicio del texto de una pista, con paréntesis/guion opcionales. */
export const LEADING_TS = new RegExp(
	`^[([]?(${TS_PATTERN})[)\\]]?\\s*[${DASH_CHARS}.]?\\s*`,
)

/** Línea que abre con un rango de timestamps "ts - ts" (p. ej. "0:00 - 5:36 …"). */
export const RANGE_TS = new RegExp(
	`^[([]?${TS_PATTERN}[)\\]]?\\s*${DASH_CLASS}\\s*[([]?${TS_PATTERN}[)\\]]?`,
)

/** Primer timestamp en cualquier parte de la línea. */
export const ANY_TS = new RegExp(`(${TS_PATTERN})`)

/** Timestamp al inicio de una pista numerada, delimitado. */
export const NUM_LEAD_TS = new RegExp(
	`^\\s*[([]?(${TS_PATTERN})[)\\]]?(?=\\s|${DASH_CLASS}|$)`,
)

/** Timestamp al final de una pista numerada. */
export const NUM_TAIL_TS = new RegExp(`\\s*[([]?(${TS_PATTERN})[)\\]]?\\s*$`)

// ---------------------------------------------------------------------------
// DOM de YouTube (compartido con debug-dom.ts)
// ---------------------------------------------------------------------------

/**
 * Selectores del scraper. Viven acá —y no en `extractor.ts`— porque
 * `debug-dom.ts` existe justamente para diagnosticar cuándo YouTube cambia su
 * markup: si cada archivo tuviera su propia copia, el script de debug podría
 * quedar mirando selectores viejos y reportar un DOM que el scraper real ya no
 * usa.
 *
 * Como se usan dentro de `page.evaluate` (contexto del browser, sin acceso a
 * los imports de Node), hay que pasarlos explícitamente como argumento.
 */
export const YT_SELECTORS = {
	/** Variante Polymer vieja: contenedor estricto del contenido real. */
	listRenderer: 'ytd-playlist-video-list-renderer',
	/** Secciones de la página; la primera es la playlist, las demás recomendados. */
	sections: 'yt-item-section-renderer, ytd-item-section-renderer',
	/**
	 * Las mismas secciones en orden de preferencia. La variante nueva gana sobre
	 * la vieja aunque aparezca después en el documento, que es lo que hace un
	 * `querySelector(a) || querySelector(b)` y no un selector con coma.
	 */
	sectionsByPreference: [
		'yt-item-section-renderer',
		'ytd-item-section-renderer',
	],
	/** Un ítem de playlist, en cualquiera de las dos variantes de UI. */
	items: 'yt-lockup-view-model, ytd-playlist-video-renderer',
	/** Link al video dentro de un ítem (trae título y videoId). */
	itemTitleLink: 'h3 a',
	header: 'yt-page-header-renderer, ytd-playlist-header-renderer',
	title:
		'yt-dynamic-sizing-formatted-string, #title yt-formatted-string, h1 .ytPageHeaderViewModelTitle',
	metadataRow: '.ytContentMetadataViewModelMetadataRow',
	durationBadge: 'yt-thumbnail-badge-view-model',
	description: '#description-inline-expander, #description',
} as const

/** Scopes en orden de preferencia (el estricto primero). */
export const YT_SCOPE_SELECTORS = [
	YT_SELECTORS.listRenderer,
	'yt-item-section-renderer',
	'ytd-item-section-renderer',
]

/**
 * Detecta un `href` de canal. Se guarda como *string* y no como RegExp porque
 * tiene que cruzar a `page.evaluate`, que serializa sus argumentos a JSON.
 */
export const CHANNEL_HREF_SOURCE = '/(@|channel/|c/|user/)'

export const CHANNEL_HREF_RE = new RegExp(CHANNEL_HREF_SOURCE)

/** UA de Chrome desktop: YouTube sirve markup distinto a un headless sin UA. */
export const DESKTOP_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Títulos de playlist tan genéricos que solos no identifican la carpeta de
 * salida: en esos casos alcanza con el nombre del canal.
 */
export const GENERIC_PLAYLIST_TITLES =
	/^(videos|playlist|mix|favoritos|favorites)$/i

// ---------------------------------------------------------------------------
// Tiempos del scraper
// ---------------------------------------------------------------------------

/** Timeout de navegación a la página de la playlist. */
export const PLAYLIST_NAV_TIMEOUT_MS = 60_000
/** Timeout de navegación a la página de un video (tracklist). */
export const VIDEO_NAV_TIMEOUT_MS = 45_000
/** Espera máxima a que aparezca el primer ítem de la playlist. */
export const CONTENT_TIMEOUT_MS = 30_000
/** Espera a que hidrate la descripción del video antes de leerla. */
export const DESCRIPTION_SETTLE_MS = 1_200
/** Timeout del click al botón de consentimiento de cookies. */
export const CONSENT_CLICK_TIMEOUT_MS = 5_000
/** Espera tras aceptar el consentimiento, mientras YouTube recarga la vista. */
export const CONSENT_SETTLE_MS = 1_000
/** Iteraciones máximas del scroll de carga perezosa (corta un scroll infinito). */
export const SCROLL_MAX_ITERATIONS = 400
/** Rondas seguidas sin ítems nuevos para dar por terminado el scroll. */
export const SCROLL_STABLE_ROUNDS = 3
/** Pausa entre scrolls para que YouTube alcance a renderizar el lote nuevo. */
export const SCROLL_SLEEP_MS = 700
/** Pausa entre videos al pedir tracklists: ser educado con el servidor. */
export const POLITE_SLEEP_MS = 600
