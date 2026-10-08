/**
 * THAAW Browser — Ad Blocker Unit Tests
 * Tests ad domain interception, cosmetic CSS availability, allowlisting, and stats.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AdBlocker } from '../../browser/privacy/ad-blocker';

describe('AdBlocker Subsystem', () => {
  let adBlocker: AdBlocker;

  beforeEach(() => {
    adBlocker = new AdBlocker(true);
  });

  describe('Ad Domain Interception', () => {
    it('should block known ad server domains', () => {
      const adUrls = [
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://securepubads.g.doubleclick.net/gampad/ads?correlator=123',
        'https://aax.amazon-adsystem.com/e/dtb/bid',
        'https://ib.adnxs.com/ut/v3/prebid',
        'https://cdn.taboola.com/libtrc/unip/loader.js',
        'https://images.outbrain.com/widget.js',
        'https://ads.pubmatic.com/AdServer/js/pwt.js',
        'https://c.amazon-adsystem.com/aax2/apstag.js'
      ];

      for (const url of adUrls) {
        const res = adBlocker.shouldBlockAd(url, 'https://news-site.org');
        expect(res.block).toBe(true);
        expect(res.reason).toBeDefined();
      }
    });

    it('should intercept YouTube video ad requests', () => {
      const ytAdUrl = 'https://www.youtube.com/api/stats/ads?v=xyz&ad_type=1';
      const res = adBlocker.shouldBlockAd(ytAdUrl, 'https://www.youtube.com');
      expect(res.block).toBe(true);
      expect(res.reason).toContain('YouTube video ad');
    });

    it('should intercept video ad platforms across web articles and players', () => {
      const videoAdUrls = [
        'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
        'https://cdx.connatix.com/player/connatix.js',
        'https://live.primis.tech/live/liveView.php',
        'https://anyclip.com/assets/player.js',
        'https://pubads.g.doubleclick.net/gampad/ads?env=vp',
        'https://scripts.mediavine.com/tags/news.js',
        'https://ads.adthrive.com/sites/123/ads.min.js'
      ];

      for (const url of videoAdUrls) {
        const res = adBlocker.shouldBlockAd(url, 'https://article-site.com');
        expect(res.block).toBe(true);
      }
    });

    it('should not block benign non-ad content', () => {
      const benignUrls = [
        'https://en.wikipedia.org/wiki/Linux',
        'https://github.com/torvalds/linux',
        'https://cdn.jsdelivr.net/npm/chart.js',
        'https://fonts.googleapis.com/css2?family=Inter'
      ];

      for (const url of benignUrls) {
        const res = adBlocker.shouldBlockAd(url, 'https://example.com');
        expect(res.block).toBe(false);
      }
    });
  });

  describe('Cosmetic Filters', () => {
    it('should provide cosmetic element-hiding CSS rules for videos, articles, and banners', () => {
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toBeDefined();
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toContain('adsbygoogle');
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toContain('ytd-ad-slot-renderer');
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toContain('connatix');
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toContain('primis');
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toContain('taboola');
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toContain('OUTBRAIN');
      expect(AdBlocker.COSMETIC_FILTERS_CSS).toContain('display: none !important');
    });
  });

  describe('Toggling & Site Exceptions', () => {
    it('should honor global enable/disable toggle', () => {
      adBlocker.setEnabled(false);
      expect(adBlocker.isEnabled()).toBe(false);

      const res = adBlocker.shouldBlockAd('https://sub.doubleclick.net/ad.js', 'https://example.com');
      expect(res.block).toBe(false);

      adBlocker.setEnabled(true);
      expect(adBlocker.isEnabled()).toBe(true);
      const resActive = adBlocker.shouldBlockAd('https://sub.doubleclick.net/ad.js', 'https://example.com');
      expect(resActive.block).toBe(true);
    });

    it('should allow exceptions per site domain', () => {
      const origin = 'https://trusted-creator.com';
      expect(adBlocker.isSiteAllowed(origin)).toBe(false);

      adBlocker.toggleSiteException(origin);
      expect(adBlocker.isSiteAllowed(origin)).toBe(true);

      const res = adBlocker.shouldBlockAd('https://pagead2.googlesyndication.com/ad.js', origin);
      expect(res.block).toBe(false);

      adBlocker.toggleSiteException(origin);
      expect(adBlocker.isSiteAllowed(origin)).toBe(false);
      const resBlocked = adBlocker.shouldBlockAd('https://pagead2.googlesyndication.com/ad.js', origin);
      expect(resBlocked.block).toBe(true);
    });
  });

  describe('Statistics Aggregation', () => {
    it('should track blocked ad count accurately', () => {
      const origin = 'https://portal.com';
      adBlocker.shouldBlockAd('https://adservice.google.com/adsid/google/ui', origin);
      adBlocker.shouldBlockAd('https://ib.adnxs.com/tag', origin);

      expect(adBlocker.getBlockedCountForSite(origin)).toBe(2);
      expect(adBlocker.getTotalBlockedCount()).toBe(2);
      expect(adBlocker.getRecentBlockedEvents().length).toBe(2);
    });
  });
});
