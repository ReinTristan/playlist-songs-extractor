import { chromium } from 'playwright'
import {
	CHANNEL_HREF_SOURCE,
	DESKTOP_USER_AGENT,
	PLAYLIST_NAV_TIMEOUT_MS,
	YT_SELECTORS,
} from './types.ts'
import { sleep } from './utils.ts'

const url = process.env.DEBUG_URL ?? ''
const itemIndex = Number(process.env.DEBUG_ITEM_INDEX ?? '0')
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
	locale: 'en-US',
	userAgent: DESKTOP_USER_AGENT,
})
const page = await ctx.newPage()
await page.goto(url, {
	waitUntil: 'domcontentloaded',
	timeout: PLAYLIST_NAV_TIMEOUT_MS,
})
await sleep(4000)
// Scrolls a bit to force the lazy loading of more sections/items,
// the same as the scraper does before reading the DOM.
await page.mouse.wheel(0, 2000)
await sleep(2000)

// The selectors come in as an argument from types.ts: if this script had its
// own copy, it could end up looking at a DOM the scraper no longer uses, which
// is exactly the opposite of what it exists for.
const info = await page.evaluate(
	({ itemIndex, sel, channelHref }) => {
		// YouTube serves at least two UI variants for the same playlist:
		// - "lockup" (new): yt-item-section-renderer > yt-lockup-view-model
		// - Polymer (old): ytd-item-section-renderer > ytd-playlist-video-list-renderer > ytd-playlist-video-renderer
		// In the old variant, the suggestions ("videos to add") can live INSIDE
		// the same ytd-item-section-renderer as the real playlist, as siblings of
		// ytd-playlist-video-list-renderer — so if that list-renderer exists, the
		// scope has to be it instead of the whole section.
		const listRenderer = document.querySelector(sel.listRenderer)
		const section = sel.sectionsByPreference.reduce<Element | null>(
			(found, s) => found ?? document.querySelector(s),
			null,
		)
		const root = listRenderer ?? section ?? document

		const allSections = sel.sectionsByPreference.flatMap((s) => [
			...document.querySelectorAll(s),
		])
		const sectionDiagnostics = allSections.map((sec, i) => {
			const items = sec.querySelectorAll(sel.items)
			return {
				i,
				tag: sec.tagName,
				insideListRenderer: !!sec.closest(sel.listRenderer),
				itemCount: items.length,
				firstTitles: Array.from(items)
					.slice(0, 3)
					.map((el) =>
						(el.querySelector(sel.itemTitleLink)?.textContent || '').trim(),
					),
			}
		})

		const items = root.querySelectorAll(sel.items)
		const item = items[itemIndex] as HTMLElement | null

		const probe = (selector: string) => {
			const el = item?.querySelector(selector) as HTMLElement | null
			return el
				? {
						text: (el.innerText || el.getAttribute('title') || '').slice(0, 70),
						tag: el.tagName,
					}
				: null
		}

		// Channel anchors: there can be 0 (collaboration, no links), 1 (the normal
		// case) or more than one. We no longer assume "the first one".
		const channelHrefRe = new RegExp(channelHref)
		const chanAnchors = Array.from(item?.querySelectorAll('a') || [])
			.filter((a) =>
				channelHrefRe.test((a as HTMLAnchorElement).getAttribute('href') || ''),
			)
			.map((a) => ({
				href: (a as HTMLAnchorElement).getAttribute('href'),
				text: (a as HTMLAnchorElement).innerText.trim(),
			}))

		// Fallback for "collaboration" videos: with no channel anchors, YouTube
		// puts the names as plain text in the first metadata row
		// (e.g. "Alan Walker and Au/Ra") next to an avatar-stack.
		const metaRows = Array.from(item?.querySelectorAll(sel.metadataRow) || [])
		const avatarStack = item?.querySelector('yt-avatar-stack-view-model')

		return {
			hasListRenderer: !!listRenderer,
			sectionDiagnostics,
			title_h: probe(sel.itemTitleLink),
			metaText: probe('.yt-content-metadata-view-model-wiz__metadata-text'),
			metaTextAll: Array.from(
				item?.querySelectorAll(
					'.yt-content-metadata-view-model-wiz__metadata-text',
				) || [],
			).map((r) => (r as HTMLElement).innerText),
			chanAnchors,
			isCollaboration: !!avatarStack,
			collaborationAvatarLabel: avatarStack?.getAttribute('aria-label') ?? null,
			firstMetaRowText: (metaRows[0]?.textContent || '').trim(),
			thumbBadge: probe(sel.durationBadge),
		}
	},
	{ itemIndex, sel: YT_SELECTORS, channelHref: CHANNEL_HREF_SOURCE },
)

console.log(JSON.stringify(info, null, 2))
await browser.close()
