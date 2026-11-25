import { defineDocsConfig, MissingTranslation, NavIcon } from '@velezanthony/design/integration';

const REPO = 'https://github.com/velezanthony/figma-control-center';

export default defineDocsConfig({
  site: {
    name: 'Figma Control Center',
    favicon: 'favicon.svg',
    social: { github: REPO },
    footer: {
      license: { label: 'MIT', href: `${REPO}/blob/main/LICENSE` },
      author: { name: 'Anthony Velez Tapia', href: 'https://velezanthony.github.io/' },
    },
    seo: {
      titleSuffix: 'Figma Control Center',
      image: {
        src: '/og.png',
        alt: {
          en: 'Figma Control Center logo next to the tagline: a local MCP server that runs Plugin API scripts from disk',
          es: 'Logo de Figma Control Center junto al lema: un servidor MCP local que ejecuta scripts del API de plugins desde disco',
        },
      },
      ogLocales: { en: 'en_GB', es: 'es_ES' },
      schema: [
        {
          '@type': 'SoftwareSourceCode',
          name: 'Figma Control Center',
          description: 'A local MCP server that lets Claude Code read and edit Figma files by running Plugin API scripts from disk.',
          url: 'https://velezanthony.github.io/figma-control-center/',
          codeRepository: REPO,
          programmingLanguage: ['TypeScript', 'Svelte'],
          runtimePlatform: 'Node.js >= 24',
          license: 'https://opensource.org/licenses/MIT',
          sameAs: [REPO],
          author: {
            '@type': 'Person',
            '@id': 'https://velezanthony.github.io/#anthony',
            name: 'Anthony Velez Tapia',
            url: 'https://velezanthony.github.io/',
          },
        },
      ],
      description: {
        en: 'A local MCP server that lets Claude Code read and edit Figma files by running Plugin API scripts from disk, over Chrome DevTools Protocol.',
        es: 'Un servidor MCP local que deja a Claude Code leer y editar archivos de Figma ejecutando scripts del API de plugins desde disco, por Chrome DevTools Protocol.',
      },
    },
  },
  i18n: { locales: ['en', 'es'], missing: MissingTranslation.FALLBACK },
  content: {
    dir: '../docs',
    editUrl: `${REPO}/edit/main`,
    nav: [
      {
        label: { en: 'For users', es: 'Para usuarios' },
        dir: 'users',
        sidebar: [
          'users/installation',
          'users/claude-code',
          'users/configuration',
          'users/tools',
          'users/kit',
          'users/workflows',
          'users/contracts',
          'users/dashboard',
          'users/limitations',
        ],
      },
      {
        label: { en: 'For contributors', es: 'Para quien contribuye' },
        dir: 'contributors',
        sidebar: [
          'contributors',
          'contributors/development',
          'contributors/architecture',
          'contributors/extending',
          'contributors/testing',
          'contributors/conventions',
        ],
      },
      { label: 'GitHub', href: REPO, icon: NavIcon.GITHUB },
    ],
  },
});
