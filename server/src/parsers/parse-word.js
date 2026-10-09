import mammoth from 'mammoth';
import { AppError } from '../errors.js';
import { parseTables } from './tables.js';

export async function parseWord(buffer) {
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      { externalFileAccess: false, convertImage: mammoth.images.imgElement(() => ({ src: '' })) }
    );
    return parseTables(result.value);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'EXTRACTION_FAILED', 'Cannot read this Word document. It may be damaged, encrypted, or unsupported.');
  }
}
