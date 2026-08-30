declare global {
  const OPENCHAT_VERSION: string;
  const OPENCHAT_CHANNEL: string;
}

export const InstallationVersion =
  typeof OPENCHAT_VERSION === 'string' ? OPENCHAT_VERSION : 'local';
export const InstallationChannel =
  typeof OPENCHAT_CHANNEL === 'string' ? OPENCHAT_CHANNEL : 'local';
export const InstallationLocal = InstallationChannel === 'local';
