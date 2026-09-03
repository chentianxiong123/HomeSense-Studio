const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'data', 'media', 'cache', 'bilibili');
fs.mkdirSync(root, { recursive: true });

const t1 = '2026-06-18T18:00:00.000Z';
const t2 = '2026-06-18T18:05:00.000Z';

function seed(bvid, playCount, lastPlayedAt, title) {
  const file = path.join(root, `${bvid}.m4s`);
  fs.writeFileSync(file, Buffer.from('FAKEAUDIO'));
  const meta = {
    key: `bilibili:${bvid}`,
    source: 'bilibili',
    bvid,
    file_path: file,
    mime_type: 'audio/mp4',
    title,
    play_count: playCount,
    last_played_at: lastPlayedAt,
    created_at: t1,
    updated_at: t1,
    size: fs.statSync(file).size,
  };
  fs.writeFileSync(path.join(root, `${bvid}.json`), `${JSON.stringify(meta, null, 2)}\n`);
}

seed('BVFAKE000001', 1, t1, 'fake-old-low');
seed('BVFAKE000002', 2, t2, 'fake-mid-high');

console.log('seeded entries:', fs.readdirSync(root).sort());
