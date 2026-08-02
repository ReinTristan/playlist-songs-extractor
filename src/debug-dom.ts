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
// Scrollea un poco para forzar la carga perezosa de más secciones/ítems,
// igual que hace scrapePlaylist antes de leer el DOM.
await page.mouse.wheel(0, 2000)
await sleep(2000)

// Los selectores llegan por argumento desde types.ts: si este script tuviera
// su propia copia, podría quedar mirando un DOM que scrapePlaylist ya no usa,
// que es exactamente lo contrario de para lo que existe.
const info = await page.evaluate(
	({ itemIndex, sel, channelHref }) => {
		// YouTube sirve al menos dos variantes de UI para la misma playlist:
		// - "lockup" (nueva): yt-item-section-renderer > yt-lockup-view-model
		// - Polymer (vieja): ytd-item-section-renderer > ytd-playlist-video-list-renderer > ytd-playlist-video-renderer
		// En la variante vieja, las sugerencias ("videos para agregar") pueden
		// vivir DENTRO del mismo ytd-item-section-renderer que la playlist real,
		// como hermanas de ytd-playlist-video-list-renderer — por eso, si existe
		// ese list-renderer, hay que escopar ahí en vez de quedarse con la
		// sección completa.
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

		// Anchors de canal: puede haber 0 (colaboración, sin links), 1 (caso
		// normal) o más de uno. Ya no asumimos "el primero".
		const channelHrefRe = new RegExp(channelHref)
		const chanAnchors = Array.from(item?.querySelectorAll('a') || [])
			.filter((a) =>
				channelHrefRe.test((a as HTMLAnchorElement).getAttribute('href') || ''),
			)
			.map((a) => ({
				href: (a as HTMLAnchorElement).getAttribute('href'),
				text: (a as HTMLAnchorElement).innerText.trim(),
			}))

		// Fallback para videos de "colaboración": sin anchors de canal, YouTube
		// pone los nombres como texto plano en la primera fila de metadata
		// (ej. "Alan Walker and Au/Ra") junto a un avatar-stack.
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
