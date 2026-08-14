import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BaseProvider } from './providers/BaseProvider.js';
import type {
  ContentLanguage,
  IContentUnit,
  ISubtitleTrack,
  IVideoPayload,
  ResolvedMediaStream,
} from './types/index.js';

export interface ProphecyAnime {
  prophecyAnimeId: string;
  anilistId?: number;
  malId?: number;
  title: string;
  englishTitle?: string;
  romajiTitle?: string;
  nativeTitle?: string;
  alternativeTitles: string[];
  description?: string;
  cover?: string;
  banner?: string;
  year?: number;
  season?: string;
  status?: string;
  format?: string;
  genres: string[];
  score?: number;
  ageRating?: string;
  isAdult: boolean;
  totalSeasons?: number;
  totalEpisodes?: number;
  externalMappings: Record<string, string | number>;
  customMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProphecySeason {
  seasonId: string;
  animeId: string;
  seasonNumber: number;
  title: string;
  description?: string;
  poster?: string;
  year?: number;
  status: 'enabled' | 'disabled';
  displayOrder: number;
}

export interface ProphecyEpisode {
  episodeId: string;
  animeId: string;
  seasonId: string;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  title: string;
  /** Provider-native episode identifier, when a provider mapping exists. */
  providerEpisodeId?: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  airDate?: string;
  status: 'enabled' | 'disabled';
  displayOrder: number;
}

export type ProphecyLanguageType = 'audio' | 'subtitle' | 'both';

export interface ProphecyLanguage {
  languageId: string;
  episodeId: string;
  languageCode: string;
  languageName: string;
  type: ProphecyLanguageType;
  isDefault: boolean;
  enabled: boolean;
  priority: number;
}

export interface ProphecyAudio {
  audioId: string;
  episodeId: string;
  languageCode: string;
  languageName: string;
  codec?: string;
  reference?: string;
  isDefault: boolean;
  enabled: boolean;
}

export interface ProphecySubtitle {
  subtitleId: string;
  episodeId: string;
  languageCode: string;
  languageName: string;
  format: 'vtt' | 'srt' | 'ass';
  reference: string;
  isDefault: boolean;
  forced: boolean;
  enabled: boolean;
}

export interface ProphecySource {
  sourceId: string;
  providerId: string;
  episodeId: string;
  languageCode?: string;
  quality: IVideoPayload['quality'];
  type: 'hls' | 'mp4' | 'embed' | 'reference';
  reference?: string;
  headers?: Record<string, string>;
  priority: number;
  enabled: boolean;
  availability: 'unknown' | 'available' | 'unavailable';
}

export interface ProphecyProviderState {
  providerId: string;
  enabled: boolean;
  priority: number;
  health: 'unknown' | 'healthy' | 'degraded' | 'offline';
  updatedAt: string;
}

export interface ProphecyServerAlias {
  serverId: string;
  label: string;
  providerId: string;
  priority: number;
  enabled: boolean;
}

export interface ProphecyPlaybackRequest {
  /** User-facing alias such as server-1; never expose providerId to the client. */
  server?: string;
  /** Existing provider mode: sub, dub or raw. */
  language?: ContentLanguage;
  /** Episode languageId or languageCode selected for audio. */
  audioLanguage?: string;
  audio?: string;
  subtitle?: string;
  quality?: IVideoPayload['quality'];
}

export interface ProphecyApiOptions {
  store: ProphecyStore;
  adminToken?: string;
  /** Internal provider mapping; public responses expose only Server N labels. */
  serverAliases?: ProphecyServerAlias[];
}

export interface ProphecyApiContext extends ProphecyApiOptions {
  providers: BaseProvider[];
  proxyify?: (stream: ResolvedMediaStream) => ResolvedMediaStream;
}

export interface ProphecyApi {
  store: ProphecyStore;
  adminToken?: string;
}

export function createProphecyApi(options: ProphecyApiOptions): ProphecyApi {
  return options;
}

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export class ProphecyStore {
  private readonly anime = new Map<string, ProphecyAnime>();
  private readonly seasons = new Map<string, ProphecySeason>();
  private readonly episodes = new Map<string, ProphecyEpisode>();
  private readonly languages = new Map<string, ProphecyLanguage>();
  private readonly audio = new Map<string, ProphecyAudio>();
  private readonly subtitles = new Map<string, ProphecySubtitle>();
  private readonly sources = new Map<string, ProphecySource>();
  private readonly providers = new Map<string, ProphecyProviderState>();

  listAnime(): ProphecyAnime[] { return [...this.anime.values()].map(clone); }
  getAnime(animeId: string): ProphecyAnime | undefined { return clone(this.anime.get(animeId)); }
  createAnime(input: Partial<ProphecyAnime> & Pick<ProphecyAnime, 'title'>): ProphecyAnime {
    const value: ProphecyAnime = {
      ...input,
      prophecyAnimeId: id('prophecy-anime'),
      title: input.title,
      alternativeTitles: input.alternativeTitles ?? [],
      genres: input.genres ?? [],
      isAdult: input.isAdult ?? false,
      externalMappings: input.externalMappings ?? {},
      customMetadata: input.customMetadata ?? {},
      createdAt: now(),
      updatedAt: now(),
    };
    this.anime.set(value.prophecyAnimeId, value);
    return clone(value);
  }
  updateAnime(animeId: string, patch: Partial<ProphecyAnime>): ProphecyAnime {
    const current = this.require(this.anime, animeId, 'Anime not found');
    const updated = { ...current, ...patch, prophecyAnimeId: animeId, updatedAt: now() };
    this.anime.set(animeId, updated);
    return clone(updated);
  }
  deleteAnime(animeId: string): void {
    this.require(this.anime, animeId, 'Anime not found');
    for (const season of [...this.seasons.values()]) if (season.animeId === animeId) this.deleteSeason(season.seasonId);
    this.anime.delete(animeId);
  }

  resolveAnimeId(reference: string): string | undefined {
    if (this.anime.has(reference)) return reference;
    const match = /^(anilist|mal):(.+)$/.exec(reference);
    return [...this.anime.values()].find((item) => {
      if (match?.[1] === 'anilist' && String(item.anilistId ?? '') === match[2]) return true;
      if (match?.[1] === 'mal' && String(item.malId ?? '') === match[2]) return true;
      const mappings = item.externalMappings ?? {};
      return Object.entries(mappings).some(([key, value]) =>
        (key.toLowerCase() === 'anilist' || key.toLowerCase() === 'anilistid') && match?.[1] === 'anilist' && String(value) === match[2]
        || (key.toLowerCase() === 'mal' || key.toLowerCase() === 'malid') && match?.[1] === 'mal' && String(value) === match[2],
      );
    })?.prophecyAnimeId;
  }
  listSeasons(animeId: string): ProphecySeason[] {
    return [...this.seasons.values()].filter((x) => x.animeId === animeId).sort((a, b) => a.displayOrder - b.displayOrder).map(clone);
  }
  listSeasonsByReference(reference: string): ProphecySeason[] {
    const animeId = this.resolveAnimeId(reference);
    return animeId ? this.listSeasons(animeId) : [];
  }
  listEpisodesByAnime(animeReference: string): ProphecyEpisode[] {
    const animeId = this.resolveAnimeId(animeReference);
    if (!animeId) return [];
    const seasonOrder = new Map(this.listSeasons(animeId).map((season, index) => [season.seasonId, index]));
    return [...this.episodes.values()]
      .filter((episode) => episode.animeId === animeId)
      .sort((a, b) => (seasonOrder.get(a.seasonId) ?? 0) - (seasonOrder.get(b.seasonId) ?? 0) || a.displayOrder - b.displayOrder || a.episodeNumber - b.episodeNumber)
      .map(clone);
  }
  getSeason(seasonId: string): ProphecySeason | undefined { return clone(this.seasons.get(seasonId)); }
  createSeason(animeId: string, input: Partial<ProphecySeason> = {}): ProphecySeason {
    this.require(this.anime, animeId, 'Anime not found');
    const count = this.listSeasons(animeId).length;
    const value: ProphecySeason = { ...input, seasonId: id('season'), animeId, seasonNumber: input.seasonNumber ?? count + 1, title: input.title ?? `Season ${count + 1}`, status: input.status ?? 'enabled', displayOrder: input.displayOrder ?? count };
    this.seasons.set(value.seasonId, value);
    return clone(value);
  }
  updateSeason(seasonId: string, patch: Partial<ProphecySeason>): ProphecySeason { const current = this.require(this.seasons, seasonId, 'Season not found'); const updated = { ...current, ...patch, seasonId, animeId: current.animeId }; this.seasons.set(seasonId, updated); return clone(updated); }
  deleteSeason(seasonId: string): void { this.require(this.seasons, seasonId, 'Season not found'); for (const episode of [...this.episodes.values()]) if (episode.seasonId === seasonId) this.deleteEpisode(episode.episodeId); this.seasons.delete(seasonId); }

  listEpisodes(seasonId: string): ProphecyEpisode[] {
    this.require(this.seasons, seasonId, 'Season not found');
    return [...this.episodes.values()].filter((x) => x.seasonId === seasonId).sort((a, b) => a.displayOrder - b.displayOrder).map(clone);
  }
  getEpisode(episodeId: string): ProphecyEpisode | undefined { return clone(this.episodes.get(episodeId)); }
  createEpisode(seasonId: string, input: Partial<ProphecyEpisode> & Pick<ProphecyEpisode, 'title' | 'episodeNumber'>): ProphecyEpisode {
    const season = this.require(this.seasons, seasonId, 'Season not found');
    const value: ProphecyEpisode = { ...input, episodeId: id('episode'), animeId: season.animeId, seasonId, title: input.title, episodeNumber: input.episodeNumber, status: input.status ?? 'enabled', displayOrder: input.displayOrder ?? this.listEpisodes(seasonId).length };
    this.episodes.set(value.episodeId, value);
    return clone(value);
  }
  updateEpisode(episodeId: string, patch: Partial<ProphecyEpisode>): ProphecyEpisode { const current = this.require(this.episodes, episodeId, 'Episode not found'); const updated = { ...current, ...patch, episodeId, animeId: current.animeId }; this.episodes.set(episodeId, updated); return clone(updated); }
  moveEpisode(episodeId: string, seasonId: string): ProphecyEpisode { const episode = this.require(this.episodes, episodeId, 'Episode not found'); const season = this.require(this.seasons, seasonId, 'Season not found'); return this.updateEpisode(episodeId, { seasonId, animeId: season.animeId }); }
  deleteEpisode(episodeId: string): void { this.require(this.episodes, episodeId, 'Episode not found'); for (const item of [...this.languages.values()]) if (item.episodeId === episodeId) this.languages.delete(item.languageId); for (const item of [...this.audio.values()]) if (item.episodeId === episodeId) this.audio.delete(item.audioId); for (const item of [...this.subtitles.values()]) if (item.episodeId === episodeId) this.subtitles.delete(item.subtitleId); for (const item of [...this.sources.values()]) if (item.episodeId === episodeId) this.sources.delete(item.sourceId); this.episodes.delete(episodeId); }

  listLanguages(episodeId: string, enabledOnly = false): ProphecyLanguage[] {
    this.require(this.episodes, episodeId, 'Episode not found');
    return [...this.languages.values()]
      .filter((item) => item.episodeId === episodeId && (!enabledOnly || item.enabled))
      .sort((a, b) => a.priority - b.priority)
      .map(clone);
  }
  listAudioLanguages(episodeId: string, enabledOnly = true): ProphecyLanguage[] {
    return this.listLanguages(episodeId, enabledOnly).filter((item) => item.type === 'audio' || item.type === 'both');
  }
  selectAudioLanguage(episodeId: string, requested?: string): ProphecyLanguage {
    const available = this.listAudioLanguages(episodeId, true);
    const selected = requested
      ? available.find((item) => item.languageId === requested || item.languageCode.toLowerCase() === requested.toLowerCase())
      : available.find((item) => item.isDefault) ?? available[0];
    if (!selected) throw new ProphecyError(400, 'AUDIO_LANGUAGE_UNAVAILABLE', 'Requested audio language is not enabled for this episode');
    return clone(selected);
  }
  getLanguage(languageId: string): ProphecyLanguage | undefined { return clone(this.languages.get(languageId)); }
  createLanguage(episodeId: string, input: Omit<ProphecyLanguage, 'languageId' | 'episodeId'>): ProphecyLanguage {
    this.require(this.episodes, episodeId, 'Episode not found');
    validateLanguageInput(input);
    const duplicate = [...this.languages.values()].some(
      (item) => item.episodeId === episodeId && item.languageCode === input.languageCode && item.type === input.type,
    );
    if (duplicate) throw new ProphecyError(409, 'DUPLICATE_LANGUAGE', 'This language already exists for the episode and type');
    const value: ProphecyLanguage = { ...input, languageId: id('language'), episodeId };
    if (value.isDefault) this.unsetOverlappingDefaults(value);
    this.languages.set(value.languageId, value);
    return clone(value);
  }
  updateLanguage(languageId: string, patch: Partial<ProphecyLanguage>): ProphecyLanguage {
    const current = this.require(this.languages, languageId, 'Language not found');
    if ('episodeId' in patch) throw new ProphecyError(400, 'EPISODE_ID_IMMUTABLE', 'episodeId cannot be changed');
    const allowed: Array<keyof ProphecyLanguage> = ['languageCode', 'languageName', 'type', 'isDefault', 'enabled', 'priority'];
    if (Object.keys(patch).some((key) => !allowed.includes(key as keyof ProphecyLanguage))) {
      throw new ProphecyError(400, 'INVALID_LANGUAGE_FIELD', 'Only languageCode, languageName, type, isDefault, enabled and priority can be updated');
    }
    validateLanguageInput({ ...current, ...patch });
    const next = { ...current, ...patch, languageId, episodeId: current.episodeId };
    const duplicate = [...this.languages.values()].some(
      (item) => item.languageId !== languageId && item.episodeId === current.episodeId && item.languageCode === next.languageCode && item.type === next.type,
    );
    if (duplicate) throw new ProphecyError(409, 'DUPLICATE_LANGUAGE', 'This language already exists for the episode and type');
    if (next.isDefault) this.unsetOverlappingDefaults(next, languageId);
    this.languages.set(languageId, next);
    return clone(next);
  }
  deleteLanguage(languageId: string): void { this.require(this.languages, languageId, 'Language not found'); this.languages.delete(languageId); }
  private unsetOverlappingDefaults(language: ProphecyLanguage, exceptId?: string): void {
    for (const [itemId, item] of this.languages) {
      if (itemId !== exceptId && item.episodeId === language.episodeId && languageTypesOverlap(item.type, language.type) && item.isDefault) {
        this.languages.set(itemId, { ...item, isDefault: false });
      }
    }
  }

  listAudio(episodeId: string): ProphecyAudio[] { return [...this.audio.values()].filter((x) => x.episodeId === episodeId).map(clone); }
  createAudio(episodeId: string, input: Omit<ProphecyAudio, 'audioId' | 'episodeId'>): ProphecyAudio { this.require(this.episodes, episodeId, 'Episode not found'); const value = { ...input, audioId: id('audio'), episodeId }; this.audio.set(value.audioId, value); return clone(value); }
  updateAudio(audioId: string, patch: Partial<ProphecyAudio>): ProphecyAudio { const current = this.require(this.audio, audioId, 'Audio not found'); const updated = { ...current, ...patch, audioId, episodeId: current.episodeId }; this.audio.set(audioId, updated); return clone(updated); }
  deleteAudio(audioId: string): void { this.audio.delete(audioId); }

  listSubtitles(episodeId: string): ProphecySubtitle[] { return [...this.subtitles.values()].filter((x) => x.episodeId === episodeId).map(clone); }
  createSubtitle(episodeId: string, input: Omit<ProphecySubtitle, 'subtitleId' | 'episodeId'>): ProphecySubtitle { this.require(this.episodes, episodeId, 'Episode not found'); const value = { ...input, subtitleId: id('subtitle'), episodeId }; this.subtitles.set(value.subtitleId, value); return clone(value); }
  updateSubtitle(subtitleId: string, patch: Partial<ProphecySubtitle>): ProphecySubtitle { const current = this.require(this.subtitles, subtitleId, 'Subtitle not found'); const updated = { ...current, ...patch, subtitleId, episodeId: current.episodeId }; this.subtitles.set(subtitleId, updated); return clone(updated); }
  deleteSubtitle(subtitleId: string): void { this.subtitles.delete(subtitleId); }

  listSources(episodeId: string, languageCode?: string): ProphecySource[] { return [...this.sources.values()].filter((x) => x.episodeId === episodeId && x.enabled && (!languageCode || x.languageCode === languageCode)).sort((a, b) => a.priority - b.priority).map(clone); }
  createSource(episodeId: string, input: Omit<ProphecySource, 'sourceId' | 'episodeId'>): ProphecySource { this.require(this.episodes, episodeId, 'Episode not found'); const value = { ...input, sourceId: id('source'), episodeId }; this.sources.set(value.sourceId, value); return clone(value); }
  updateSource(sourceId: string, patch: Partial<ProphecySource>): ProphecySource { const current = this.require(this.sources, sourceId, 'Source not found'); const updated = { ...current, ...patch, sourceId, episodeId: current.episodeId }; this.sources.set(sourceId, updated); return clone(updated); }
  deleteSource(sourceId: string): void { this.sources.delete(sourceId); }

  listProviders(): ProphecyProviderState[] { return [...this.providers.values()].map(clone); }
  setProvider(providerId: string, patch: Partial<ProphecyProviderState>): ProphecyProviderState { const updated: ProphecyProviderState = { providerId, enabled: true, priority: 100, health: 'unknown', ...this.providers.get(providerId), ...patch, updatedAt: now() }; this.providers.set(providerId, updated); return clone(updated); }

  private require<T>(map: Map<string, T>, key: string, message: string): T { const value = map.get(key); if (!value) throw new Error(message); return value; }
}

export class ProphecyError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ProphecyError';
  }
}

function languageTypesOverlap(a: ProphecyLanguageType, b: ProphecyLanguageType): boolean {
  return a === b || a === 'both' || b === 'both';
}

function validateLanguageInput(input: Partial<ProphecyLanguage>): void {
  if (typeof input.languageCode !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(input.languageCode.trim())) {
    throw new ProphecyError(400, 'INVALID_LANGUAGE_CODE', 'languageCode must be 1-32 characters using letters, numbers, _ or -');
  }
  if (typeof input.languageName !== 'string' || input.languageName.trim() === '') {
    throw new ProphecyError(400, 'INVALID_LANGUAGE_NAME', 'languageName is required');
  }
  if (input.type !== 'audio' && input.type !== 'subtitle' && input.type !== 'both') {
    throw new ProphecyError(400, 'INVALID_LANGUAGE_TYPE', 'type must be audio, subtitle or both');
  }
  if (typeof input.priority !== 'number' || !Number.isInteger(input.priority) || input.priority < 0) {
    throw new ProphecyError(400, 'INVALID_LANGUAGE_PRIORITY', 'priority must be a non-negative integer');
  }
  if (typeof input.isDefault !== 'boolean' || typeof input.enabled !== 'boolean') {
    throw new ProphecyError(400, 'INVALID_LANGUAGE_BOOLEAN', 'isDefault and enabled must be booleans');
  }
}

export function checkAdminToken(req: IncomingMessage, expected?: string): boolean {
  if (!expected) return false;
  const header = req.headers.authorization ?? '';
  const actual = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function resolveProphecyPlayback(
  context: ProphecyApiContext,
  episode: ProphecyEpisode,
  request: ProphecyPlaybackRequest,
): Promise<ResolvedMediaStream> {
  const requestedAudio = request.audioLanguage ?? request.audio;
  const selectedAudio = context.store.selectAudioLanguage(episode.episodeId, requestedAudio);
  const selectedServer = request.server ? context.serverAliases?.find((server) => server.serverId === request.server && server.enabled) : undefined;
  if (request.server && !selectedServer) throw new ProphecyError(400, 'SERVER_UNAVAILABLE', 'Requested server is not available for this request');
  const preferredSourceLanguage = requestedAudio ? selectedAudio.languageCode : request.language;
  const primaryCandidates = context.store.listSources(episode.episodeId, preferredSourceLanguage)
    .filter((source) => !selectedServer || source.providerId === selectedServer.providerId);
  const fallbackCandidates = !requestedAudio && primaryCandidates.length === 0
    ? context.store.listSources(episode.episodeId, selectedAudio.languageCode)
      .filter((source) => !selectedServer || source.providerId === selectedServer.providerId)
    : [];
  const candidates = [...primaryCandidates, ...fallbackCandidates].filter((source) => !request.quality || source.quality === request.quality || source.quality === 'auto');
  const providerStates = new Map(context.store.listProviders().map((item) => [item.providerId, item]));
  candidates.sort((a, b) => (providerStates.get(a.providerId)?.priority ?? 100) - (providerStates.get(b.providerId)?.priority ?? 100) || a.priority - b.priority);
  for (const source of candidates) {
    const provider = context.providers.find((item) => item.id === source.providerId);
    if (!provider || providerStates.get(source.providerId)?.enabled === false) continue;
    try {
      const stream = source.reference
        ? await provider.resolveStream(source.reference, request.language)
        : await provider.resolveStream(episode.episodeId, request.language);
      if (stream.type === 'video' && stream.streams.length > 0) return context.proxyify ? context.proxyify(stream) : stream;
    } catch {
      context.store.setProvider(source.providerId, { health: 'degraded' });
    }
  }
  throw new Error('No playable authorized source is available');
}

export function authorizedMutation(req: IncomingMessage, api: ProphecyApi): boolean {
  return checkAdminToken(req, api.adminToken);
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request body must be a JSON object');
  return value as Record<string, unknown>;
}

export function prophecyResponse(res: ServerResponse, status: number, data: unknown, error: unknown = null, meta: Record<string, unknown> = {}, errorCode = 'PROPHECY_ERROR'): void {
  const body = JSON.stringify({ success: status < 400, data: status < 400 ? data : null, error: status < 400 ? null : { code: errorCode, message: error instanceof Error ? error.message : String(error) }, meta });
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export type { ContentLanguage, IContentUnit, ISubtitleTrack };

export interface ProphecyEpisodeIdentity {
  /** Canonical internal Prophecy episode ID. Use this value for all /api/episodes/:episodeId routes. */
  id: string;
  animeId: string;
  seasonId: string;
  episodeNumber: number;
  title: string;
  /** Provider-native episode ID, when configured; never the canonical id. */
  providerId: string | null;
  /** Backward-compatible alias; id remains canonical. */
  episodeId: string;
}

export function toProphecyEpisodeIdentity(episode: ProphecyEpisode): ProphecyEpisodeIdentity {
  return {
    id: episode.episodeId,
    animeId: episode.animeId,
    seasonId: episode.seasonId,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    providerId: episode.providerEpisodeId ?? null,
    episodeId: episode.episodeId,
  };
}

const PUBLIC_ANIME_PROVIDER_IDS = new Set(['gogoanime', 'goyabu', 'allmanga', 'animeparadise', 'anikoto', 'megaplay']);

type PublicServerOption = Omit<ProphecyServerAlias, 'providerId'> & { available?: boolean };

function publicServerOptions(context: ProphecyApiContext, episodeId?: string): PublicServerOption[] {
  return (context.serverAliases ?? context.providers
    .filter((provider) => PUBLIC_ANIME_PROVIDER_IDS.has(provider.id))
    .map((provider, index) => ({
      serverId: `server-${index + 1}`,
      label: `Server ${index + 1}`,
      providerId: provider.id,
      priority: index + 1,
      enabled: true,
    })))
    .filter((server) => server.enabled)
    .sort((a, b) => a.priority - b.priority)
    .map(({ providerId, ...server }) => ({
      ...server,
      ...(episodeId ? { available: context.store.listSources(episodeId).some((source) => source.providerId === providerId && source.enabled) } : {}),
    }));
}

export async function handleProphecyRoute(
  context: ProphecyApiContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const parts = path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] !== 'api') return false;

  const method = req.method ?? 'GET';
  const store = context.store;
  const admin = () => {
    if (!authorizedMutation(req, context)) {
      prophecyResponse(res, 401, null, 'Admin authentication required');
      return false;
    }
    return true;
  };
  const body = async () => readJsonBody(req);
  const ok = (data: unknown, status = 200, meta: Record<string, unknown> = {}) => prophecyResponse(res, status, data, null, meta);
  const fail = (error: unknown, status = 404, code = 'PROPHECY_ERROR') => prophecyResponse(res, status, null, error, {}, code);

  try {
    if (parts[1] === 'providers' && parts.length === 2 && method === 'GET') {
      return ok(publicServerOptions(context)), true;
    }
    if (parts[1] === 'servers' && parts.length === 2 && method === 'GET') {
      return ok(publicServerOptions(context)), true;
    }
    // Explicitly handle the episode-list route before any generic resource branch.
    // This prevents `/api/seasons/:seasonId/episodes` from ever being interpreted
    // as a server-list route in a deployed build.
    if (parts[1] === 'seasons' && parts.length === 4 && parts[3] === 'episodes' && method === 'GET') {
      const seasonId = parts[2];
      const season = store.getSeason(seasonId);
      if (!season) return fail('Season not found', 404, 'SEASON_NOT_FOUND'), true;
      const episodes = store.listEpisodes(seasonId).map(toProphecyEpisodeIdentity);
      return ok(episodes, 200, { seasonId, count: episodes.length }), true;
    }
    if (parts[1] === 'anime' && parts.length >= 3) {
      if (parts[2] === 'search') return false;
      const animeId = parts[2];
      if (!animeId) return false;
      if (parts.length === 3 && method === 'GET') {
        const value = store.getAnime(animeId);
        return value ? (ok(value), true) : (fail('Anime not found'), true);
      }
      if (parts.length === 3 && method === 'PATCH') {
        if (!admin()) return true;
        return ok(store.updateAnime(animeId, await body())), true;
      }
      if (parts.length === 3 && method === 'DELETE') {
        if (!admin()) return true;
        store.deleteAnime(animeId);
        return ok({ deleted: true }), true;
      }
      if (parts[3] === 'episodes' && parts.length === 4 && method === 'GET') {
        const resolvedAnimeId = store.resolveAnimeId(animeId);
        if (!resolvedAnimeId) return fail('Anime not found', 404, 'ANIME_NOT_FOUND'), true;
        const episodes = store.listEpisodesByAnime(animeId).map(toProphecyEpisodeIdentity);
        return ok(episodes, 200, { animeId, resolvedAnimeId, count: episodes.length }), true;
      }
      if (parts[3] === 'seasons') {
        if (parts.length === 4 && method === 'GET') {
          const resolvedAnimeId = store.resolveAnimeId(animeId);
          return resolvedAnimeId ? (ok(store.listSeasons(resolvedAnimeId)), true) : (fail('Anime not found', 404, 'ANIME_NOT_FOUND'), true);
        }
        if (parts.length === 4 && method === 'POST') {
          if (!admin()) return true;
          const resolvedAnimeId = store.resolveAnimeId(animeId);
          if (!resolvedAnimeId) return fail('Anime not found', 404, 'ANIME_NOT_FOUND'), true;
          return ok(store.createSeason(resolvedAnimeId, await body()), 201), true;
        }
      }
    }

    if (parts[1] === 'anime' && parts.length === 2 && method === 'POST') {
      if (!admin()) return true;
      const input = await body();
      if (typeof input.title !== 'string' || input.title.trim() === '') return fail('title is required', 400), true;
      return ok(store.createAnime(input as Partial<ProphecyAnime> & Pick<ProphecyAnime, 'title'>), 201), true;
    }

    if (parts[1] === 'seasons') {
      const seasonId = parts[2];
      if (parts.length === 3 && method === 'GET') return store.getSeason(seasonId) ? (ok(store.getSeason(seasonId)), true) : (fail('Season not found'), true);
      if (parts.length === 3 && method === 'PATCH') { if (!admin()) return true; return ok(store.updateSeason(seasonId, await body())), true; }
      if (parts.length === 3 && method === 'DELETE') { if (!admin()) return true; store.deleteSeason(seasonId); return ok({ deleted: true }), true; }
      if (parts[3] === 'episodes') {
        if (parts.length === 4 && method === 'GET') return ok(store.listEpisodes(seasonId).map(toProphecyEpisodeIdentity)), true;
        if (parts.length === 4 && method === 'POST') {
          if (!admin()) return true;
          const input = await body();
          if (typeof input.title !== 'string' || typeof input.episodeNumber !== 'number') return fail('title and episodeNumber are required', 400), true;
          return ok(store.createEpisode(seasonId, input as Partial<ProphecyEpisode> & Pick<ProphecyEpisode, 'title' | 'episodeNumber'>), 201), true;
        }
      }
    }

    if (parts[1] === 'episodes') {
      const episodeId = parts[2];
      const episode = store.getEpisode(episodeId);
      if (!episode) return fail('Episode not found', 404, 'EPISODE_NOT_FOUND'), true;
      if (parts.length === 3 && method === 'GET') return ok({ ...episode, id: episode.episodeId }), true;
      if (parts.length === 3 && method === 'PATCH') { if (!admin()) return true; return ok(store.updateEpisode(episodeId, await body())), true; }
      if (parts.length === 3 && method === 'DELETE') { if (!admin()) return true; store.deleteEpisode(episodeId); return ok({ deleted: true }), true; }
      const child = parts[3];
      if (child === 'audio-languages') {
        if (parts.length === 4 && method === 'GET') return ok(store.listAudioLanguages(episodeId, url.searchParams.get('enabledOnly') !== 'false')), true;
      }
      if (child === 'servers') {
        if (parts.length === 4 && method === 'GET') {
          return ok(publicServerOptions(context, episodeId)), true;
        }
      }
      if (child === 'languages') {
        if (parts.length === 4 && method === 'GET') return ok(store.listLanguages(episodeId, url.searchParams.get('enabledOnly') === 'true')), true;
        if (parts.length === 4 && method === 'POST') {
          if (!admin()) return true;
          const input = await body();
          const value = {
            languageCode: input.languageCode,
            languageName: input.languageName,
            type: input.type,
            isDefault: input.isDefault,
            enabled: input.enabled,
            priority: input.priority,
          } as Omit<ProphecyLanguage, 'languageId' | 'episodeId'>;
          return ok(store.createLanguage(episodeId, value), 201), true;
        }
      }
      if (child === 'audio') {
        if (parts.length === 4 && method === 'GET') return ok(store.listAudio(episodeId)), true;
        if (parts.length === 4 && method === 'POST') { if (!admin()) return true; return ok(store.createAudio(episodeId, await body() as Omit<ProphecyAudio, 'audioId' | 'episodeId'>), 201), true; }
      }
      if (child === 'subtitles') {
        if (parts.length === 4 && method === 'GET') return ok(store.listSubtitles(episodeId)), true;
        if (parts.length === 4 && method === 'POST') { if (!admin()) return true; return ok(store.createSubtitle(episodeId, await body() as Omit<ProphecySubtitle, 'subtitleId' | 'episodeId'>), 201), true; }
      }
      if (child === 'sources') {
        if (parts.length === 4 && method === 'GET') return ok(store.listSources(episodeId, url.searchParams.get('language') ?? undefined)), true;
        if (parts.length === 4 && method === 'POST') { if (!admin()) return true; return ok(store.createSource(episodeId, await body() as Omit<ProphecySource, 'sourceId' | 'episodeId'>), 201), true; }
      }
      if (child === 'play' && method === 'GET') {
        const selectedAudio = store.selectAudioLanguage(episodeId, url.searchParams.get('audioLanguage') ?? url.searchParams.get('audio') ?? undefined);
        const selectedServer = url.searchParams.get('server') ?? undefined;
        const stream = await resolveProphecyPlayback(context, episode, {
          server: selectedServer,
          language: (url.searchParams.get('language') as ContentLanguage | null) ?? undefined,
          audioLanguage: url.searchParams.get('audioLanguage') ?? url.searchParams.get('audio') ?? undefined,
          subtitle: url.searchParams.get('subtitle') ?? undefined,
          quality: (url.searchParams.get('quality') as IVideoPayload['quality'] | null) ?? undefined,
        });
        return ok({
          episodeId,
          server: selectedServer ? publicServerOptions(context, episodeId).find((server) => server.serverId === selectedServer) ?? null : null,
          availableServers: publicServerOptions(context, episodeId),
          audioLanguage: selectedAudio,
          availableAudioLanguages: store.listAudioLanguages(episodeId, true),
          stream,
        }), true;
      }
    }

    if (parts[1] === 'languages' && parts.length === 3) {
      const languageId = parts[2];
      if (method === 'GET') { const value = store.getLanguage(languageId); return value ? (ok(value), true) : (fail('Language not found', 404, 'LANGUAGE_NOT_FOUND'), true); }
      if (method === 'PATCH') { if (!admin()) return true; return ok(store.updateLanguage(languageId, await body())), true; }
      if (method === 'DELETE') { if (!admin()) return true; store.deleteLanguage(languageId); return ok({ deleted: true }), true; }
    }
    if (parts[1] === 'audio' && parts.length === 3) {
      const audioId = parts[2];
      if (method === 'PATCH') { if (!admin()) return true; return ok(store.updateAudio(audioId, await body())), true; }
      if (method === 'DELETE') { if (!admin()) return true; store.deleteAudio(audioId); return ok({ deleted: true }), true; }
    }
    if (parts[1] === 'subtitles' && parts.length === 3) {
      const subtitleId = parts[2];
      if (method === 'PATCH') { if (!admin()) return true; return ok(store.updateSubtitle(subtitleId, await body())), true; }
      if (method === 'DELETE') { if (!admin()) return true; store.deleteSubtitle(subtitleId); return ok({ deleted: true }), true; }
    }
    if (parts[1] === 'sources' && parts.length === 3) {
      const sourceId = parts[2];
      if (method === 'PATCH') { if (!admin()) return true; return ok(store.updateSource(sourceId, await body())), true; }
      if (method === 'DELETE') { if (!admin()) return true; store.deleteSource(sourceId); return ok({ deleted: true }), true; }
    }
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ProphecyError) {
      fail(message, error.status, error.code);
      return true;
    }
    const status = /not found/i.test(message) ? 404 : /required|JSON|must be/i.test(message) ? 400 : 500;
    fail(message, status);
    return true;
  }
}
