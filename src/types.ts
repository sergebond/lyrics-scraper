/** Единственное место, где перечислены id источников — scrape.ts, cli.ts и
 * ScrapeOptions.source берут список отсюда, чтобы не дублировать и не
 * расходиться при добавлении/удалении источника. */
export const SOURCE_IDS = ["amdm", "mytabs", "guitaretab", "lacuerda"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export interface Song {
  title: string;
  artist: string;
  key: string;
  url: string;
  body: string;
}

/** Одна строка в списке песен исполнителя: название, ссылка, число просмотров. */
export interface SongEntry {
  title: string;
  url: string;
  views: number;
}

export interface ResolvedArtist {
  /** Внутренний идентификатор исполнителя у источника (slug/путь). */
  id: string;
  /** URL страницы исполнителя. */
  url: string;
  /** Отображаемое имя, которое использовать как fallback для "Исполнитель:". */
  displayName: string;
}

/**
 * Источник аккордов (сайт). Каждый источник умеет по имени исполнителя
 * найти его страницу, собрать список песен с просмотрами и разобрать
 * страницу конкретной песни в текст+аккорды.
 */
export interface ChordSource {
  /** Короткое имя источника, используется в логах и для выбора вручную. */
  readonly id: string;

  /** Пытается найти исполнителя на этом источнике. null, если не найден. */
  resolveArtist(query: string): Promise<ResolvedArtist | null>;

  /** Список всех песен исполнителя (без дедупликации) с просмотрами. */
  listEntries(artist: ResolvedArtist): Promise<SongEntry[]>;

  /** Загружает и разбирает страницу конкретной песни. */
  fetchSong(url: string, fallbackArtist: string): Promise<Song | null>;
}

export interface ScrapeOptions {
  /** Имя исполнителя (кириллица или slug/путь источника). */
  artist: string;
  /** Сколько самых популярных песен взять. По умолчанию 20. Игнорируется при songs. */
  count?: number;
  /** Конкретная песня или список песен по названию (вместо топ-N). */
  songs?: string[];
  /** Форсировать конкретный источник вместо автоматического перебора.
   * По умолчанию источник определяется сам — все четыре пробуются по
   * очереди (amdm → mytabs → guitaretab → lacuerda), пока не найдётся
   * исполнитель с непустым списком песен (см. AUTO_ORDER в scrape.ts). */
  source?: SourceId;
  /** Ход прогресса — для CLI-вывода или UI-стрима в Next.js. */
  onProgress?: (message: string) => void;
}

export interface ScrapeResult {
  artist: string;
  source: string;
  songs: Song[];
  /** Песни, которые были запрошены явно (--songs), но не найдены. */
  notFound: string[];
}

export interface ListSongsOptions {
  /** Имя исполнителя (любым языком) или slug/путь источника. */
  artist: string;
  /** Сколько песен вернуть (самых популярных). Не задано — вернуть все найденные. */
  count?: number;
  /** Форсировать конкретный источник вместо автоматического перебора. */
  source?: SourceId;
  /** Ход прогресса — для CLI-вывода или UI-стрима в Next.js. */
  onProgress?: (message: string) => void;
}

export interface ListSongsResult {
  artist: string;
  source: string;
  /** Список песен исполнителя (название/ссылка/просмотры), без текста и
   * аккордов — только метаданные. Дубликаты схлопнуты, отсортировано по
   * убыванию просмотров (нюанс для lacuerda.net — см. listSongs() в scrape.ts). */
  songs: SongEntry[];
}
