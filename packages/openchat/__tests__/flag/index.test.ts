import { describe, expect } from 'vitest';
import { Flag, setFlag, setEnv } from '@/flag';

describe('flag', () => {
  it('setFlag', () => {
    const r1 = setFlag('TEST_FLAG', 'test');
    // @ts-ignore
    const r2 = setFlag('CONFIG_DIR', 'd://');

    expect(r1).toBeTruthy();
    expect(r2).toBeFalsy();
    expect(process.env['TEST_FLAG']).toBe('test');
    expect(process.env['CONFIG_DIR']).toBe(void 0);
    expect(Flag.CONFIG_DIR).toBe(void 0);
  });

  it('setFlags', () => {
    setEnv({
      CONFIG_DIR: 'test'
    });
    process.env['CONFIG_CONTENT'] = 'hhhhhhhhh';

    expect(Flag.CONFIG_DIR).toBe('test');
    expect(Flag.CONFIG_CONTENT).toBe(void 0);
  });
});
