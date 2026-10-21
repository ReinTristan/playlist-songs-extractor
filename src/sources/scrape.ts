/**
 * Fuente de datos: scraping de YouTube con Playwright.
 *
 * Este módulo es la mitad "habla con YouTube" del proyecto: navega, pelea con el
 * DOM y devuelve datos **crudos** (`PlaylistPayload`, la descripción de un video
 * como texto). No interpreta nada — clasificar, parsear títulos y expandir
 * tracklists es trabajo de `extractor.ts`, que no sabe de dónde salieron los
 * datos.
 *
 * Esa frontera existe para que una segunda fuente (la YouTube Data API v3, ver
 * specs/youtube-api-source.md) pueda entrar como hermana de este archivo
 * sin tocar el extractor.
 *
 * Los selectores viven en `types.ts` y no acá: los comparte `debug-dom.ts`, que
 * existe justamente para diagnosticar cuándo YouTube cambia su markup.
 */

import { type Browser, chromium, type Page } from 'playwright'
import { t } from '../i18n.ts'
import {
	CHANNEL_HREF_SOURCE,
	CONSENT_CLICK_TIMEOUT_MS,
	CONSENT_SETTLE_MS,
	CONTENT_TIMEOUT_MS,
	DESCRIPTION_SETTLE_MS,
	DESKTOP_USER_AGENT,
	PLAYLIST_NAV_TIMEOUT_MS,
	type PlaylistPayload,
	type RawPlaylistVideo,
	SCROLL_MAX_ITERATIONS,
	SCROLL_SLEEP_MS,
	SCROLL_STABLE_ROUNDS,
	VIDEO_NAV_TIMEOUT_MS,
	type YoutubePageHTML,
	YT_SCOPE_SELECTORS,
	YT_SELECTORS,
} from '../types.ts'
import { sleep } from '../utils.ts'

// ---------------------------------------------------------------------------
// Pasos del scraping de una playlist
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

/**
 * Decide dentro de qué contenedor está el contenido real de la playlist, y
 * devuelve **un** selector: el mismo que se usa para scrollear y para leer, así
 * no puede pasar que se cargue un scope y se lea otro.
 *
 * La página agrupa su contenido en varios "item-section-renderer": el primero
 * suele ser la playlist en sí, los siguientes son secciones de videos/playlists
 * recomendados que YouTube agrega debajo. Pero en playlists cortas, YouTube
 * puede meter esas sugerencias como hermanas del contenido real dentro del MISMO
 * section (variante Polymer vieja) — ahí, el contenido real está anidado en
 * ytd-playlist-video-list-renderer, que las sugerencias no comparten. Si ese
 * contenedor existe, se prioriza sobre el heurístico de "primer section".
 */
async function resolveScope(page: Page): Promise<string> {
	// Esperar el contenido ANTES de decidir: `locator.count()` no auto-espera, y
	// `domcontentloaded` dispara antes de que YouTube hidrate sus custom
	// elements. Preguntando primero, en una máquina lenta el list-renderer
	// todavía no existe y se caía al scope permisivo — justo el que puede
	// arrastrar videos recomendados.
	await page
		.waitForSelector(
			YT_SCOPE_SELECTORS.map((s) => `${s} ${YT_SELECTORS.items}`).join(', '),
			{ timeout: CONTENT_TIMEOUT_MS },
		)
		.catch(() => {})

	for (const selector of YT_SCOPE_SELECTORS) {
		if ((await page.locator(selector).count()) > 0) return selector
	}
	// Ningún scope conocido (cambio de markup): `readRawVideos` cae al documento
	// entero antes que devolver una playlist vacía.
	return YT_SELECTORS.listRenderer
}

/**
 * Scroll incremental hasta que el número de items se estabiliza (carga
 * perezosa), o hasta alcanzar el límite pedido. `limit === null` = sin límite.
 */
async function scrollUntilStable(
	page: Page,
	scope: string,
	limit: number | null,
): Promise<void> {
	const items = page.locator(scope).first().locator(YT_SELECTORS.items)
	let stable = 0
	let lastCount = 0
	for (
		let i = 0;
		i < SCROLL_MAX_ITERATIONS && stable < SCROLL_STABLE_ROUNDS;
		i++
	) {
		const count = await items.count()
		if (limit !== null && count >= limit) break
		if (count === lastCount) stable++
		else stable = 0
		lastCount = count
		await page.evaluate(() =>
			window.scrollTo(0, document.documentElement.scrollHeight),
		)
		await sleep(SCROLL_SLEEP_MS)
	}
}

/** Título y canal de la playlist, leídos del header. */
async function readPlaylistMetadata(
	page: Page,
): Promise<{ title: string; channel: string }> {
	// Los selectores viajan como argumento: dentro de page.evaluate no existen
	// los imports de Node, y la regex tiene que cruzar como string porque los
	// argumentos se serializan a JSON.
	return page.evaluate(
		({ sel, channelHref }) => {
			const w = window as unknown as YoutubePageHTML
			const fromData =
				w?.ytInitialData?.metadata?.playlistMetadataRenderer?.title
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
		},
		{ sel: YT_SELECTORS, channelHref: CHANNEL_HREF_SOURCE },
	)
}

/** Los items de la playlist, crudos: sin derivar duración, tipo ni canal. */
async function readRawVideos(
	page: Page,
	scope: string,
): Promise<RawPlaylistVideo[]> {
	return page.evaluate(
		({ sel, channelHref, scope }) => {
			// El scope ya lo decidió `resolveScope` en Node; acá sólo se resuelve a
			// un elemento. Si no matchea nada (cambio de markup de YouTube), se cae
			// al documento completo para no romper la extracción.
			const channelHrefRe = new RegExp(channelHref)
			const root = document.querySelector(scope) ?? document
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
					availability: unavailable ? 'unavailable' : 'available',
				} as RawPlaylistVideo
			})
		},
		{ sel: YT_SELECTORS, channelHref: CHANNEL_HREF_SOURCE, scope },
	)
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

/**
 * Una sesión de scraping abierta: un Chromium con una pestaña viva, sobre la que
 * se pueden hacer varias consultas. El menú interactivo abre una sola y la reusa
 * entre extracciones, así el navegador se lanza (y el consentimiento de cookies
 * se descarta) una única vez.
 *
 * Es el tipo concreto de *esta* fuente, no una interfaz abstracta: cuando exista
 * la fuente de la API se verá qué firma comparten de verdad. Hoy inventarla
 * sería diseñar contra una implementación imaginaria.
 */
export interface ScrapeSession {
	/** `limit === null` = todos los videos de la playlist. */
	fetchPlaylist(url: string, limit: number | null): Promise<PlaylistPayload>
	/** Descripción cruda de un video; la parsea el extractor. */
	readDescription(videoId: string): Promise<string>
	close(): Promise<void>
}

export async function openScrapeSession(): Promise<ScrapeSession> {
	let browser: Browser | null = null
	try {
		browser = await chromium.launch({ headless: true })
		const context = await browser.newContext({
			locale: 'en-US',
			userAgent: DESKTOP_USER_AGENT,
		})
		const page = await context.newPage()
		const owned = browser

		return {
			async fetchPlaylist(url, limit) {
				const response = await page.goto(url, {
					waitUntil: 'domcontentloaded',
					timeout: PLAYLIST_NAV_TIMEOUT_MS,
				})
				// Playwright no tira error ante un 4xx/5xx: sin este chequeo, una
				// playlist borrada/privada se "scrapea" bien, encuentra 0 videos y
				// escribe una carpeta de salida vacía como si todo hubiera salido bien.
				if (!response?.ok()) {
					throw new Error(
						t('errors.pageStatus', { status: response?.status() ?? 0, url }),
					)
				}
				await dismissConsent(page)

				const scope = await resolveScope(page)
				await scrollUntilStable(page, scope, limit)

				const { title, channel } = await readPlaylistMetadata(page)
				const videos = await readRawVideos(page, scope)

				return {
					title: title || 'playlist',
					channel: channel || 'Channel',
					videos: limit !== null ? videos.slice(0, limit) : videos,
				}
			},

			async readDescription(videoId) {
				const url = `https://www.youtube.com/watch?v=${videoId}`
				const response = await page.goto(url, {
					waitUntil: 'domcontentloaded',
					timeout: VIDEO_NAV_TIMEOUT_MS,
				})
				// Mismo motivo que en fetchPlaylist: un video caído devolvería una
				// descripción vacía indistinguible de un video sin tracklist.
				if (!response?.ok()) {
					throw new Error(
						t('errors.pageStatus', { status: response?.status() ?? 0, url }),
					)
				}
				await sleep(DESCRIPTION_SETTLE_MS)
				return page.evaluate((descriptionSelector) => {
					const w = window as unknown as YoutubePageHTML
					const fromPlayer =
						w?.ytInitialPlayerResponse?.videoDetails?.shortDescription
					if (fromPlayer) return fromPlayer as string
					const el = document.querySelector(descriptionSelector)
					return el ? (el as HTMLElement).innerText : ''
				}, YT_SELECTORS.description)
			},

			async close() {
				await owned.close()
			},
		}
	} catch (err) {
		// Si algo falla después de lanzar Chromium, no queda un proceso huérfano:
		// quien llamó nunca llegó a recibir la sesión, así que no puede cerrarla.
		await browser?.close()
		throw err
	}
}
