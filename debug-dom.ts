import { chromium } from 'playwright'

const url =
	'https://www.youtube.com/playlist?list=PLRBp0Fe2GpgnIh0AiYKh7o7HnYAej-5ph'
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
	locale: 'en-US',
	userAgent:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
})
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await new Promise((r) => setTimeout(r, 4000))

const info = await page.evaluate(() => {
	const item = document.querySelectorAll(
		'yt-lockup-view-model',
	)[1] as HTMLElement | null
	const probe = (sel: string) => {
		const el = item?.querySelector(sel) as HTMLElement | null
		return el
			? {
					text: (el.innerText || el.getAttribute('title') || '').slice(0, 70),
					tag: el.tagName,
				}
			: null
	}
	const chanAnchor = Array.from(item?.querySelectorAll('a') || []).find((a) =>
		/\/(@|channel\/|c\/|user\/)/.test(
			(a as HTMLAnchorElement).getAttribute('href') || '',
		),
	) as HTMLAnchorElement | undefined
	return {
		title_h: probe('h3 a'),
		metaText: probe('.yt-content-metadata-view-model-wiz__metadata-text'),
		metaTextAll: Array.from(
			item?.querySelectorAll(
				'.yt-content-metadata-view-model-wiz__metadata-text',
			) || [],
		).map((r) => (r as HTMLElement).innerText),
		chanHref: chanAnchor?.getAttribute('href'),
		chanText: chanAnchor?.innerText,
		thumbBadge: probe('yt-thumbnail-badge-view-model'),
	}
})

console.log(JSON.stringify(info, null, 2))
await browser.close()
