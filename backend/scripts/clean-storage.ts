import fs from 'node:fs';
import path from 'node:path';

const keepIds = [
  '02120360-1252-4a14-8656-26a12c9daab5',
  '99a8d06d-0f92-4479-8ace-ec06b5601f57',
  'ff60897b-59bf-43a9-af9a-be9ae986064a',
  'a2f16c4d-296e-425f-b72e-bd893c398a86'
];

const dataDir = path.resolve(__dirname, '..', 'storage', 'data');
const uploadsDir = path.resolve(__dirname, '..', 'storage', 'uploads');

if (fs.existsSync(dataDir)) {
  for (const f of fs.readdirSync(dataDir)) {
    const id = f.split('.')[0] || '';
    if (!keepIds.includes(id)) {
      fs.unlinkSync(path.join(dataDir, f));
      console.log('Removed obsolete file:', f);
    }
  }
}

if (fs.existsSync(uploadsDir)) {
  for (const f of fs.readdirSync(uploadsDir)) {
    const id = f.split('.')[0] || '';
    if (!keepIds.includes(id)) {
      fs.unlinkSync(path.join(uploadsDir, f));
      console.log('Removed obsolete upload:', f);
    }
  }
}

console.log('All mock, obsolete, and duplicate documents removed cleanly!');
