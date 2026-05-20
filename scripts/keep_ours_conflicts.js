const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function listFilesWithMarkers() {
  try {
    const out = execSync('git grep -l "^<<<<<<< \\|^=======\\|^>>>>>>>"', { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function keepOursInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('<<<<<<<')) return false;
  let changed = false;
  while (content.indexOf('<<<<<<< HEAD') !== -1) {
    const a = content.indexOf('<<<<<<< HEAD');
    const mid = content.indexOf('=======', a);
    const b = content.indexOf('>>>>>>>', mid);
    if (a === -1 || mid === -1 || b === -1) break;
    const headPart = content.substring(a + '<<<<<<< HEAD'.length, mid);
    // remove a possible leading newline
    let replacement = headPart.replace(/^\r?\n/, '');
    content = content.substring(0, a) + replacement + content.substring(b + ('>>>>>>>'.length));
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return changed;
}

function main() {
  const files = listFilesWithMarkers();
  if (files.length === 0) {
    console.log('No files with conflict markers found.');
    return;
  }
  console.log('Files with conflict markers:', files.length);
  let modified = 0;
  for (const f of files) {
    try {
      const absolute = path.resolve(f);
      const ok = keepOursInFile(absolute);
      if (ok) {
        console.log('Kept ours for', f);
        modified++;
      } else {
        console.log('No changes needed for', f);
      }
    } catch (e) {
      console.error('Error processing', f, e.message);
    }
  }
  console.log('Modified files:', modified);
}

main();
