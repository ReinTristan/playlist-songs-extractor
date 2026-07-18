import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type ExtractConfig, runExtraction } from '../src/extractor.ts'

function baseConfig(): ExtractConfig {
	return {
		fullUrl: 'https://youtube.com/playlist?list=X',
		maxVideos: Infinity,
		formats: new Set(['json']),
		expandAlbums: false,
		columns: new Set(['position', 'songTitle']),
	}
}

describe('runExtraction validación previa', () => {
	it('rechaza con formats vacío sin abrir el navegador', async () => {
		const config = baseConfig()
		config.formats = new Set()
		await assert.rejects(() => runExtraction(config), /formats/i)
	})
	it('rechaza con columns vacío sin abrir el navegador', async () => {
		const config = baseConfig()
		config.columns = new Set()
		await assert.rejects(() => runExtraction(config), /columns/i)
	})
	it('rechaza con fullUrl vacío sin abrir el navegador', async () => {
		const config = baseConfig()
		config.fullUrl = ''
		await assert.rejects(() => runExtraction(config), /fullUrl/i)
	})
})
