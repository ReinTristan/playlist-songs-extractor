import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { stripVTControlCharacters } from 'node:util'
import { MULTISELECT_INSTRUCTIONS, SELECT_INSTRUCTIONS } from '@clack/prompts'
import {
	initI18n,
	loadMeta,
	resolveLocale,
	supportedLocales,
} from '../src/i18n.ts'
import {
	COLUMNS,
	EXTRACTION_GROUPS,
	FORMATS,
	SONG_ORDERS,
} from '../src/types.ts'

const LOCALES_DIR = path.join(import.meta.dirname, '..', 'locales')

type Nested = { [key: string]: string | Nested }

function readTranslation(lng: string): Nested {
	return JSON.parse(
		readFileSync(path.join(LOCALES_DIR, lng, 'translation.json'), 'utf8'),
	) as Nested
}

/** "menu.url", "extract.found_one", … so the sets can be compared across languages. */
function flattenKeys(obj: Nested, prefix = ''): string[] {
	return Object.entries(obj).flatMap(([k, v]) => {
		const full = prefix ? `${prefix}.${k}` : k
		return typeof v === 'string' ? [full] : flattenKeys(v, full)
	})
}

const languages = supportedLocales()
const { fallbackLng } = loadMeta()

describe('locales: catálogo y carpetas', () => {
	it('cada idioma de meta.json tiene su carpeta, y viceversa', () => {
		const folders = readdirSync(LOCALES_DIR, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort()
		assert.deepEqual(folders, [...languages].sort())
	})

	it('el fallback está entre los idiomas soportados', () => {
		assert.ok(languages.includes(fallbackLng))
	})

	it('cada idioma trae nombre nativo y los textos del primer arranque', () => {
		for (const lang of loadMeta().languages) {
			assert.ok(lang.nativeName.length > 0, `${lang.code}: nativeName vacío`)
			assert.ok(
				lang.firstRun.detected.length > 0,
				`${lang.code}: firstRun.detected vacío`,
			)
			assert.ok(
				lang.firstRun.choose.length > 0,
				`${lang.code}: firstRun.choose vacío`,
			)
			// Clack ships "Yes"/"No" in English: the first prompt needs them in the
			// detected language, before loading any translation.json.
			assert.ok(
				lang.firstRun.yes?.length > 0,
				`${lang.code}: firstRun.yes vacío`,
			)
			assert.ok(lang.firstRun.no?.length > 0, `${lang.code}: firstRun.no vacío`)
		}
	})
})

describe('locales: paridad de keys', () => {
	const reference = flattenKeys(readTranslation(fallbackLng)).sort()

	for (const lng of languages.filter((l) => l !== fallbackLng)) {
		it(`"${lng}" tiene exactamente las mismas keys que "${fallbackLng}"`, () => {
			const keys = flattenKeys(readTranslation(lng)).sort()
			const missing = reference.filter((k) => !keys.includes(k))
			const extra = keys.filter((k) => !reference.includes(k))
			assert.deepEqual(missing, [], `faltan en ${lng}`)
			assert.deepEqual(extra, [], `sobran en ${lng}`)
		})
	}

	it('ningún valor traducido queda vacío', () => {
		for (const lng of languages) {
			const flat = readTranslation(lng)
			for (const key of flattenKeys(flat)) {
				const value = key
					.split('.')
					.reduce<string | Nested>((acc, part) => (acc as Nested)[part], flat)
				assert.ok(String(value).length > 0, `${lng}: "${key}" vacío`)
			}
		}
	})
})

describe('locales: cobertura de las constantes de dominio', () => {
	// Domain keys don't change with the language; what changes is their label.
	// Adding a column/format/order means translating it in EVERY language, and
	// this catches it.
	for (const lng of languages) {
		it(`"${lng}" traduce todas las columnas, formatos y órdenes`, () => {
			const flat = readTranslation(lng)
			const columns = flat.columns as Nested
			const formats = flat.formats as Nested
			const songOrders = flat.songOrders as Nested

			for (const col of COLUMNS) {
				assert.ok(columns[col.key], `${lng}: falta columns.${col.key}`)
			}
			for (const format of FORMATS) {
				assert.ok(formats[format], `${lng}: falta formats.${format}`)
			}
			for (const order of SONG_ORDERS) {
				assert.ok(songOrders[order], `${lng}: falta songOrders.${order}`)
			}
		})

		it(`"${lng}" traduce todos los grupos y opciones de extracción`, () => {
			const menu = readTranslation(lng).menu as Nested
			const groups = menu.groups as Nested

			for (const group of EXTRACTION_GROUPS) {
				assert.ok(groups[group.key], `${lng}: falta menu.groups.${group.key}`)
				for (const option of group.options) {
					assert.ok(menu[option], `${lng}: falta menu.${option}`)
				}
			}
		})
	}
})

describe('resolveLocale', () => {
	it('respeta la precedencia --lang > env > conf > sistema', () => {
		assert.equal(
			resolveLocale({ cli: 'fr', env: 'es', saved: 'en', system: 'es' }).locale,
			'fr',
		)
		assert.equal(
			resolveLocale({ env: 'es', saved: 'en', system: 'fr' }).locale,
			'es',
		)
		assert.equal(resolveLocale({ saved: 'en', system: 'fr' }).locale, 'en')
		assert.equal(resolveLocale({ system: 'fr' }).locale, 'fr')
	})

	it('sin ninguna fuente cae al fallback', () => {
		assert.deepEqual(resolveLocale({}), { locale: fallbackLng })
	})

	it('normaliza regiones ("es-AR", "fr_FR")', () => {
		assert.equal(resolveLocale({ system: 'es-AR' }).locale, 'es')
		assert.equal(resolveLocale({ system: 'fr_FR' }).locale, 'fr')
		assert.equal(resolveLocale({ cli: 'ES' }).locale, 'es')
	})

	it('marca como inválido un idioma pedido explícitamente que no existe', () => {
		assert.deepEqual(resolveLocale({ cli: 'de' }), {
			locale: fallbackLng,
			invalid: 'de',
		})
	})

	it('con un idioma inválido igual resuelve el mejor locale para mostrar el error', () => {
		// The user has "es" saved and asks for "--lang=de": the error has to read
		// in Spanish, not in the fallback.
		assert.deepEqual(resolveLocale({ cli: 'de', saved: 'es' }), {
			locale: 'es',
			invalid: 'de',
		})
		assert.deepEqual(resolveLocale({ cli: 'de', env: 'fr' }), {
			locale: 'fr',
			invalid: 'de',
		})
	})

	it('un locale guardado o de sistema no soportado cae al fallback sin error', () => {
		assert.deepEqual(resolveLocale({ saved: 'de', system: 'jp' }), {
			locale: fallbackLng,
		})
		// Invalid saved locale but valid system one: the system wins.
		assert.deepEqual(resolveLocale({ saved: 'de', system: 'fr' }), {
			locale: 'fr',
		})
	})

	it('ignora fuentes vacías o en blanco', () => {
		assert.equal(resolveLocale({ cli: '   ', system: 'es' }).locale, 'es')
		assert.equal(resolveLocale({ env: '', saved: 'fr' }).locale, 'fr')
	})
})

describe('localizeClack', () => {
	const footer = (lines: string[]) => lines.map(stripVTControlCharacters)

	it('en inglés deja el mismo texto que trae clack', async () => {
		await initI18n('en')
		assert.deepEqual(footer(SELECT_INSTRUCTIONS), [
			'↑/↓ to navigate',
			'Enter: confirm',
		])
		assert.deepEqual(footer(MULTISELECT_INSTRUCTIONS), [
			'↑/↓ to navigate',
			'Space: select',
			'Enter: confirm',
		])
	})

	it('cambiar de idioma reescribe los footers en el lugar', async () => {
		await initI18n('es')
		assert.deepEqual(footer(SELECT_INSTRUCTIONS), [
			'↑/↓ para moverte',
			'Enter: confirmar',
		])
		await initI18n('fr')
		assert.deepEqual(footer(MULTISELECT_INSTRUCTIONS), [
			'↑/↓ pour naviguer',
			'Espace : cocher',
			'Entrée : valider',
		])
	})
})
