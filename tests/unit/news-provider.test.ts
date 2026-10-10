import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NewsProvider, NewsArticle } from '../../browser/main/news-provider';

describe('NewsProvider & Live News Architecture', () => {
  const testStoragePath = path.join(__dirname, 'test_news_preferences.json');
  let newsProvider: NewsProvider;

  beforeEach(() => {
    if (fs.existsSync(testStoragePath)) {
      fs.unlinkSync(testStoragePath);
    }
    newsProvider = new NewsProvider(testStoragePath);
  });

  afterEach(() => {
    if (fs.existsSync(testStoragePath)) {
      fs.unlinkSync(testStoragePath);
    }
  });

  describe('1. Unified Data Model & Normalization', () => {
    it('normalizes RSS 2.0 XML correctly into the unified NewsArticle schema', () => {
      const sampleRss = `
        <rss version="2.0">
          <channel>
            <title>Security News</title>
            <item>
              <title><![CDATA[Critical Kernel Zero-Day Patched in Linux 6.12]]></title>
              <link>https://krebsonsecurity.com/2026/10/kernel-patch</link>
              <pubDate>Fri, 09 Oct 2026 12:00:00 GMT</pubDate>
              <description><![CDATA[Maintainers released an emergency advisory for memory management subsystems.]]></description>
              <enclosure url="https://krebsonsecurity.com/img/patch.jpg" type="image/jpeg" />
              <source url="https://krebsonsecurity.com">Krebs on Security</source>
            </item>
          </channel>
        </rss>
      `;

      const parsed = newsProvider.parseFeedXml(sampleRss, 'SECURITY', 'security');
      expect(parsed.length).toBe(1);
      const item = parsed[0];
      expect(item.id).toBeDefined();
      expect(item.title).toBe('Critical Kernel Zero-Day Patched in Linux 6.12');
      expect(item.url).toBe('https://krebsonsecurity.com/2026/10/kernel-patch');
      expect(item.sourceName).toBe('Krebs on Security');
      expect(item.source).toBe('Krebs on Security');
      expect(item.sourceType).toBe('security');
      expect(item.platform).toBe('security');
      expect(item.category).toBe('SECURITY');
      expect(item.description).toBe('Maintainers released an emergency advisory for memory management subsystems.');
      expect(item.image).toBe('https://krebsonsecurity.com/img/patch.jpg');
      expect(item.publishedAt).toBe('Fri, 09 Oct 2026 12:00:00 GMT');
      expect(item.fetchedAt).toBeGreaterThan(0);
      expect(item.timestamp).toBeDefined();
    });

    it('normalizes Atom 1.0 XML (used by YouTube and Reddit) into unified schema', () => {
      const sampleAtom = `
        <feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
          <entry>
            <yt:videoId>abc123xyz</yt:videoId>
            <title>The Architecture of Safe Browsers</title>
            <link rel="alternate" href="https://www.youtube.com/watch?v=abc123xyz" />
            <author>
              <name>Computerphile</name>
            </author>
            <published>2026-10-08T15:30:00+00:00</published>
            <media:group>
              <media:thumbnail url="https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg" />
              <media:description>A deep dive into Chromium process isolation and sandbox architecture.</media:description>
            </media:group>
          </entry>
        </feed>
      `;

      const parsed = newsProvider.parseFeedXml(sampleAtom, 'YOUTUBE', 'youtube');
      expect(parsed.length).toBe(1);

      const item = parsed[0];
      expect(item.title).toBe('The Architecture of Safe Browsers');
      expect(item.url).toBe('https://www.youtube.com/watch?v=abc123xyz');
      expect(item.sourceName).toBe('Computerphile');
      expect(item.sourceType).toBe('youtube');
      expect(item.category).toBe('YOUTUBE');
      expect(item.image).toBe('https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg');
      expect(item.publishedAt).toBe('2026-10-08T15:30:00+00:00');
    });

    it('filters out items with invalid or non-HTTP schemes to maintain security', () => {
      const maliciousXml = `
        <rss version="2.0">
          <channel>
            <item>
              <title>XSS Attack</title>
              <link>javascript:alert(1)</link>
            </item>
            <item>
              <title>Data Scheme</title>
              <link>data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;</link>
            </item>
            <item>
              <title>File Scheme</title>
              <link>file:///etc/passwd</link>
            </item>
            <item>
              <title>Valid Link</title>
              <link>https://example.com/safe-article</link>
            </item>
          </channel>
        </rss>
      `;

      const parsed = newsProvider.parseFeedXml(maliciousXml, 'ARTICLES', 'article');
      expect(parsed.length).toBe(1);
      expect(parsed[0].url).toBe('https://example.com/safe-article');
    });
  });

  describe('2. Deduplication & Content Integrity', () => {
    it('deduplicates articles by canonical URL ignoring UTM parameters', () => {
      const now = Date.now();
      const articles: NewsArticle[] = [
        {
          id: '1',
          title: 'Quantum Computing Milestone Achieved',
          sourceName: 'Ars Technica',
          source: 'Ars Technica',
          sourceType: 'article',
          platform: 'article',
          category: 'ARTICLES',
          url: 'https://arstechnica.com/science/quantum-milestone/?utm_source=rss&utm_medium=feed',
          timestamp: '1h ago',
          fetchedAt: now
        },
        {
          id: '2',
          title: 'Quantum Computing Milestone Achieved',
          sourceName: 'Google News',
          source: 'Google News',
          sourceType: 'article',
          platform: 'article',
          category: 'ARTICLES',
          url: 'https://arstechnica.com/science/quantum-milestone/?utm_campaign=frontpage',
          timestamp: '1h ago',
          fetchedAt: now
        }
      ];

      const deduped = newsProvider.deduplicateArticles(articles);
      expect(deduped.length).toBe(1);
      expect(deduped[0].id).toBe('1');
    });

    it('deduplicates identical headlines from syndicated republishers', () => {
      const now = Date.now();
      const articles: NewsArticle[] = [
        {
          id: '1',
          title: 'Major Breakthrough in Battery Longevity Announced by MIT Researchers',
          sourceName: 'MIT News',
          source: 'MIT News',
          sourceType: 'article',
          platform: 'article',
          category: 'ARTICLES',
          url: 'https://news.mit.edu/battery-breakthrough',
          timestamp: '2h ago',
          fetchedAt: now
        },
        {
          id: '2',
          title: 'Major Breakthrough in Battery Longevity Announced by MIT Researchers',
          sourceName: 'Tech Aggregator',
          source: 'Tech Aggregator',
          sourceType: 'article',
          platform: 'article',
          category: 'ARTICLES',
          url: 'https://aggregator.net/story/88992',
          timestamp: '2h ago',
          fetchedAt: now
        }
      ];

      const deduped = newsProvider.deduplicateArticles(articles);
      expect(deduped.length).toBe(1);
    });
  });

  describe('3. Caching & Freshness Guarantees', () => {
    it('returns cached results on repeated queries within TTL', async () => {
      // First fetch
      const res1 = await newsProvider.getNews('ai', 1, 8, 'for_you', true);
      expect(res1.success).toBe(true);
      expect(res1.isCached).toBe(false);
      expect(res1.articles.length).toBeGreaterThan(0);

      // Second fetch within TTL (should hit cache)
      const res2 = await newsProvider.getNews('ai', 1, 8, 'for_you', false);
      expect(res2.success).toBe(true);
      expect(res2.isCached).toBe(true);
      expect(res2.articles.length).toBe(res1.articles.length);
    }, 20000);

    it('bypasses cache when forceRefresh is requested', async () => {
      await newsProvider.getNews('opensource', 1, 8, 'for_you', false);
      const resForce = await newsProvider.getNews('opensource', 1, 8, 'for_you', true);
      expect(resForce.success).toBe(true);
      expect(resForce.isCached).toBe(false);
    }, 20000);
  });

  describe('4. Custom RSS Feeds & Preferences', () => {
    it('saves and loads followed publishers and channels correctly', () => {
      expect(newsProvider.toggleFollowPublisher('theverge.com')).toBe(false); // was in defaults, now removed
      expect(newsProvider.toggleFollowPublisher('theverge.com')).toBe(true); // added back

      expect(newsProvider.toggleFollowChannel('Security')).toBe(false); // was in defaults, now removed
      expect(newsProvider.toggleFollowChannel('Security')).toBe(true); // added back

      const state = newsProvider.getFollowState();
      expect(state.followedPublishers).toContain('theverge.com');
      expect(state.followedChannels).toContain('Security');
    });

    it('handles hidePublisher and hideTopic correctly', async () => {
      newsProvider.hidePublisher('SpamSite');
      newsProvider.hideTopic('Clickbait');

      const state = newsProvider.getFollowState();
      expect(state.hiddenPublishers).toContain('spamsite');
      expect(state.hiddenTopics).toContain('clickbait');
    });
  });

  describe('5. Story Clustering', () => {
    it('clusters multiple articles covering the same story topic', () => {
      const now = Date.now();
      const articles: NewsArticle[] = [
        {
          id: '1',
          title: 'OpenAI Releases GPT-5 Frontier Model With Autonomous Reasoning Capabilities',
          sourceName: 'The Verge',
          source: 'The Verge',
          sourceType: 'article',
          platform: 'article',
          category: 'AI',
          url: 'https://theverge.com/gpt-5-release',
          timestamp: '30m ago',
          fetchedAt: now
        },
        {
          id: '2',
          title: 'OpenAI Announces GPT-5 Frontier Model Reasoning Benchmark Results',
          sourceName: 'Ars Technica',
          source: 'Ars Technica',
          sourceType: 'article',
          platform: 'article',
          category: 'AI',
          url: 'https://arstechnica.com/gpt-5-benchmarks',
          timestamp: '25m ago',
          fetchedAt: now
        },
        {
          id: '3',
          title: 'Unrelated Space Telescope Discovers Habitable Exoplanet Candidate',
          sourceName: 'NASA',
          source: 'NASA',
          sourceType: 'article',
          platform: 'article',
          category: 'WORLD',
          url: 'https://nasa.gov/exoplanet',
          timestamp: '1h ago',
          fetchedAt: now
        }
      ];

      const feedItems = newsProvider.clusterArticles(articles);
      expect(feedItems.length).toBe(2);

      // One cluster and one standalone article
      const cluster = feedItems.find(item => 'isCluster' in item);
      expect(cluster).toBeDefined();
      if (cluster && 'isCluster' in cluster) {
        expect(cluster.relatedArticles.length).toBe(1);
        expect(cluster.relatedArticles[0].sourceName).toBe('Ars Technica');
      }
    });
  });

  describe('6. Live Public Data Source Integration', () => {
    it('fetches real live open source content from GitHub or Hacker News', async () => {
      const res = await newsProvider.getNews('opensource', 1, 8, 'for_you', true);
      expect(res.success).toBe(true);
      expect(res.articles.length).toBeGreaterThan(0);

      const first = res.articles[0];
      expect(first.title.length).toBeGreaterThan(5);
      expect(first.url).toMatch(/^https:\/\//);
      expect(first.category).toBe('OPEN SOURCE');
    }, 15000);

    it('fetches real live AI news from Google News or Hacker News', async () => {
      const res = await newsProvider.getNews('ai', 1, 8, 'for_you', true);
      expect(res.success).toBe(true);
      expect(res.articles.length).toBeGreaterThan(0);

      const first = res.articles[0];
      expect(first.title.length).toBeGreaterThan(5);
      expect(first.url).toMatch(/^https:\/\//);
      expect(first.category).toBe('AI');
    }, 15000);

    it('fetches real YouTube videos from maintained channels', async () => {
      const res = await newsProvider.getNews('youtube', 1, 8, 'for_you', true);
      expect(res.success).toBe(true);
      expect(res.articles.length).toBeGreaterThan(0);

      const first = res.articles[0];
      expect(first.url).toMatch(/youtube\.com\/(watch\?|shorts\/)/);
      expect(first.sourceType).toBe('youtube');
      expect(first.image).toMatch(/^https:\/\/i\d?\.ytimg\.com/);
    }, 20000);
  });
});
