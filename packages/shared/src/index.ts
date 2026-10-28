export const APP_NAME = 'Nexus';
export const API_PREFIX = '/api/v1';

/** Upload allow-list (SOT §8), mapped to the stored file extension. Server enforces; UI uses it for pickers. */
export const UPLOAD_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf',
};
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).join(',');
export const IMAGE_ACCEPT = Object.keys(UPLOAD_TYPES).filter((t) => t.startsWith('image/')).join(',');

export * from './permissions';
export * from './types';
