const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Returns a short-lived presigned URL (valid for 5 minutes) for a private S3 object key.
 * If S3_MODE is 'mock', returns a local static URL path.
 *
 * @param {string|null} key - e.g. "listings/car1.jpg"
 * @returns {Promise<string|null>}
 */
async function getImageUrl(key) {
  if (!key) return null;

  if (!process.env.S3_BUCKET || process.env.S3_MODE === 'mock') {
    const filename = key.replace(/^listings\//, '');
    return `/static/images/${filename}`;
  }

  try {
    const cmd = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    });
    return await getSignedUrl(s3, cmd, { expiresIn: 300 }); // 5 minutes
  } catch (error) {
    console.error(`Error generating presigned URL for key "${key}":`, error.message);
    return null;
  }
}

module.exports = { getImageUrl };
