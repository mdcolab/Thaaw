/**
 * THAAW Browser — Live News Provider & Normalizer
 * Real-time news aggregator powered by public, keyless APIs and RSS/Atom feeds.
 * Supports: All, Reddit, YouTube, Articles, Security, Open Source, AI, and World.
 * Unified data layer, in-memory caching with TTL, request deduplication,
 * rate-limit handling, robust XML parsing, and story clustering.
 */

import { net, app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface NewsArticle {
  id: string;
  title: string;
  description?: string;
  snippet?: string; // backwards compatibility alias for description
  image?: string;
  imageUrl?: string; // backwards compatibility alias for image
  sourceName: string;
  source: string; // backwards compatibility alias for sourceName
  sourceType: 'article' | 'reddit' | 'youtube' | 'github' | 'opensource' | 'security' | 'web';
  platform: 'article' | 'reddit' | 'youtube' | 'github' | 'opensource' | 'security' | 'web'; // backwards compatibility alias
  category: string;
  url: string;
  publishedAt?: string;
  timestamp: string; // relative display string e.g. "12m ago"
  fetchedAt: number;
  author?: string;
  score?: number | string;
  stars?: number;
  readingTime?: string;
}

export interface CustomRssFeed {
  id: string;
  name: string;
  url: string;
  category: string;
  addedAt: number;
}

export interface StoryCluster {
  isCluster: true;
  id: string;
  topic: string;
  primaryArticle: NewsArticle;
  relatedArticles: NewsArticle[];
}

export type FeedItem = NewsArticle | StoryCluster;

export interface NewsPreferences {
  followedPublishers: string[];
  followedChannels: string[];
  customFeeds: CustomRssFeed[];
  hiddenPublishers: string[];
  hiddenTopics: string[];
}

export interface NewsResponse {
  success: boolean;
  items: FeedItem[];
  articles: NewsArticle[];
  hasMore: boolean;
  total: number;
  fetchedAt: number;
  isCached?: boolean;
  category: string;
  error?: string;
  rateLimited?: boolean;
}

interface CacheEntry {
  articles: NewsArticle[];
  fetchedAt: number;
  rateLimited?: boolean;
}

export class NewsProvider {
  private cache = new Map<string, CacheEntry>();
  private inFlightRequests = new Map<string, Promise<NewsArticle[]>>();
  public static readonly TTL_MS = 3 * 60 * 1000; // 3 minutes cache for fresh live feeds
  private preferencesPath: string;
  private followedPublishers = new Set<string>(['arstechnica.com', 'theverge.com', 'krebsonsecurity.com', 'wired.com']);
  private followedChannels = new Set<string>(['Technology', 'Security', 'AI', 'Open Source', 'Articles']);
  private customFeeds: CustomRssFeed[] = [];
  private hiddenPublishers = new Set<string>();
  private hiddenTopics = new Set<string>();

  // Curated, beautiful category fallback images
  public static readonly FALLBACK_IMAGES: Record<string, string[]> = {
    reddit: [
      'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80'
    ],
    youtube: [
      'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=600&auto=format&fit=crop&q=80'
    ],
    technology: [
      'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80'
    ],
    articles: [
      'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=600&auto=format&fit=crop&q=80'
    ],
    security: [
      'https://images.unsplash.com/photo-1563986768609-322da13575f3?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80'
    ],
    opensource: [
      'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80'
    ],
    ai: [
      'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&auto=format&fit=crop&q=80'
    ],
    world: [
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=600&auto=format&fit=crop&q=80'
    ],
    default: [
      'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=600&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=600&auto=format&fit=crop&q=80'
    ]
  };

  // Maintained list of verified, public YouTube channels (returning valid Atom XML)
  private static readonly YOUTUBE_CHANNELS = [
    { id: 'UCsBjURrPoezykLs9EqgamOA', name: 'Fireship' },
    { id: 'UC9-y-6csu5WGm29I7JiwpnA', name: 'Computerphile' },
    { id: 'UCYO_jab_esuFRV4b17AJtAw', name: '3Blue1Brown' },
    { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', name: 'Veritasium' },
    { id: 'UCBJycsmduvYEL83R_U4JriQ', name: 'MKBHD' },
    { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', name: 'Google for Developers' },
    { id: 'UC8butISFwT-Wl7EV0hUK0BQ', name: 'freeCodeCamp' },
    { id: 'UCSHZKyawb77ixDdsGog4iWA', name: 'Lex Fridman' },
    { id: 'UCXZCJLdBC09xxGZ6gcdrc6A', name: 'OpenAI' },
    { id: 'UCXuqSBlHAE6Xw-yeJA0Tunw', name: 'Linus Tech Tips' }
  ];

  // Public subreddit RSS feeds
  private static readonly REDDIT_SUBS = ['technology', 'worldnews', 'artificial', 'cybersecurity', 'opensource'];

  constructor(customStoragePath?: string) {
    if (customStoragePath) {
      this.preferencesPath = customStoragePath;
    } else {
      try {
        const userData = app?.getPath ? app.getPath('userData') : process.cwd();
        this.preferencesPath = path.join(userData, 'thaaw_news_preferences.json');
      } catch {
        this.preferencesPath = path.join(process.cwd(), 'thaaw_news_preferences.json');
      }
    }
    this.loadPreferences();
  }

  private loadPreferences(): void {
    try {
      if (fs.existsSync(this.preferencesPath)) {
        const raw = fs.readFileSync(this.preferencesPath, 'utf8');
        const data: NewsPreferences = JSON.parse(raw);
        if (Array.isArray(data.followedPublishers)) this.followedPublishers = new Set(data.followedPublishers);
        if (Array.isArray(data.followedChannels)) this.followedChannels = new Set(data.followedChannels);
        if (Array.isArray(data.customFeeds)) this.customFeeds = data.customFeeds;
        if (Array.isArray(data.hiddenPublishers)) this.hiddenPublishers = new Set(data.hiddenPublishers);
        if (Array.isArray(data.hiddenTopics)) this.hiddenTopics = new Set(data.hiddenTopics);
      }
    } catch (e) {
      console.warn('[NewsProvider] Error loading preferences:', e);
    }
  }

  private savePreferences(): void {
    try {
      const data: NewsPreferences = {
        followedPublishers: Array.from(this.followedPublishers),
        followedChannels: Array.from(this.followedChannels),
        customFeeds: this.customFeeds,
        hiddenPublishers: Array.from(this.hiddenPublishers),
        hiddenTopics: Array.from(this.hiddenTopics)
      };
      fs.writeFileSync(this.preferencesPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[NewsProvider] Error saving preferences:', e);
    }
  }

  public getFollowState(): NewsPreferences {
    return {
      followedPublishers: Array.from(this.followedPublishers),
      followedChannels: Array.from(this.followedChannels),
      customFeeds: [...this.customFeeds],
      hiddenPublishers: Array.from(this.hiddenPublishers),
      hiddenTopics: Array.from(this.hiddenTopics)
    };
  }

  public toggleFollowPublisher(publisher: string): boolean {
    const pub = publisher.toLowerCase().trim();
    if (this.followedPublishers.has(pub)) {
      this.followedPublishers.delete(pub);
      this.savePreferences();
      return false;
    } else {
      this.followedPublishers.add(pub);
      this.savePreferences();
      return true;
    }
  }

  public toggleFollowChannel(channel: string): boolean {
    const ch = channel.trim();
    if (this.followedChannels.has(ch)) {
      this.followedChannels.delete(ch);
      this.savePreferences();
      return false;
    } else {
      this.followedChannels.add(ch);
      this.savePreferences();
      return true;
    }
  }

  public hidePublisher(publisher: string): void {
    this.hiddenPublishers.add(publisher.toLowerCase().trim());
    this.savePreferences();
  }

  public hideTopic(topic: string): void {
    this.hiddenTopics.add(topic.toLowerCase().trim());
    this.savePreferences();
  }

  public async validateAndAddRssFeed(feedUrl: string, name: string, category: string): Promise<{ success: boolean; feed?: CustomRssFeed; error?: string }> {
    try {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(feedUrl);
      } catch {
        return { success: false, error: 'Invalid URL format' };
      }

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, error: 'URL must use HTTP or HTTPS' };
      }

      const response = await this.safeFetch(feedUrl, {
        timeoutMs: 6000,
        headers: {
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
        }
      });

      if (!response.ok) {
        return { success: false, error: `Feed responded with status ${response.status}` };
      }

      const text = await response.text();
      if (!text.includes('<item') && !text.includes('<entry')) {
        return { success: false, error: 'URL is not a valid RSS or Atom feed' };
      }

      const feed: CustomRssFeed = {
        id: `rss_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || parsedUrl.hostname,
        url: feedUrl.trim(),
        category: category.trim() || 'General',
        addedAt: Date.now()
      };

      this.customFeeds.push(feed);
      this.savePreferences();
      this.cache.clear();

      return { success: true, feed };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public deleteCustomRssFeed(id: string): boolean {
    const initialLen = this.customFeeds.length;
    this.customFeeds = this.customFeeds.filter(f => f.id !== id);
    if (this.customFeeds.length !== initialLen) {
      this.savePreferences();
      this.cache.clear();
      return true;
    }
    return false;
  }

  public getCustomRssFeeds(): CustomRssFeed[] {
    return [...this.customFeeds];
  }

  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Safe fetch with configurable timeout and standard User-Agent
   */
  private async safeFetch(url: string, options: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<Response> {
    const timeoutMs = options.timeoutMs || 6000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchFunc = (typeof globalThis.fetch === 'function')
        ? globalThis.fetch
        : ((typeof net !== 'undefined' && net?.fetch) ? net.fetch.bind(net) : fetch);

      const res = await fetchFunc(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
          'Accept': 'application/json, application/xml, text/xml, application/atom+xml, */*',
          ...(options.headers || {})
        }
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Main entry point for retrieving news
   */
  public async getNews(category = 'all', page = 1, pageSize = 8, view = 'for_you', forceRefresh = false): Promise<NewsResponse> {
    const cat = this.normalizeCategory(category);
    let allArticles: NewsArticle[] = [];
    let isCached = false;
    let rateLimited = false;
    let fetchError: string | undefined;

    const cached = this.cache.get(cat);
    const isCacheValid = cached && (Date.now() - cached.fetchedAt < NewsProvider.TTL_MS);

    if (!forceRefresh && isCacheValid) {
      allArticles = cached.articles;
      isCached = true;
      rateLimited = !!cached.rateLimited;
    } else {
      // In-flight request deduplication
      if (this.inFlightRequests.has(cat)) {
        try {
          allArticles = await this.inFlightRequests.get(cat)!;
        } catch {
          allArticles = cached ? cached.articles : [];
        }
      } else {
        const fetchPromise = this.fetchCategory(cat)
          .then(async (fetched) => {
            // Also append custom feeds matching this category or for 'all'
            if (this.customFeeds.length > 0) {
              const customArticles = await this.fetchCustomFeeds(cat);
              fetched.unshift(...customArticles);
            }
            return fetched;
          })
          .catch((err) => {
            fetchError = err instanceof Error ? err.message : String(err);
            console.warn(`[THAAW News] Fetch error for category "${cat}":`, fetchError);
            return [];
          });

        this.inFlightRequests.set(cat, fetchPromise);
        try {
          allArticles = await fetchPromise;
        } finally {
          this.inFlightRequests.delete(cat);
        }

        if (allArticles.length > 0) {
          this.cache.set(cat, { articles: allArticles, fetchedAt: Date.now() });
        } else if (cached && cached.articles.length > 0) {
          // Network failed, reuse stale cache
          allArticles = cached.articles;
          isCached = true;
          fetchError = fetchError || 'Network unavailable. Using cached results.';
        } else if (cat === 'reddit') {
          rateLimited = true;
          fetchError = 'Reddit public feeds are temporarily rate-limiting requests (HTTP 429). Will retry shortly.';
        }
      }
    }

    // Filter out hidden publishers & topics
    let filteredArticles = allArticles.filter(item => {
      const pub = (item.sourceName || item.source || '').toLowerCase();
      const topic = (item.category || '').toLowerCase();
      if (Array.from(this.hiddenPublishers).some(hp => pub.includes(hp))) return false;
      if (Array.from(this.hiddenTopics).some(ht => topic.includes(ht) || item.title.toLowerCase().includes(ht))) return false;
      return true;
    });

    // Handle view modes: 'for_you', 'following', 'top_news', 'trending'
    if (view === 'following') {
      const followed = filteredArticles.filter(item => {
        const pub = (item.sourceName || item.source || '').toLowerCase();
        const ch = (item.category || '').toLowerCase();
        const isFollowedPub = Array.from(this.followedPublishers).some(p => pub.includes(p));
        const isFollowedCh = Array.from(this.followedChannels).some(c => c.toLowerCase() === ch);
        const isCustom = this.customFeeds.some(cf => item.url.includes(new URL(cf.url).hostname));
        return isFollowedPub || isFollowedCh || isCustom;
      });
      if (followed.length > 0) {
        filteredArticles = followed;
      }
    } else if (view === 'trending') {
      filteredArticles.sort((a, b) => {
        const scoreA = (a.score ? 10 : 0) + (a.timestamp.includes('m ago') ? 5 : 0);
        const scoreB = (b.score ? 10 : 0) + (b.timestamp.includes('m ago') ? 5 : 0);
        return scoreB - scoreA;
      });
    } else if (view === 'for_you') {
      filteredArticles.sort((a, b) => {
        const aFollowed = Array.from(this.followedPublishers).some(p => (a.sourceName || '').toLowerCase().includes(p)) ||
                          Array.from(this.followedChannels).some(c => c.toLowerCase() === a.category.toLowerCase());
        const bFollowed = Array.from(this.followedPublishers).some(p => (b.sourceName || '').toLowerCase().includes(p)) ||
                          Array.from(this.followedChannels).some(c => c.toLowerCase() === b.category.toLowerCase());
        if (aFollowed && !bFollowed) return -1;
        if (!aFollowed && bFollowed) return 1;
        return 0;
      });
    }

    // Cluster top news
    const feedItems: FeedItem[] = (view === 'top_news' || view === 'for_you')
      ? this.clusterArticles(filteredArticles)
      : filteredArticles;

    const startIndex = (Math.max(1, page) - 1) * pageSize;
    const paginatedItems = feedItems.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < feedItems.length;

    // Flat articles for backward compatibility
    const flatArticles: NewsArticle[] = [];
    for (const item of paginatedItems) {
      if ('isCluster' in item) {
        flatArticles.push(item.primaryArticle);
        flatArticles.push(...item.relatedArticles);
      } else {
        flatArticles.push(item);
      }
    }

    return {
      success: filteredArticles.length > 0 || !fetchError,
      items: paginatedItems,
      articles: flatArticles,
      hasMore,
      total: feedItems.length,
      fetchedAt: cached?.fetchedAt || Date.now(),
      isCached,
      category: cat,
      error: fetchError,
      rateLimited
    };
  }

  private normalizeCategory(raw: string): string {
    const c = (raw || 'all').toLowerCase().trim();
    if (c === 'technology' || c === 'articles') return 'articles';
    if (c === 'opensource' || c === 'open-source' || c === 'open source') return 'opensource';
    return c;
  }

  /**
   * Category router for data fetching
   */
  private async fetchCategory(category: string): Promise<NewsArticle[]> {
    switch (category) {
      case 'all':
        return this.fetchAll();
      case 'reddit':
        return this.fetchReddit();
      case 'youtube':
        return this.fetchYouTube();
      case 'articles':
        return this.fetchArticles();
      case 'security':
        return this.fetchSecurity();
      case 'opensource':
        return this.fetchOpenSource();
      case 'ai':
        return this.fetchAi();
      case 'world':
        return this.fetchWorld();
      default:
        return this.fetchAll();
    }
  }

  /**
   * ALL: Combines top sources across categories, deduplicates, and sorts newest first
   */
  private async fetchAll(): Promise<NewsArticle[]> {
    const fetchTasks = [
      this.fetchArticles(8),
      this.fetchSecurity(8),
      this.fetchOpenSource(8),
      this.fetchAi(8),
      this.fetchYouTube(6),
      this.fetchWorld(8),
      this.fetchReddit(5).catch(() => [])
    ];

    const results = await Promise.allSettled(fetchTasks);
    const combined: NewsArticle[] = [];

    for (const res of results) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        combined.push(...res.value);
      }
    }

    const deduplicated = this.deduplicateArticles(combined);
    // Sort newest first
    deduplicated.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    // Apply source diversity so no single source dominates
    return this.balanceSourceDiversity(deduplicated);
  }

  /**
   * REDDIT: Public subreddit RSS feeds
   */
  private async fetchReddit(limitPerSub = 6): Promise<NewsArticle[]> {
    const allItems: NewsArticle[] = [];

    for (const sub of NewsProvider.REDDIT_SUBS) {
      try {
        const url = `https://www.reddit.com/r/${sub}/.rss`;
        const res = await this.safeFetch(url, {
          timeoutMs: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
          }
        });

        if (res.status === 429) {
          console.warn(`[NewsProvider] Reddit rate-limited (429) for r/${sub}`);
          break; // Stop spamming Reddit once 429 is encountered
        }

        if (!res.ok) continue;

        const xml = await res.text();
        const parsed = this.parseFeedXml(xml, 'REDDIT', 'reddit', `r/${sub}`);
        allItems.push(...parsed.slice(0, limitPerSub));
      } catch (e) {
        // Individual subreddit fail does not crash
      }
    }

    const deduped = this.deduplicateArticles(allItems);
    deduped.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    return deduped;
  }

  /**
   * YOUTUBE: Public YouTube channel Atom RSS feeds
   */
  private async fetchYouTube(limitPerChannel = 4): Promise<NewsArticle[]> {
    const tasks = NewsProvider.YOUTUBE_CHANNELS.map(async (ch) => {
      try {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
        const res = await this.safeFetch(url, { timeoutMs: 7000 });
        if (!res.ok) return [];
        const xml = await res.text();
        return this.parseFeedXml(xml, 'YOUTUBE', 'youtube', ch.name).slice(0, limitPerChannel);
      } catch {
        return [];
      }
    });

    const results = await Promise.allSettled(tasks);
    const allVideos: NewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        allVideos.push(...r.value);
      }
    }

    const deduped = this.deduplicateArticles(allVideos);
    deduped.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    return deduped;
  }

  /**
   * ARTICLES: Google News RSS + Ars Technica + The Verge + GDELT
   */
  private async fetchArticles(maxTotal = 25): Promise<NewsArticle[]> {
    const tasks = [
      this.fetchGoogleNewsRss('technology', 'ARTICLES'),
      this.fetchRssFeed('https://feeds.arstechnica.com/arstechnica/index', 'ARTICLES', 'article', 'Ars Technica'),
      this.fetchRssFeed('https://www.theverge.com/rss/index.xml', 'ARTICLES', 'article', 'The Verge'),
      this.fetchGdelt('technology', 'ARTICLES')
    ];

    const results = await Promise.allSettled(tasks);
    const articles: NewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        articles.push(...r.value);
      }
    }

    const deduped = this.deduplicateArticles(articles);
    deduped.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    return deduped.slice(0, maxTotal);
  }

  /**
   * SECURITY: Krebs on Security + The Hacker News + CISA + Google News + GDELT
   */
  private async fetchSecurity(maxTotal = 25): Promise<NewsArticle[]> {
    const tasks = [
      this.fetchRssFeed('https://krebsonsecurity.com/feed/', 'SECURITY', 'security', 'Krebs on Security'),
      this.fetchRssFeed('https://feeds.feedburner.com/TheHackersNews', 'SECURITY', 'security', 'The Hacker News'),
      this.fetchRssFeed('https://www.cisa.gov/cybersecurity-advisories/all.xml', 'SECURITY', 'security', 'CISA Advisories'),
      this.fetchGoogleNewsRss('cybersecurity vulnerability OR malware', 'SECURITY', 'security'),
      this.fetchGdelt('cybersecurity vulnerability malware', 'SECURITY', 'security')
    ];

    const results = await Promise.allSettled(tasks);
    const items: NewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        items.push(...r.value);
      }
    }

    const deduped = this.deduplicateArticles(items);
    deduped.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    return deduped.slice(0, maxTotal);
  }

  /**
   * OPEN SOURCE: GitHub Search API + Hacker News Algolia API
   */
  private async fetchOpenSource(maxTotal = 25): Promise<NewsArticle[]> {
    const tasks = [
      this.fetchGitHubRepos('topic:opensource', 'OPEN SOURCE'),
      this.fetchHackerNews('open source', 'OPEN SOURCE')
    ];

    const results = await Promise.allSettled(tasks);
    const items: NewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        items.push(...r.value);
      }
    }

    const deduped = this.deduplicateArticles(items);
    deduped.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    return deduped.slice(0, maxTotal);
  }

  /**
   * AI: Google News RSS + Hacker News API + GDELT
   */
  private async fetchAi(maxTotal = 25): Promise<NewsArticle[]> {
    const tasks = [
      this.fetchGoogleNewsRss('artificial intelligence OR machine learning OR LLM', 'AI'),
      this.fetchHackerNews('artificial intelligence', 'AI'),
      this.fetchGdelt('artificial intelligence', 'AI')
    ];

    const results = await Promise.allSettled(tasks);
    const items: NewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        items.push(...r.value);
      }
    }

    const deduped = this.deduplicateArticles(items);
    deduped.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    return deduped.slice(0, maxTotal);
  }

  /**
   * WORLD: Google News RSS World + BBC World + GDELT
   */
  private async fetchWorld(maxTotal = 25): Promise<NewsArticle[]> {
    const tasks = [
      this.fetchGoogleNewsRss('world news', 'WORLD'),
      this.fetchRssFeed('https://feeds.bbci.co.uk/news/world/rss.xml', 'WORLD', 'article', 'BBC News'),
      this.fetchGdelt('world news', 'WORLD')
    ];

    const results = await Promise.allSettled(tasks);
    const items: NewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        items.push(...r.value);
      }
    }

    const deduped = this.deduplicateArticles(items);
    deduped.sort((a, b) => this.getArticleEpoch(b) - this.getArticleEpoch(a));
    return deduped.slice(0, maxTotal);
  }

  /**
   * Helper: Google News RSS
   */
  private async fetchGoogleNewsRss(query: string, category: string, platform: NewsArticle['sourceType'] = 'article'): Promise<NewsArticle[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
      const res = await this.safeFetch(url, { timeoutMs: 5000 });
      if (!res.ok) return [];
      const xml = await res.text();
      return this.parseFeedXml(xml, category, platform);
    } catch {
      return [];
    }
  }

  /**
   * Helper: Standard RSS/Atom feed URL
   */
  private async fetchRssFeed(url: string, category: string, platform: NewsArticle['sourceType'] = 'article', fallbackSource?: string): Promise<NewsArticle[]> {
    try {
      const res = await this.safeFetch(url, { timeoutMs: 5000 });
      if (!res.ok) return [];
      const xml = await res.text();
      return this.parseFeedXml(xml, category, platform, fallbackSource);
    } catch {
      return [];
    }
  }

  /**
   * Helper: Hacker News API via Algolia
   */
  private async fetchHackerNews(query: string, category: string): Promise<NewsArticle[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encoded}&tags=story&hitsPerPage=20`;
      const res = await this.safeFetch(url, { timeoutMs: 4000 });
      if (!res.ok) return [];
      const data = await res.json();
      const hits = data?.hits || [];

      const articles: NewsArticle[] = [];
      for (const h of hits) {
        if (!h.title) continue;
        const targetUrl = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;
        const publishedAt = h.created_at || new Date().toISOString();
        const scoreStr = `${h.points || 0} pts • ${h.num_comments || 0} comments`;

        articles.push({
          id: `hn_${h.objectID}`,
          title: this.cleanHtmlEntities(h.title),
          description: scoreStr,
          snippet: scoreStr,
          sourceName: 'Hacker News',
          source: 'Hacker News',
          sourceType: 'article',
          platform: 'article',
          category: category.toUpperCase(),
          url: targetUrl,
          publishedAt,
          timestamp: this.formatRelativeTime(publishedAt),
          fetchedAt: Date.now(),
          author: h.author,
          score: h.points || 0,
          image: this.getRandomFallback(category.toLowerCase())
        });
      }
      return articles;
    } catch {
      return [];
    }
  }

  /**
   * Helper: GitHub Public REST API
   */
  private async fetchGitHubRepos(query: string, category: string): Promise<NewsArticle[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://api.github.com/search/repositories?q=${encoded}&sort=updated&per_page=20`;
      const res = await this.safeFetch(url, {
        timeoutMs: 4000,
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'THAAW-Browser/1.0'
        }
      });
      if (!res.ok) return [];
      const data = await res.json();
      const repos = data?.items || [];

      const articles: NewsArticle[] = [];
      for (const repo of repos) {
        if (!repo.full_name) continue;
        const publishedAt = repo.updated_at || repo.pushed_at || new Date().toISOString();
        const stars = repo.stargazers_count || 0;
        const forks = repo.forks_count || 0;
        const lang = repo.language ? ` • ${repo.language}` : '';
        const desc = repo.description ? `${repo.description} ` : '';
        const summary = `${desc}(${stars.toLocaleString()} stars${lang})`.trim();

        articles.push({
          id: `gh_${repo.id}`,
          title: `${repo.full_name}: ${repo.description || 'Open source repository'}`,
          description: summary,
          snippet: summary,
          sourceName: `GitHub • ${repo.owner?.login || 'Open Source'}`,
          source: `GitHub • ${repo.owner?.login || 'Open Source'}`,
          sourceType: 'github',
          platform: 'opensource',
          category: category.toUpperCase(),
          url: repo.html_url,
          publishedAt,
          timestamp: this.formatRelativeTime(publishedAt),
          fetchedAt: Date.now(),
          author: repo.owner?.login,
          score: `${stars} stars`,
          stars,
          image: repo.owner?.avatar_url || this.getRandomFallback('opensource')
        });
      }
      return articles;
    } catch {
      return [];
    }
  }

  /**
   * Helper: GDELT API (with strict 3.5s timeout)
   */
  private async fetchGdelt(query: string, category: string, platform: NewsArticle['sourceType'] = 'article'): Promise<NewsArticle[]> {
    try {
      const encoded = encodeURIComponent(query);
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encoded}&mode=artlist&format=json&maxrecords=15&timespan=24h&sort=datedesc`;
      const res = await this.safeFetch(url, { timeoutMs: 3500 });
      if (!res.ok) return [];
      const data = await res.json();
      const articles = data?.articles || [];

      const result: NewsArticle[] = [];
      for (const a of articles) {
        if (!a.title || !a.url) continue;
        let sourceName = 'Global News';
        try {
          sourceName = a.domain || new URL(a.url).hostname.replace(/^www\./, '');
        } catch {}

        result.push({
          id: `gdelt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: this.cleanHtmlEntities(a.title),
          description: a.seendate ? `Reported ${a.seendate}` : '',
          snippet: a.seendate ? `Reported ${a.seendate}` : '',
          sourceName,
          source: sourceName,
          sourceType: platform,
          platform,
          category: category.toUpperCase(),
          url: a.url,
          publishedAt: a.seendate,
          timestamp: this.formatRelativeTime(a.seendate),
          fetchedAt: Date.now(),
          image: a.socialimage || this.getRandomFallback(category.toLowerCase())
        });
      }
      return result;
    } catch {
      return [];
    }
  }

  /**
   * Helper: Fetch custom user RSS/Atom feeds
   */
  private async fetchCustomFeeds(category: string): Promise<NewsArticle[]> {
    const results: NewsArticle[] = [];
    for (const feed of this.customFeeds) {
      if (category !== 'all' && feed.category.toLowerCase() !== category) continue;
      try {
        const resp = await this.safeFetch(feed.url, { timeoutMs: 5000 });
        if (resp.ok) {
          const text = await resp.text();
          const parsed = this.parseFeedXml(text, feed.category || 'RSS', 'article', feed.name);
          results.push(...parsed);
        }
      } catch {
        // Continue on feed failure
      }
    }
    return results;
  }

  /**
   * Zero-dependency robust XML Parser for RSS 2.0 and Atom 1.0 feeds
   */
  public parseFeedXml(xml: string, category: string, platform: NewsArticle['sourceType'] = 'article', fallbackSource?: string): NewsArticle[] {
    const items: NewsArticle[] = [];
    const isAtom = /<entry[\s>]/i.test(xml);
    const elements = isAtom
      ? (xml.match(/<entry[\s\S]*?<\/entry>/gi) || [])
      : (xml.match(/<item[\s\S]*?<\/item>/gi) || []);

    for (const block of elements) {
      const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!titleMatch) continue;
      const title = this.cleanHtmlEntities(titleMatch[1]);
      if (!title) continue;

      let url = '';
      const atomLink = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i);
      const rssLink = block.match(/<link>([\s\S]*?)<\/link>/i);
      if (atomLink && atomLink[1]) {
        url = atomLink[1].trim();
      } else if (rssLink && rssLink[1]) {
        url = this.cleanHtmlEntities(rssLink[1]).trim();
      }

      // Safe URL verification
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) continue;

      // Extract publication date
      let publishedAt = '';
      const dateMatch = block.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/i);
      if (dateMatch) {
        publishedAt = dateMatch[1].trim();
      }

      // Extract author
      let author = '';
      const authorMatch = block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i) ||
                          block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i);
      if (authorMatch) {
        author = this.cleanHtmlEntities(authorMatch[1]);
      }

      // Extract source / publisher name
      let sourceName = fallbackSource || '';
      const sourceTag = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      if (sourceTag) {
        sourceName = this.cleanHtmlEntities(sourceTag[1]);
      }
      if (!sourceName && isAtom) {
        const catLabel = block.match(/<category[^>]+label=["']([^"']+)["']/i);
        if (catLabel) sourceName = catLabel[1];
      }
      if (!sourceName && author) {
        sourceName = author;
      }
      if (!sourceName) {
        try {
          sourceName = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          sourceName = 'Web Feed';
        }
      }

      // Extract thumbnail image
      let imageUrl = '';
      const mediaThumb = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
      const mediaContent = block.match(/<media:content[^>]+url=["']([^"']+)["']/i);
      const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image\//i);
      const imgTag = block.match(/<img[^>]+src=["']([^"']+)["']/i);

      if (mediaThumb && mediaThumb[1]) {
        imageUrl = mediaThumb[1];
      } else if (mediaContent && mediaContent[1]) {
        imageUrl = mediaContent[1];
      } else if (enclosure && enclosure[1]) {
        imageUrl = enclosure[1];
      } else if (imgTag && imgTag[1]) {
        imageUrl = imgTag[1];
      }

      // If YouTube video, construct high quality thumbnail
      if (platform === 'youtube' && !imageUrl) {
        const ytVideoIdMatch = block.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i) || url.match(/[?&]v=([^&#]+)/);
        if (ytVideoIdMatch) {
          const vId = ytVideoIdMatch[1].trim();
          imageUrl = `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
        }
      }

      if (!imageUrl) {
        imageUrl = this.getRandomFallback(category.toLowerCase());
      }

      // Extract description
      let description = '';
      const descMatch = block.match(/<(?:description|summary|content|media:description)[^>]*>([\s\S]*?)<\/(?:description|summary|content|media:description)>/i);
      if (descMatch) {
        const cleanDesc = this.cleanHtmlEntities(descMatch[1]);
        if (cleanDesc && cleanDesc.toLowerCase() !== title.toLowerCase()) {
          description = cleanDesc.slice(0, 160);
          if (cleanDesc.length > 160) description += '...';
        }
      }

      // Reddit-specific adjustments
      let resolvedPlatform = platform;
      if (url.includes('reddit.com')) {
        resolvedPlatform = 'reddit';
        if (!sourceName || sourceName.startsWith('/u/')) {
          const subMatch = url.match(/\/r\/([^/]+)/);
          if (subMatch) sourceName = `r/${subMatch[1]}`;
        }
      } else if (url.includes('youtube.com')) {
        resolvedPlatform = 'youtube';
      }

      const relativeTime = this.formatRelativeTime(publishedAt);

      items.push({
        id: `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        description,
        snippet: description,
        image: imageUrl,
        imageUrl,
        sourceName,
        source: sourceName,
        sourceType: resolvedPlatform,
        platform: resolvedPlatform,
        category: category.toUpperCase(),
        url,
        publishedAt: publishedAt || undefined,
        timestamp: relativeTime,
        fetchedAt: Date.now(),
        author: author || undefined
      });
    }

    return items;
  }

  /**
   * Deduplicate articles by canonical URL and title similarity
   */
  public deduplicateArticles(articles: NewsArticle[]): NewsArticle[] {
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const result: NewsArticle[] = [];

    for (const a of articles) {
      if (!a.url || !a.title) continue;

      // Canonicalize URL: remove tracking query parameters
      let canonicalUrl = a.url;
      try {
        const u = new URL(a.url);
        u.searchParams.delete('utm_source');
        u.searchParams.delete('utm_medium');
        u.searchParams.delete('utm_campaign');
        u.searchParams.delete('utm_term');
        u.searchParams.delete('utm_content');
        u.searchParams.delete('ref');
        u.searchParams.delete('oc');
        canonicalUrl = u.origin + u.pathname;
      } catch {}

      if (seenUrls.has(canonicalUrl)) continue;

      // Canonicalize Title
      const simplifiedTitle = a.title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (simplifiedTitle.length > 15 && seenTitles.has(simplifiedTitle)) continue;

      seenUrls.add(canonicalUrl);
      seenTitles.add(simplifiedTitle);
      result.push(a);
    }

    return result;
  }

  /**
   * Balance source diversity across feed
   */
  private balanceSourceDiversity(articles: NewsArticle[], maxConsecutivePerSource = 2): NewsArticle[] {
    if (articles.length <= 2) return articles;

    const sourceCounts = new Map<string, number>();
    const result: NewsArticle[] = [];
    const deferred: NewsArticle[] = [];

    for (const a of articles) {
      const src = (a.sourceName || a.source || 'other').toLowerCase();
      const currentConsecutive = sourceCounts.get(src) || 0;

      if (currentConsecutive >= maxConsecutivePerSource) {
        deferred.push(a);
      } else {
        result.push(a);
        sourceCounts.set(src, currentConsecutive + 1);
        // Reset counts for other sources when a new source is inserted
        for (const k of Array.from(sourceCounts.keys())) {
          if (k !== src) sourceCounts.set(k, 0);
        }
      }
    }

    // Append deferred articles
    result.push(...deferred);
    return result;
  }

  /**
   * Calculate epoch ms for sorting
   */
  private getArticleEpoch(art: NewsArticle): number {
    if (art.publishedAt) {
      const d = new Date(art.publishedAt);
      const time = d.getTime();
      if (!isNaN(time) && time > 0) return time;
    }
    return art.fetchedAt || 0;
  }

  /**
   * Format date into clean relative timestamp e.g. "15m ago"
   */
  public formatRelativeTime(dateStr?: string): string {
    if (!dateStr) return 'Recent';
    try {
      const d = new Date(dateStr);
      const ms = d.getTime();
      if (isNaN(ms) || ms <= 0) return 'Recent';

      const diffMins = Math.floor((Date.now() - ms) / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 30) return `${diffDays}d ago`;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return 'Recent';
    }
  }

  public getRandomFallback(category: string): string {
    const list = NewsProvider.FALLBACK_IMAGES[category] || NewsProvider.FALLBACK_IMAGES['default'];
    return list[Math.floor(Math.random() * list.length)];
  }

  public cleanHtmlEntities(str: string): string {
    if (!str) return '';
    return str
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x2F;/g, '/')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Group articles with related headlines into topic clusters
   */
  public clusterArticles(articles: NewsArticle[]): FeedItem[] {
    const clusters: StoryCluster[] = [];
    const usedIndices = new Set<number>();

    const stopWords = new Set([
      'about', 'after', 'again', 'against', 'almost', 'along', 'already', 'also', 'although',
      'always', 'among', 'another', 'around', 'because', 'before', 'being', 'between', 'both',
      'came', 'could', 'down', 'during', 'each', 'early', 'even', 'first', 'from', 'further',
      'give', 'good', 'great', 'have', 'here', 'into', 'just', 'last', 'like', 'look', 'make',
      'many', 'more', 'most', 'much', 'must', 'name', 'never', 'next', 'once', 'only', 'other',
      'over', 'same', 'should', 'show', 'some', 'still', 'such', 'take', 'than', 'that', 'their',
      'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'time', 'under',
      'until', 'very', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with',
      'would', 'your', 'report', 'says', 'update', 'latest', 'live'
    ]);

    const extractKeywords = (title: string): Set<string> => {
      return new Set(
        title.toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length >= 4 && !stopWords.has(w))
      );
    };

    for (let i = 0; i < articles.length; i++) {
      if (usedIndices.has(i)) continue;
      const a = articles[i];
      const aKeywords = extractKeywords(a.title);
      const related: NewsArticle[] = [];

      for (let j = i + 1; j < articles.length; j++) {
        if (usedIndices.has(j)) continue;
        const b = articles[j];
        const bKeywords = extractKeywords(b.title);

        let commonCount = 0;
        for (const kw of aKeywords) {
          if (bKeywords.has(kw)) commonCount++;
        }

        if (commonCount >= 3) {
          related.push(b);
          usedIndices.add(j);
        }
      }

      if (related.length >= 1) {
        usedIndices.add(i);
        clusters.push({
          isCluster: true,
          id: `cluster_${i}_${Date.now()}`,
          topic: a.title,
          primaryArticle: a,
          relatedArticles: related
        });
      }
    }

    const result: FeedItem[] = [];
    for (let i = 0; i < articles.length; i++) {
      if (usedIndices.has(i)) {
        const cluster = clusters.find(c => c.primaryArticle.id === articles[i].id);
        if (cluster) result.push(cluster);
      } else {
        result.push(articles[i]);
      }
    }

    return result;
  }
}
