/**
 * Data source: scraping YouTube with Playwright.
 *
 * This module is the "talks to YouTube" half of the project: it navigates,
 * fights the DOM and returns **raw** data (`PlaylistPayload`, a video's
 * description as text). It interprets nothing — classifying, parsing titles and
 * expanding tracklists is the job of `extractor.ts`, which doesn't know where
 * the data came from.
 *
 * That boundary exists so a second source (the YouTube Data API v3, see
 * specs/youtube-api-source.md) can come in as a sibling of this file without
 * touching the extractor.
 *
 * The selectors live in `types.ts`, not here: they're shared with
 * `debug-dom.ts`, which exists precisely to diagnose when YouTube changes its
 * markup.
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
// Steps of scraping a playlist
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
		/* no consent dialog */
	}
}

/**
 * Decides which container holds the playlist's real content, and returns
 * **one** selector: the same one used to scroll and to read, so it can't happen
 * that one scope is loaded and another one is read.
 *
 * The page groups its content into several "item-section-renderer"s: the first
 * one is usually the playlist itself, the next ones are sections of recommended
 * videos/playlists YouTube adds below. But on short playlists, YouTube can put
 * those suggestions as siblings of the real content inside the SAME section
 * (old Polymer variant) — there, the real content is nested in
 * ytd-playlist-video-list-renderer, which the suggestions don't share. If that
 * container exists, it takes priority over the "first section" heuristic.
 */
async function resolveScope(page: Page): Promise<string> {
	// Wait for the content BEFORE deciding: `locator.count()` doesn't auto-wait,
	// and `domcontentloaded` fires before YouTube hydrates its custom elements.
	// Asking first, on a slow machine the list-renderer doesn't exist yet and it
	// fell back to the permissive scope — exactly the one that can drag in
	// recommended videos.
	await page
		.waitForSelector(
			YT_SCOPE_SELECTORS.map((s) => `${s} ${YT_SELECTORS.items}`).join(', '),
			{ timeout: CONTENT_TIMEOUT_MS },
		)
		.catch(() => {})

	for (const selector of YT_SCOPE_SELECTORS) {
		if ((await page.locator(selector).count()) > 0) return selector
	}
	// No known scope (markup change): `readRawVideos` falls back to the whole
	// document rather than returning an empty playlist.
	return YT_SELECTORS.listRenderer
}

/**
 * Incremental scroll until the item count stabilizes (lazy loading), or until
 * the requested limit is reached. `limit === null` = no limit.
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

/** The playlist's title and channel, read from the header. */
async function readPlaylistMetadata(
	page: Page,
): Promise<{ title: string; channel: string }> {
	// The selectors travel as an argument: Node imports don't exist inside
	// page.evaluate, and the regex has to cross as a string because the
	// arguments are serialized to JSON.
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

			// Channel: the first link to a channel inside the playlist header.
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

/** The playlist's items, raw: no derived duration, type or channel. */
async function readRawVideos(
	page: Page,
	scope: string,
): Promise<RawPlaylistVideo[]> {
	return page.evaluate(
		({ sel, channelHref, scope }) => {
			// `resolveScope` already decided the scope in Node; here it's only
			// resolved to an element. If it matches nothing (a YouTube markup
			// change), it falls back to the whole document so the extraction
			// doesn't break.
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
					/* unparseable href */
				}
				// Channel(s): normal videos have an <a> to the channel; in
				// "collaboration" videos (several owner channels) YouTube puts no
				// anchor and instead writes the names as plain text (e.g.
				// "Alan Walker and Au/Ra") in the first metadata row. Both raw
				// signals are captured here; resolveChannelNames (a pure Node
				// function) decides which one to use and how to split them.
				const chanAnchorTexts = Array.from(item.querySelectorAll('a'))
					.filter((a) =>
						channelHrefRe.test(
							(a as HTMLAnchorElement).getAttribute('href') || '',
						),
					)
					.map((a) => (a as HTMLAnchorElement).innerText.trim())
					.filter(Boolean)
				// Each name lives in its own <span> ("Sunnexo" · "and EX-LYD") and
				// the gap between them is CSS, not text: the row's textContent glues
				// them ("Sunnexoand EX-LYD") and there's no "and" left to split on.
				// So the spans are read one by one and joined with a space; if the
				// markup changes and there are no spans, it falls back to the whole
				// row's text.
				const metaRow = item.querySelector(sel.metadataRow)
				const metaParts = Array.from(
					metaRow?.querySelectorAll(sel.metadataText) || [],
				)
					.map((s) => (s.textContent || '').trim())
					.filter(Boolean)
				const metaRowText = (
					metaParts.length > 0
						? metaParts.join(' ')
						: metaRow?.textContent || ''
				)
					.replace(/\s+/g, ' ')
					.trim()
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
// Session
// ---------------------------------------------------------------------------

/**
 * An open scraping session: a Chromium with one live tab, on which several
 * queries can be made. The interactive menu opens just one and reuses it across
 * extractions, so the browser is launched (and the cookie consent dismissed)
 * only once.
 *
 * It's the concrete type of *this* source, not an abstract interface: once the
 * API source exists we'll see which signature they really share. Inventing it
 * today would be designing against an imaginary implementation.
 */
export interface ScrapeSession {
	/** `limit === null` = every video in the playlist. */
	fetchPlaylist(url: string, limit: number | null): Promise<PlaylistPayload>
	/** A video's raw description; the extractor parses it. */
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
				// Playwright doesn't throw on a 4xx/5xx: without this check, a
				// deleted/private playlist "scrapes" fine, finds 0 videos and writes
				// an empty output folder as if everything had gone well.
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
				// Same reason as in fetchPlaylist: a dead video would return an empty
				// description, indistinguishable from a video without a tracklist.
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
		// If something fails after launching Chromium, no orphan process is left:
		// the caller never got the session, so it can't close it.
		await browser?.close()
		throw err
	}
}
