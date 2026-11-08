/**
 * Interactive menu of the YouTube playlist extractor.
 *
 * Exposes `interactiveMenu` (a short main menu with "Extract" first and two
 * submenus: "Extraction options", what changes the result, and "Settings", how
 * the program behaves; after an extraction it goes back to the menu keeping the
 * config, to process several playlists in a row), `promptFirstRunLocale` (the
 * first-run language question) and `defaultConfig`. It also exports the pure
 * functions that build each menu's options, so they can be tested. The entry
 * point and the non-interactive quick mode live in `src/index.ts`.
 *
 * All visible text comes from `t()`: the options are built inside the menu
 * loop, so switching the language shows up on the next render.
 */

import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	getRecentUrls,
	getSavedConfig,
	pushRecentUrl,
	setSavedConfig,
} from './config.ts'
import { runExtraction } from './extractor.ts'
import {
	changeLocale,
	columnHeader,
	currentLocale,
	formatLabel,
	languageName,
	loadMeta,
	songOrderLabel,
	t,
	videoTypeLabel,
} from './i18n.ts'
import { openScrapeSession, type ScrapeSession } from './sources/scrape.ts'
import {
	COLUMNS,
	EXTRACTION_GROUPS,
	type ExtractConfig,
	type ExtractionOption,
	FORMATS,
	LONG_VIDEO_SECONDS,
	SONG_ORDERS,
	type Song,
	VIDEO_TYPES,
} from './types.ts'
import { normalizeUrl, parsePositiveInt } from './utils.ts'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Default config: every format, every column, no limit, with whatever was
 * saved from the last run on top.
 *
 * It's the only place where the persisted config is read: `index.ts`'s quick
 * mode starts from here, so it inherits the preference with no extra code.
 */
function defaultConfig(): ExtractConfig {
	// `formats` is pulled out from the rest: it's persisted as an array (a Set
	// doesn't survive the store's JSON), so if it travelled inside the spread it
	// would leave a Format[] where a Set goes.
	const { formats, ...saved } = getSavedConfig()
	return {
		fullUrl: '',
		allVideos: true,
		maxVideos: 50, // initial value of the input when "set a number" is chosen
		expandAlbums: true,
		columns: COLUMNS.map((c) => c.key),
		songOrder: 'original',
		excludeUnavailable: false,
		longVideoSeconds: LONG_VIDEO_SECONDS,
		dedupe: false,
		videoTypeFilter: null,
		genreFilter: null,
		...saved,
		formats: new Set(formats ?? FORMATS),
	}
}

const maxLabel = (config: ExtractConfig): string =>
	config.allVideos ? t('prompts.maxAll') : String(config.maxVideos)

// ---------------------------------------------------------------------------
// Each option's editor (they mutate `config` in place and return
// Promise<void>; if the user cancels, they leave the value as it was and go
// back to the menu)
// ---------------------------------------------------------------------------

async function editUrl(config: ExtractConfig): Promise<void> {
	// With history, picking is offered first: retyping a playlist URL by hand
	// is exactly the most tedious part of the menu.
	const recent = getRecentUrls()
	if (recent.length > 0) {
		const picked = await p.select({
			message: t('prompts.urlPick'),
			options: [
				...recent.map((u) => ({ value: u, label: u })),
				{ value: '__new', label: t('prompts.urlNew') },
			],
		})
		if (p.isCancel(picked)) return
		if (picked !== '__new') {
			config.fullUrl = normalizeUrl(picked)
			return
		}
	}
	const raw = await p.text({
		message: t('prompts.url'),
		placeholder: t('prompts.urlPlaceholder'),
		initialValue: config.fullUrl,
		validate: (v) => (v?.trim() ? undefined : t('prompts.urlInvalid')),
	})
	if (!p.isCancel(raw)) config.fullUrl = normalizeUrl(raw)
}

/**
 * The limit is a choice (all / a number), not a text input: that way "all" is
 * the `allVideos` boolean and not a word that would have to be compared in
 * every language.
 */
async function editMax(config: ExtractConfig): Promise<void> {
	const mode = await p.select({
		message: t('prompts.maxMode'),
		options: [
			{ value: 'all', label: t('prompts.maxAll') },
			{ value: 'custom', label: t('prompts.maxCustom') },
		],
		initialValue: config.allVideos ? 'all' : 'custom',
	})
	if (p.isCancel(mode)) return
	if (mode === 'all') {
		config.allVideos = true
		return
	}
	const raw = await p.text({
		message: t('prompts.maxNumber'),
		initialValue: String(config.maxVideos),
		validate: (v) =>
			parsePositiveInt(v) === null ? t('prompts.maxInvalid') : undefined,
	})
	if (p.isCancel(raw)) return
	const parsed = parsePositiveInt(raw)
	if (parsed !== null) {
		config.maxVideos = parsed
		config.allVideos = false
	}
}

async function editFormats(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: t('prompts.formats'),
		options: FORMATS.map((f) => ({ value: f, label: formatLabel(f) })),
		initialValues: [...config.formats],
		required: true,
	})
	if (!p.isCancel(sel)) config.formats = new Set(sel)
}

/**
 * `p.confirm` with translated Yes/No: clack ships "Yes"/"No" hardcoded in
 * English and only lets you change them per call (`active`/`inactive`), not
 * globally.
 */
const confirm = (message: string, initialValue: boolean) =>
	p.confirm({
		message,
		initialValue,
		active: t('prompts.yes'),
		inactive: t('prompts.no'),
	})

async function editExpand(config: ExtractConfig): Promise<void> {
	const v = await confirm(t('prompts.expand'), config.expandAlbums)
	if (!p.isCancel(v)) config.expandAlbums = v
}

async function editColumns(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: t('prompts.columns'),
		options: COLUMNS.map((c) => ({ value: c.key, label: columnHeader(c.key) })),
		initialValues: [...config.columns],
		required: true,
	})
	if (p.isCancel(sel)) return
	// Keeps the custom order of the columns that are still selected and appends
	// (in canonical order) the ones that were just checked.
	const selSet = new Set(sel)
	const kept = config.columns.filter((k) => selSet.has(k))
	const added = sel.filter((k) => !kept.includes(k))
	config.columns = [...kept, ...added]
}

async function editColumnOrder(config: ExtractConfig): Promise<void> {
	const order = [...config.columns]

	while (true) {
		const choice = await p.select({
			message: t('prompts.columnOrder'),
			options: [
				...order.map((k, i) => ({
					value: k,
					label: `${i + 1}. ${columnHeader(k)}`,
				})),
				{ value: '__done', label: pc.green(t('prompts.columnOrderDone')) },
			],
		})
		if (p.isCancel(choice) || choice === '__done') break

		const idx = order.indexOf(choice as keyof Song)
		const dir = await p.select({
			message: t('prompts.columnMove', {
				column: columnHeader(choice as keyof Song),
			}),
			options: [
				{ value: 'up', label: t('prompts.moveUp') },
				{ value: 'down', label: t('prompts.moveDown') },
				{ value: 'cancel', label: t('prompts.cancel') },
			],
		})
		if (p.isCancel(dir) || dir === 'cancel') continue
		if (dir === 'up' && idx > 0) {
			;[order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]
		}
		if (dir === 'down' && idx < order.length - 1) {
			;[order[idx + 1], order[idx]] = [order[idx], order[idx + 1]]
		}
	}
	config.columns = order
}

async function editSongOrder(config: ExtractConfig): Promise<void> {
	const v = await p.select({
		message: t('prompts.songOrder'),
		options: SONG_ORDERS.map((o) => ({ value: o, label: songOrderLabel(o) })),
		initialValue: config.songOrder,
	})
	if (!p.isCancel(v)) config.songOrder = v
}

async function editExcludeUnavailable(config: ExtractConfig): Promise<void> {
	const v = await confirm(
		t('prompts.excludeUnavailable'),
		config.excludeUnavailable,
	)
	if (!p.isCancel(v)) config.excludeUnavailable = v
}

async function editDedupe(config: ExtractConfig): Promise<void> {
	const v = await confirm(t('prompts.dedupe'), config.dedupe)
	if (!p.isCancel(v)) config.dedupe = v
}

/**
 * "Long video" threshold. It's asked in minutes (which is how people think of
 * it) and stored in seconds, which is what `classifyVideoType` compares.
 */
async function editLongVideoMinutes(config: ExtractConfig): Promise<void> {
	const raw = await p.text({
		message: t('prompts.longVideoMinutes'),
		initialValue: String(Math.round(config.longVideoSeconds / 60)),
		validate: (v) =>
			parsePositiveInt(v) === null ? t('prompts.maxInvalid') : undefined,
	})
	if (p.isCancel(raw)) return
	const minutes = parsePositiveInt(raw)
	if (minutes !== null) config.longVideoSeconds = minutes * 60
}

/** Video type filter. Picking all of them is the same as not filtering (`null`). */
async function editVideoTypeFilter(config: ExtractConfig): Promise<void> {
	const sel = await p.multiselect({
		message: t('prompts.videoTypeFilter'),
		options: VIDEO_TYPES.map((v) => ({ value: v, label: videoTypeLabel(v) })),
		initialValues: config.videoTypeFilter ?? [...VIDEO_TYPES],
		required: true,
	})
	if (p.isCancel(sel)) return
	config.videoTypeFilter = sel.length === VIDEO_TYPES.length ? null : sel
}

/**
 * Genre filter: free comma-separated text, not a closed list.
 * `GENRE_KEYWORDS` is the *detection* whitelist, but what matters here is what
 * ended up in the data, and clearing the field means "no filter".
 */
async function editGenreFilter(config: ExtractConfig): Promise<void> {
	const raw = await p.text({
		message: t('prompts.genreFilter'),
		placeholder: t('prompts.genreFilterPlaceholder'),
		initialValue: config.genreFilter?.join(', ') ?? '',
	})
	if (p.isCancel(raw)) return
	const genres = raw
		.split(',')
		.map((g) => g.trim())
		.filter(Boolean)
	config.genreFilter = genres.length > 0 ? genres : null
}

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

/**
 * First-run question. It's built **only from `locales/meta.json`** (which has
 * the native name, the two sentences and the Yes/No in each language), so no
 * `translation.json` has to be loaded before the user chooses. Returns the
 * chosen code; on cancel, keeps the detected one.
 */
async function promptFirstRunLocale(detected: string): Promise<string> {
	const { languages } = loadMeta()
	const meta = languages.find((l) => l.code === detected) ?? languages[0]

	const keep = await p.confirm({
		message: meta.firstRun.detected,
		active: meta.firstRun.yes,
		inactive: meta.firstRun.no,
	})
	if (p.isCancel(keep)) return meta.code
	if (keep) return meta.code

	const chosen = await p.select({
		message: meta.firstRun.choose,
		options: languages.map((l) => ({ value: l.code, label: l.nativeName })),
		initialValue: meta.code,
	})
	return p.isCancel(chosen) ? meta.code : chosen
}

/** Language change from the menu: applied on the fly and persisted. */
async function editLanguage(): Promise<void> {
	const { languages } = loadMeta()
	const chosen = await p.select({
		message: t('prompts.language'),
		options: languages.map((l) => ({ value: l.code, label: l.nativeName })),
		initialValue: currentLocale(),
	})
	if (p.isCancel(chosen)) return
	await changeLocale(chosen)
	p.log.success(t('firstRun.saved', { language: languageName(chosen) }))
}

// ---------------------------------------------------------------------------
// Each menu's options (pure functions: config → options)
// ---------------------------------------------------------------------------

interface MenuOption {
	value: string
	label: string
	hint?: string
	disabled?: boolean
}

/** Setting this to `true` is all it takes for History to show up. */
const HISTORY_ENABLED: boolean = false

/** A filter's hint: what was picked, or "no filter" when it's `null`. */
const filterHint = (values: string[] | null): string =>
	values ? values.join(', ') : t('hints.noFilter')

const yesNoHint = (value: boolean): string =>
	value ? t('hints.yes') : t('hints.no')

/** Each option's current value. Being a `Record`, none can be left without a hint. */
const OPTION_HINTS: Record<ExtractionOption, (c: ExtractConfig) => string> = {
	url: (c) => c.fullUrl || t('hints.unset'),
	max: maxLabel,
	formats: (c) => [...c.formats].map(formatLabel).join(', '),
	columns: (c) => `${c.columns.length}/${COLUMNS.length}`,
	columnOrder: (c) => c.columns.map(columnHeader).join(' → '),
	expand: (c) => yesNoHint(c.expandAlbums),
	longVideo: (c) =>
		t('hints.longVideoMinutes', {
			minutes: Math.round(c.longVideoSeconds / 60),
		}),
	songOrder: (c) => songOrderLabel(c.songOrder),
	excludeUnavailable: (c) => yesNoHint(c.excludeUnavailable),
	dedupe: (c) => yesNoHint(c.dedupe),
	videoTypeFilter: (c) =>
		filterHint(c.videoTypeFilter?.map(videoTypeLabel) ?? null),
	genreFilter: (c) => filterHint(c.genreFilter),
}

function mainMenuOptions(
	config: ExtractConfig,
	historyEnabled = HISTORY_ENABLED,
): MenuOption[] {
	return [
		{
			value: 'extract',
			label: pc.bold(pc.green(t('menu.extract'))),
			hint: config.fullUrl || t('hints.noUrl'),
		},
		{ value: 'extractionOptions', label: t('menu.extractionOptions') },
		...(historyEnabled ? [{ value: 'history', label: t('menu.history') }] : []),
		{ value: 'settings', label: t('menu.settings') },
		{ value: 'quit', label: t('menu.quit') },
	]
}

/**
 * One flat list: the groups are disabled rows (the cursor skips them). Clack
 * draws those rows with the same `○` as the others, which is why the name is
 * decorated: otherwise a header barely stands out from an option.
 */
function extractionMenuOptions(config: ExtractConfig): MenuOption[] {
	return [
		...EXTRACTION_GROUPS.flatMap((group): MenuOption[] => [
			{
				value: `group:${group.key}`,
				label: `── ${t(`menu.groups.${group.key}`)} ──`,
				disabled: true,
			},
			...group.options.map((option) => ({
				value: option,
				label: t(`menu.${option}`),
				hint: OPTION_HINTS[option](config),
			})),
		]),
		{ value: 'back', label: t('prompts.back') },
	]
}

function settingsMenuOptions(): MenuOption[] {
	return [
		{
			value: 'language',
			label: t('menu.language'),
			hint: languageName(currentLocale()),
		},
		{ value: 'back', label: t('prompts.back') },
	]
}

// ---------------------------------------------------------------------------
// Submenus
// ---------------------------------------------------------------------------

const EXTRACTION_EDITORS: Record<
	ExtractionOption,
	(config: ExtractConfig) => Promise<void>
> = {
	url: editUrl,
	max: editMax,
	formats: editFormats,
	columns: editColumns,
	columnOrder: editColumnOrder,
	expand: editExpand,
	longVideo: editLongVideoMinutes,
	songOrder: editSongOrder,
	excludeUnavailable: editExcludeUnavailable,
	dedupe: editDedupe,
	videoTypeFilter: editVideoTypeFilter,
	genreFilter: editGenreFilter,
}

async function extractionMenu(config: ExtractConfig): Promise<void> {
	// The cursor stays on the last edited option: with 12 options in one list,
	// jumping back to the top would mean walking down again to change the next.
	let last: string | undefined
	while (true) {
		const action = await p.select({
			message: t('prompts.extractionOptions'),
			options: extractionMenuOptions(config),
			initialValue: last,
		})
		if (p.isCancel(action) || action === 'back') return
		last = action
		await EXTRACTION_EDITORS[action as ExtractionOption](config)
	}
}

async function settingsMenu(): Promise<void> {
	while (true) {
		const action = await p.select({
			message: t('prompts.settings'),
			options: settingsMenuOptions(),
		})
		if (p.isCancel(action) || action === 'back') return
		await editLanguage()
	}
}

// ---------------------------------------------------------------------------
// Main menu
// ---------------------------------------------------------------------------

/**
 * Extracting with no URL asks for it right there instead of sending the user to
 * look for it in a submenu. Returns whether a URL ended up set: on cancel,
 * there's nothing to extract.
 */
async function ensureUrl(
	config: ExtractConfig,
	ask: (config: ExtractConfig) => Promise<void> = editUrl,
): Promise<boolean> {
	if (!config.fullUrl) await ask(config)
	return Boolean(config.fullUrl)
}

async function interactiveMenu(): Promise<void> {
	const config = defaultConfig()
	config.onProgress = (msg) => p.log.step(msg)
	// A single scraping session: opened lazily on the first extraction and
	// closed when leaving the menu, so the browser is launched only once even if
	// several playlists are processed in a row.
	let session: ScrapeSession | null = null
	p.intro(pc.bgCyan(pc.black(t('menu.title'))))

	try {
		while (true) {
			const action = await p.select({
				message: t('menu.prompt'),
				options: mainMenuOptions(config),
			})

			if (p.isCancel(action) || action === 'quit') {
				p.outro(t('menu.bye'))
				return
			}

			switch (action) {
				case 'extractionOptions':
					await extractionMenu(config)
					break
				case 'settings':
					await settingsMenu()
					break
				case 'extract': {
					if (!(await ensureUrl(config))) break
					p.log.step(pc.cyan(t('extract.starting', { url: config.fullUrl })))
					try {
						session ??= await openScrapeSession()
						await runExtraction(config, session)
						// Only after a successful run: there's no point remembering a
						// URL that turned out not to exist. (The config is saved when
						// leaving the menu, in the `finally` below.)
						pushRecentUrl(config.fullUrl)
					} catch (err) {
						p.log.error(
							t('extract.failed', { message: (err as Error).message }),
						)
					}
					break
				}
				default: {
					p.log.warn(t('extract.invalidOption'))
				}
			}
		}
	} finally {
		// The config is persisted when leaving the menu, not only after
		// extracting: tweaking columns or formats and quitting is a preference
		// too, and waiting for a successful extraction meant losing it as soon as
		// someone configured and left. `finally` covers every exit (quit,
		// cancelling with Ctrl+C in a prompt, or an exception).
		setSavedConfig(config)
		await session?.close()
	}
}

export {
	defaultConfig,
	ensureUrl,
	extractionMenuOptions,
	interactiveMenu,
	mainMenuOptions,
	promptFirstRunLocale,
	settingsMenuOptions,
}
