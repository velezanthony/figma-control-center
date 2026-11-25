import { defineDocsSite } from '@velezanthony/design/integration';
import docsConfig from './docs.config.mjs';

export default defineDocsSite(docsConfig, {
  base: '/figma-control-center',
  site: 'https://velezanthony.github.io',
});
