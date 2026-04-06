const {
    GOOGLE_ADS_PROVIDER,
    GOOGLE_ADS_PROVIDER_LABEL,
    fetchGoogleAdsSnapshot,
    getGoogleAdsProviderConfig,
} = require('./googleAdsKeywordIdeas');

function getKeywordAdsProviderConfigs() {
    return [getGoogleAdsProviderConfig()];
}

function getPreferredKeywordAdsProviderConfig() {
    return getGoogleAdsProviderConfig() || {
        provider: GOOGLE_ADS_PROVIDER,
        providerLabel: GOOGLE_ADS_PROVIDER_LABEL,
        configured: false,
        reason: 'not_configured',
    };
}

async function fetchLiveKeywordAdsSnapshot(seed, context = {}, options = {}) {
    return fetchGoogleAdsSnapshot(seed, context, options);
}

module.exports = {
    GOOGLE_ADS_PROVIDER,
    GOOGLE_ADS_PROVIDER_LABEL,
    fetchLiveKeywordAdsSnapshot,
    getKeywordAdsProviderConfigs,
    getPreferredKeywordAdsProviderConfig,
};
