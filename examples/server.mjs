import {
  HttpClient,
  startServer,
  AnilistMeta,
  GogoanimeProvider,
  GoyabuProvider,
  AllmangaProvider,
  AnimeParadiseProvider,
  AnikotoProvider,
  MegaPlayProvider,
  MangadexProvider,
  WeebcentralProvider,
  MangapillProvider,
} from '../dist/index.js';

const http = new HttpClient({ timeoutMs: 30000 });

// simple cache
const store = new Map();
const cache = {
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
};

startServer({
  providers: [
    new GogoanimeProvider(http),
    new GoyabuProvider(http),
    new AllmangaProvider(http),
    new AnimeParadiseProvider(http),
    new AnikotoProvider(http),
    new MegaPlayProvider(http),
    new MangadexProvider(http),
    new WeebcentralProvider(http),
    new MangapillProvider(http),
  ],
  metaProviders: [new AnilistMeta(http)],
  port: Number(process.env.PORT ?? 3030),
  proxy: true,
  proxySignSecret: process.env.PROXY_SECRET,
  proxyAllowedHosts: (process.env.PROXY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
  cache,
});
