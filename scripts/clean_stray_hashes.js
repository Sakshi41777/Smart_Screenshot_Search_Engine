const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function listFilesWithHashLines() {
  try {
    const out = execSync('git grep -l "^[[:space:]]*[0-9a-f]\{7,40\}[[:space:]]*$"', { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function cleanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const cleaned = content.replace(/^\s*[0-9a-f]{7,40}\s*$/gm, '');
  if (cleaned !== content) {
    fs.writeFileSync(filePath, cleaned, 'utf8');
    return true;
  }
  return false;
}

function main() {
  const files = listFilesWithHashLines();
  console.log('Files to clean:', files.length);
  let modified = 0;
  for (const f of files) {
    try {
      const abs = path.resolve(f);
      if (cleanFile(abs)) {
        console.log('Cleaned', f);
        modified++;
      }
    } catch (e) {
      console.error('Error', f, e.message);
    }
  }
  console.log('Modified files:', modified);
}

main();
