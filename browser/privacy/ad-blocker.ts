/**
 * THAAW Browser — Ad Blocker Engine
 * Core philosophy: "Stop What Shouldn't Pass."
 * Intercepts ad networks, video pre-roll ads, tracking beacons, and injects cosmetic filters.
 * Zero Emojis. 100% Local & Privacy-Preserving.
 */

export interface AdBlockEvent {
  url: string;
  domain: string;
  category: 'ad' | 'popup' | 'video-ad' | 'banner';
  pageOrigin?: string;
  timestamp: number;
}

export class AdBlocker {
  private enabled: boolean = true;
  private siteExceptions: Set<string> = new Set();
  private totalBlockedCount: number = 0;
  private recentBlockedAds: AdBlockEvent[] = [];
  private siteBlockedStats: Map<string, number> = new Map();

  // Comprehensive ad server & ad network domains (EasyList + Peter Lowe + AdGuard + Video + Native)
  private static readonly AD_DOMAINS = new Set<string>([
    // Google / DoubleClick Ad Tech
    'doubleclick.net',
    'googleadservices.com',
    'googlesyndication.com',
    'pagead2.googlesyndication.com',
    'adservice.google.com',
    'adservice.google.ca',
    'adservice.google.co.uk',
    'adservice.google.de',
    'adservice.google.fr',
    'adservice.google.it',
    'adservice.google.es',
    'adservice.google.co.in',
    'adservice.google.com.au',
    'adservice.google.com.br',
    'adservice.google.co.jp',
    'ads.youtube.com',
    'securepubads.g.doubleclick.net',
    'pubads.g.doubleclick.net',
    'tpc.googlesyndication.com',
    'video-ad-stats.googlesyndication.com',
    'imasdk.googleapis.com',

    // Video Ad Servers & In-Stream / Floating Video Ad Platforms
    'connatix.com',
    'cdx.connatix.com',
    'primis.tech',
    'live.primis.tech',
    'anyclip.com',
    'aniview.com',
    'playwire.com',
    'springserve.com',
    'spotx.tv',
    'spotxchange.com',
    'tremorhub.com',
    'tremorvideo.com',
    'telaria.com',
    'unruly.co',
    'freewheel.tv',
    'fwmrm.net',
    'teads.tv',
    'teads.com',
    'ex.co',
    'vi-serve.com',
    'vdo.ai',
    'brid.tv',
    'vidazoo.com',
    'targetvideo.com',
    'beachfront.com',

    // Major Global Ad Exchanges & Header Bidders
    'adnxs.com',
    'ib.adnxs.com',
    'secure.adnxs.com',
    'criteo.com',
    'criteo.net',
    'static.criteo.net',
    'bidswitch.net',
    'casalemedia.com',
    'openx.net',
    'ox-d.openx.net',
    'pubmatic.com',
    'ads.pubmatic.com',
    'rubiconproject.com',
    'fastlane.rubiconproject.com',
    'smartadserver.com',
    'diff.smartadserver.com',
    'advertising.com',
    'serving-sys.com',
    'bs.serving-sys.com',
    'adroll.com',
    'd.adroll.com',
    'admanmedia.com',
    'sharethrough.com',
    'sovrn.com',
    'lijit.com',
    'gemini.yahoo.com',
    'adtechus.com',
    'adtech.de',
    'exponential.com',
    'tribalfusion.com',
    'yieldmo.com',
    'adcolony.com',
    'adform.net',
    'chartbeat.com',
    'moatads.com',
    'adblade.com',
    'buysellads.com',
    'conversantmedia.com',
    'infolinks.com',
    'resources.infolinks.com',
    'popads.net',
    'popcash.net',
    'propellerads.com',
    'propellerclick.com',
    'trafficjunky.com',
    'exoclick.com',
    'juicyads.com',
    'ero-advertising.com',
    'ad-delivery.net',
    'adlightning.com',
    'adkernel.com',
    'adrecover.com',
    'adsafeprotected.com',
    'innovid.com',
    'flashtalking.com',
    'quantcast.com',
    'scorecardresearch.com',
    'quantserve.com',
    'adhigh.net',
    'adspirit.de',
    'adition.com',
    'yieldlab.net',
    'improvedigital.com',
    'sonobi.com',
    'conversantmedia.net',
    'undertone.com',
    'exponential.net',
    'contextweb.com',
    'mediaforge.com',
    'steelhousemedia.com',
    'steelhouse.com',
    'adserver.yahoo.com',
    'adsonar.com',
    'triplelift.com',
    'gumgum.com',
    'kargo.com',
    'snigel.com',
    'snigelweb.com',

    // Content Recommendation & Native In-Article Ad Networks
    'taboola.com',
    'cdn.taboola.com',
    'trc.taboola.com',
    'outbrain.com',
    'images.outbrain.com',
    'log.outbrain.com',
    'zemanta.com',
    'revcontent.com',
    'trends.revcontent.com',
    'mgid.com',
    'servserv.mgid.com',
    'dianomi.com',
    'content.ad',
    'nativo.com',
    'ezoic.com',
    'g.ezoic.net',
    'media.net',
    'contextual.media.net',
    'mediavine.com',
    'scripts.mediavine.com',
    'adthrive.com',
    'ads.adthrive.com',
    'raptive.com',
    'monumetric.com',
    'adsterra.com',
    'monetag.com',
    'hilltopads.com',
    'clickadu.com',
    'ad-maven.com',

    // Amazon Ad Network
    'amazon-adsystem.com',
    'aax.amazon-adsystem.com',
    'aax-us-east.amazon-adsystem.com',
    'aax-eu.amazon-adsystem.com',
    'c.amazon-adsystem.com',
    's.amazon-adsystem.com',

    // Social & Platform Ad Servers
    'ads.reddit.com',
    'ads.twitter.com',
    'ads-api.twitter.com',
    'ads.tiktok.com',
    'tr.snapchat.com',
    'pixel.facebook.com',
    'an.facebook.com',
    'ads.pinterest.com',
    'ads.linkedin.com',
    'advertising.apple.com'
  ]);

  // Aggressive ad path & query regex patterns
  private static readonly AD_PATTERNS = [
    /\/pagead\//i,
    /\/ad_unit/i,
    /\/adservice\//i,
    /\/adserver\//i,
    /\/ads\?client=/i,
    /\/ads\?correlator=/i,
    /\/ad_type=/i,
    /\/gampad\//i,
    /\/doubleclick\//i,
    /\/api\/stats\/ads/i,
    /\/ptracking\b/i,
    /\/get_midroll_info\b/i,
    /\/v1\/player\/ad_break/i,
    /\/ad_break/i,
    /\/adsystem\//i,
    /\/sponsored-content\//i,
    /\/affiliate-ad\//i,
    /\/bannerads?\//i,
    /\/popunder\b/i,
    /\/popup-ad\b/i,
    /\/video-ads?\//i,
    /\/vast\b/i,
    /\/vpaid\b/i,
    /\/prebid\b/i,
    /\/adsbygoogle/i
  ];

  // High-performance cosmetic element hiding stylesheet (injected into web pages)
  public static readonly COSMETIC_FILTERS_CSS = `
    /* THAAW Browser — Built-in Cosmetic Ad Blocker Rules (Videos, Articles, Sites) */
    ins.adsbygoogle,
    [id^="google_ads_"],
    [id^="div-gpt-ad"],
    [id^="gpt-passback"],
    [id*="-ad-slot"],
    [id*="-ad-banner"],
    [class*="ad-container"],
    [class*="ad-wrapper"],
    [class*="ad-banner"],
    [class*="ad-placement"],
    [class*="ad-slot"],
    [class*="ad-unit"],
    [class*="sponsored-post"],
    [class*="sponsored-story"],
    [class*="promoted-tweet"],
    [data-ad-client],
    [data-ad-slot],
    [data-ad-unit],
    [data-dfp-id],
    [aria-label="advertisement" i],
    [aria-label="sponsored" i],
    .ad-banner,
    .advertisement,
    .ad-leaderboard,
    .ad-rectangle,
    .ad-skyscraper,
    .ad-slot,
    .adsbox,
    .ad_wrapper,

    /* YouTube specific ad containers, promos, and video overlays */
    ytd-ad-slot-renderer,
    ytd-banner-promo-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-statement-banner-renderer,
    .ytp-ad-overlay-container,
    .ytp-ad-message-container,
    .ytp-ad-module,
    .video-ads,
    .ytp-ad-image-overlay,
    .ytp-ad-text-overlay,
    .ytp-ad-preview-container,
    .ytp-ad-action-interstitial,
    .ytp-ad-player-overlay,

    /* News & Article In-Stream / Floating Video Ad Players */
    [id*="connatix"],
    .connatix-container,
    div[class*="connatix"],
    [id*="primis"],
    .primis-player,
    div[class*="primis"],
    [id*="anyclip"],
    .anyclip-widget,
    div[class*="anyclip"],
    .teads-inread,
    div[class*="teads"],
    [id*="vdo_ai"],
    div[class*="vdoai"],
    div[class*="floating-video-ad"],
    div[class*="sticky-video-ad"],
    .video-ad-container,
    .vast-ad-container,
    .ima-ad-container,

    /* In-Article Native Recommendation & Ad Widgets */
    .trc_related_container,
    .trc_rbox_div,
    .taboola-feed-container,
    div[id^="taboola-"],
    .OUTBRAIN,
    .ob-widget,
    .ob-smartfeed-wrapper,
    div[id^="outbrain_"],
    .rc-placeholder,
    div[id^="rc-widget-"],
    .mgid-widget,
    div[id^="mgid-"],
    div[id^="dianomi_"],
    .dianomi-widget,
    div[class*="adthrive"],
    div[id*="adthrive"],
    div[class*="mediavine"],
    div[id*="mediavine"],
    div[class*="ezoic-ad"],
    div[id*="ezoic-pub-ad-"],
    .sponsored-post,
    .sponsored-content,
    [data-ad-placeholder],

    /* Sticky Bottom Banners & Side Anchor Ads */
    .ad-banner-sticky,
    div[class*="sticky-ad"],
    div[class*="ad-anchor"],
    div[id^="sticky-banner-"],
    div[id*="bottom-anchor-ad"] {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      min-height: 0 !important;
      width: 0 !important;
      opacity: 0 !important;
      pointer-events: none !important;
      clip: rect(0, 0, 0, 0) !important;
    }
  `;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public toggleSiteException(origin: string): boolean {
    const domain = this.extractHostname(origin);
    if (this.siteExceptions.has(domain)) {
      this.siteExceptions.delete(domain);
      return true; // Ad blocking active again
    } else {
      this.siteExceptions.add(domain);
      return false; // Ad blocking disabled for this domain
    }
  }

  public isSiteAllowed(origin: string): boolean {
    const domain = this.extractHostname(origin);
    return this.siteExceptions.has(domain);
  }

  public isShieldActive(origin: string): boolean {
    if (!this.enabled) return false;
    return !this.isSiteAllowed(origin);
  }

  /**
   * Evaluates an outbound web request.
   * Returns true if request is an advertisement and should be blocked.
   */
  public shouldBlockAd(requestUrl: string, pageOrigin: string): { block: boolean; reason?: string } {
    if (!this.enabled || !requestUrl || this.isSiteAllowed(pageOrigin)) {
      return { block: false };
    }

    // Fast-path internal and non-network protocols
    if (
      (requestUrl.charCodeAt(0) === 100 && requestUrl.startsWith('data:')) ||
      (requestUrl.charCodeAt(0) === 98 && requestUrl.startsWith('blob:')) ||
      (requestUrl.charCodeAt(0) === 116 && requestUrl.startsWith('thaaw:')) ||
      (requestUrl.charCodeAt(0) === 102 && requestUrl.startsWith('file:')) ||
      requestUrl.startsWith('devtools:') ||
      requestUrl.startsWith('chrome:')
    ) {
      return { block: false };
    }

    try {
      const parsed = new URL(requestUrl);
      const hostname = parsed.hostname.toLowerCase();

      // Don't block first-party requests unless explicitly an ad path on a video network
      if (pageOrigin) {
        try {
          const pageHost = new URL(pageOrigin).hostname.toLowerCase();
          if (hostname === pageHost || hostname.endsWith(`.${pageHost}`)) {
            // Check YouTube video ad stats or pagead endpoints
            if (hostname.includes('youtube.com') && (parsed.pathname.includes('/api/stats/ads') || parsed.pathname.includes('/pagead/'))) {
              this.recordBlock(requestUrl, hostname, 'video-ad', pageOrigin);
              return { block: true, reason: 'YouTube video ad request intercepted' };
            }
            return { block: false };
          }
        } catch {
          // Continue on origin parse error
        }
      }

      // 1. Fast O(depth) hierarchical domain matching against known ad networks
      if (AdBlocker.AD_DOMAINS.has(hostname)) {
        this.recordBlock(requestUrl, hostname, 'ad', pageOrigin);
        return { block: true, reason: `Ad server domain: ${hostname}` };
      }

      const parts = hostname.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        if (AdBlocker.AD_DOMAINS.has(candidate)) {
          this.recordBlock(requestUrl, hostname, 'ad', pageOrigin);
          return { block: true, reason: `Ad network: ${candidate}` };
        }
      }

      // 2. Pattern matching for ad endpoints & query params
      for (const pattern of AdBlocker.AD_PATTERNS) {
        if (pattern.test(parsed.pathname) || pattern.test(parsed.search)) {
          this.recordBlock(requestUrl, hostname, 'banner', pageOrigin);
          return { block: true, reason: 'Matched advertisement URL pattern' };
        }
      }

      return { block: false };
    } catch {
      return { block: false };
    }
  }

  private recordBlock(url: string, domain: string, category: AdBlockEvent['category'], pageOrigin: string): void {
    this.totalBlockedCount++;
    const count = this.siteBlockedStats.get(pageOrigin) || 0;
    this.siteBlockedStats.set(pageOrigin, count + 1);

    const event: AdBlockEvent = {
      url,
      domain,
      category,
      pageOrigin,
      timestamp: Date.now()
    };

    this.recentBlockedAds.unshift(event);
    if (this.recentBlockedAds.length > 50) {
      this.recentBlockedAds.pop();
    }
  }

  public getBlockedCountForSite(origin: string): number {
    return this.siteBlockedStats.get(origin) || 0;
  }

  public getTotalBlockedCount(): number {
    return this.totalBlockedCount;
  }

  public getRecentBlockedEvents(limit: number = 10): AdBlockEvent[] {
    return this.recentBlockedAds.slice(0, limit);
  }

  private extractHostname(urlOrOrigin: string): string {
    try {
      if (urlOrOrigin.includes('://')) {
        return new URL(urlOrOrigin).hostname.toLowerCase();
      }
      return urlOrOrigin.toLowerCase().trim();
    } catch {
      return urlOrOrigin.toLowerCase().trim();
    }
  }
}
