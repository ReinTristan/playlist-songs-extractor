import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { loadMeta, resolveLocale, supportedLocales } from '../src/i18n.ts'
import { COLUMNS, FORMATS, SONG_ORDERS } from '../src/types.ts'

const LOCALES_DIR = path.join(import.meta.dirname, '..', 'locales')

type Nested = { [key: string]: string | Nested }

function readTranslation(lng: string): Nested {
	return JSON.parse(
		readFileSync(path.join(LOCALES_DIR, lng, 'translation.json'), 'utf8'),
	) as Nested
}

/** "menu.url", "extract.found_one", … para poder comparar sets entre idiomas. */
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
	// Las keys de dominio no cambian con el idioma; lo que cambia es su label.
	// Si se agrega una columna/formato/orden hay que traducirlo en TODOS los
	// idiomas, y esto lo detecta.
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
		// El usuario tiene "es" guardado y pide "--lang=de": el error tiene que
		// leerse en español, no en el fallback.
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
		// Guardado inválido pero sistema válido: gana el sistema.
		assert.deepEqual(resolveLocale({ saved: 'de', system: 'fr' }), {
			locale: 'fr',
		})
	})

	it('ignora fuentes vacías o en blanco', () => {
		assert.equal(resolveLocale({ cli: '   ', system: 'es' }).locale, 'es')
		assert.equal(resolveLocale({ env: '', saved: 'fr' }).locale, 'fr')
	})
})
