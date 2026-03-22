const fs = require('fs');
const archiver = require('archiver');
const path = require('path');

const outputPath = path.join(__dirname, 'discopy_deploy.zip');
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  console.log(`\n✅ Created discopy_deploy.zip successfully!`);
  console.log(`📦 Size: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nThis file is ready to be uploaded to your Oracle server.`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Add everything except node_modules, downloads, and sensitive/temp files
archive.glob('**/*', {
  ignore: [
    'node_modules/**', 
    'downloads/**', 
    '.env', 
    'discopy_deploy.zip',
    'zip_for_deploy.js',
    'package-lock.json'
  ]
});

archive.finalize();
