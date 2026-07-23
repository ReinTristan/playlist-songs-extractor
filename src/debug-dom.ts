import { chromium } from 'playwright'
import { sleep } from './utils.ts'

const url = process.env.DEBUG_URL ?? ''
const itemIndex = Number(process.env.DEBUG_ITEM_INDEX ?? '0')
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
	locale: 'en-US',
	userAgent:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
})
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(4000)
// Scrollea un poco para forzar la carga perezosa de más secciones/ítems,
// igual que hace scrapePlaylist antes de leer el DOM.
await page.mouse.wheel(0, 2000)
await sleep(2000)

const info = await page.evaluate((itemIndex) => {
	// YouTube sirve al menos dos variantes de UI para la misma playlist:
	// - "lockup" (nueva): yt-item-section-renderer > yt-lockup-view-model
	// - Polymer (vieja): ytd-item-section-renderer > ytd-playlist-video-list-renderer > ytd-playlist-video-renderer
	// En la variante vieja, las sugerencias ("videos para agregar") pueden
	// vivir DENTRO del mismo ytd-item-section-renderer que la playlist real,
	// como hermanas de ytd-playlist-video-list-renderer — por eso, si existe
	// ese list-renderer, hay que escopar ahí en vez de quedarse con la
	// sección completa.
	const listRenderer = document.querySelector(
		'ytd-playlist-video-list-renderer',
	)
	const section =
		document.querySelector('yt-item-section-renderer') ||
		document.querySelector('ytd-item-section-renderer')
	const root = listRenderer ?? section ?? document

	const allSections = [
		...document.querySelectorAll('yt-item-section-renderer'),
		...document.querySelectorAll('ytd-item-section-renderer'),
	]
	const sectionDiagnostics = allSections.map((sec, i) => {
		const items = sec.querySelectorAll(
			'yt-lockup-view-model, ytd-playlist-video-renderer',
		)
		return {
			i,
			tag: sec.tagName,
			insideListRenderer: !!sec.closest('ytd-playlist-video-list-renderer'),
			itemCount: items.length,
			firstTitles: Array.from(items)
				.slice(0, 3)
				.map((el) => (el.querySelector('h3 a')?.textContent || '').trim()),
		}
	})

	const items = root.querySelectorAll(
		'yt-lockup-view-model, ytd-playlist-video-renderer',
	)
	const item = items[itemIndex] as HTMLElement | null

	const probe = (sel: string) => {
		const el = item?.querySelector(sel) as HTMLElement | null
		return el
			? {
					text: (el.innerText || el.getAttribute('title') || '').slice(0, 70),
					tag: el.tagName,
				}
			: null
	}

	// Anchors de canal: puede haber 0 (colaboración, sin links), 1 (caso
	// normal) o más de uno. Ya no asumimos "el primero".
	const chanAnchors = Array.from(item?.querySelectorAll('a') || [])
		.filter((a) =>
			/\/(@|channel\/|c\/|user\/)/.test(
				(a as HTMLAnchorElement).getAttribute('href') || '',
			),
		)
		.map((a) => ({
			href: (a as HTMLAnchorElement).getAttribute('href'),
			text: (a as HTMLAnchorElement).innerText.trim(),
		}))

	// Fallback para videos de "colaboración": sin anchors de canal, YouTube
	// pone los nombres como texto plano en la primera fila de metadata
	// (ej. "Alan Walker and Au/Ra") junto a un avatar-stack.
	const metaRows = Array.from(
		item?.querySelectorAll('.ytContentMetadataViewModelMetadataRow') || [],
	)
	const avatarStack = item?.querySelector('yt-avatar-stack-view-model')

	return {
		hasListRenderer: !!listRenderer,
		sectionDiagnostics,
		title_h: probe('h3 a'),
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
		thumbBadge: probe('yt-thumbnail-badge-view-model'),
	}
}, itemIndex)

console.log(JSON.stringify(info, null, 2))
await browser.close()
