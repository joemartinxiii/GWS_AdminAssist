import fs from 'fs';
import path from 'path';

/**
 * Durable persistence for the org-wide signature template.
 *
 * Cloud Run's filesystem is ephemeral, so a template written to local disk is
 * lost on every redeploy or scale event. When `SIGNATURE_TEMPLATE_BUCKET` is
 * configured, the template is stored as an object in Google Cloud Storage so it
 * survives restarts. Local disk is used as a fallback for development (and when
 * no bucket is configured), preserving the previous behavior.
 */
export interface SignatureTemplate {
  html: string;
  updatedAt: string | null;
}

const EMPTY_TEMPLATE: SignatureTemplate = { html: '', updatedAt: null };

const BUCKET_NAME = process.env.SIGNATURE_TEMPLATE_BUCKET || '';
const OBJECT_NAME = process.env.SIGNATURE_TEMPLATE_OBJECT || 'signature-template.json';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TEMPLATE_FILE = path.join(DATA_DIR, 'signature-template.json');

// Lazily created GCS client so environments without the bucket configured never
// need the dependency initialized.
let storageBucket: any = null;
async function getBucket(): Promise<any | null> {
  if (!BUCKET_NAME) return null;
  if (!storageBucket) {
    const { Storage } = await import('@google-cloud/storage');
    storageBucket = new Storage().bucket(BUCKET_NAME);
  }
  return storageBucket;
}

function parseTemplate(raw: string): SignatureTemplate {
  try {
    const parsed = JSON.parse(raw) as Partial<SignatureTemplate>;
    return { html: typeof parsed.html === 'string' ? parsed.html : '', updatedAt: parsed.updatedAt ?? null };
  } catch {
    return { ...EMPTY_TEMPLATE };
  }
}

export async function loadSignatureTemplate(): Promise<SignatureTemplate> {
  const bucket = await getBucket();
  if (bucket) {
    try {
      const file = bucket.file(OBJECT_NAME);
      const [exists] = await file.exists();
      if (!exists) return { ...EMPTY_TEMPLATE };
      const [contents] = await file.download();
      return parseTemplate(contents.toString('utf-8'));
    } catch (error) {
      console.error('[signature-template] GCS load failed:', error);
      throw error;
    }
  }

  // Local disk fallback (development / no bucket configured)
  try {
    return parseTemplate(fs.readFileSync(TEMPLATE_FILE, 'utf-8'));
  } catch {
    return { ...EMPTY_TEMPLATE };
  }
}

export async function saveSignatureTemplate(template: SignatureTemplate): Promise<void> {
  const payload = JSON.stringify(template, null, 2);

  const bucket = await getBucket();
  if (bucket) {
    await bucket.file(OBJECT_NAME).save(payload, {
      contentType: 'application/json',
      resumable: false,
    });
    return;
  }

  // Local disk fallback
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TEMPLATE_FILE, payload, 'utf-8');
}
