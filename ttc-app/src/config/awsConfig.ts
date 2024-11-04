// src/config/awsConfig.ts

import AWS from 'aws-sdk';
import dotenv from 'dotenv';

dotenv.config();

const awsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, // Set in .env
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // Set in .env
  region: process.env.AWS_REGION, // e.g., 'us-east-1'
};

AWS.config.update(awsConfig);

const s3 = new AWS.S3();

export default s3;