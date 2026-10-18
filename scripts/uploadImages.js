require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const dir = path.join(__dirname, 'sample-images');

(async () => {
  try {
    if (!fs.existsSync(dir)) {
      console.error('Directory not found:', dir);
      process.exit(1);
    }
    const files = fs.readdirSync(dir);
    console.log(`Found ${files.length} images to upload...`);

    for (const file of files) {
      const filePath = path.join(dir, file);
      if (!fs.statSync(filePath).isFile()) continue;

      const body = fs.readFileSync(filePath);
      if (body.length > 1024 * 1024) {
        throw new Error(`${file} exceeds 1MB limit (${body.length} bytes)`);
      }

      const contentType = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `listings/${file}`,
        Body: body,
        ContentType: contentType,
      }));
      console.log('Uploaded:', file, '->', `listings/${file}`);
    }

    console.log('All sample images uploaded to S3 successfully!');
  } catch (err) {
    console.error('Upload failed:', err.message);
    process.exit(1);
  }
})();
