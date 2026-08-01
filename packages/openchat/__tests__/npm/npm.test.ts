import { describe, expect } from 'vitest';
import Config from '@npmcli/config';
import { definitions, shorthands, flatten } from '@npmcli/config/lib/definitions';
import npa from 'npm-package-arg';

describe('npm service', () => {
  it('npm config', async () => {
    const config = new Config({
      npmPath: '',
      cwd: import.meta.dirname,
      definitions,
      flatten,
      shorthands
    });
    await config.load();
    expect(config.flat).toBeTruthy();
  });

  it('npa', () => {
    npa('file://');
  });
});
