import { mkdir, writeFile } from 'node:fs/promises';
import { fixtureDocx } from '../server/test/fixtures.js';
await mkdir(new URL('../.local/fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../.local/fixtures/synthetic-industry.docx', import.meta.url), await fixtureDocx());
console.log('Created .local/fixtures/synthetic-industry.docx. This is a synthetic test fixture, not the original sample.');
