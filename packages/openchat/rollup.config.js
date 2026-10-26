import { fileURLToPath } from 'url';
import path from 'path';
import pkg from './package.json' with { type: 'json' };
import { genRollupConfig } from '../../scripts/build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default genRollupConfig(pkg, __dirname);
