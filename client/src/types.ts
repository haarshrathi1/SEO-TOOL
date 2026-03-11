export interface AnalysisData {
    week: string;
    project: string;
    domain: string;
    metrics: {
        clicks: number;
        impressions: number;
        ctr: string;
        visibility: string;
        avgPosition: string;
        engagementRate: string;
        bounceRate?: string;
        avgSessionDuration?: string;
        indexedPages: number;
        notIndexedPages: number;
        psiMobile: number;
        psiDesktop: number;
        lcpDesktop: string;
        clsDesktop: string;
        inpDesktop: string;
        lcpMobile: string;
        clsMobile: string;
        inpMobile: string;
        score: number;
        status: 'Red' | 'Orange' | 'Green';
        alerts?: string[];
    };
    issues: {
        errors: number;
        indexingWarnings: number;
        psiWarnings: number;
        psiNotices: number;
        exactErrors: string;
        failedUrls?: { url: string; reason: string }[];
    };
    keywords: {
        count: number;
        top: string | { keyword: string; impressions: number; clicks: number }[];
    };
    pages: {
        top: string | { url: string; impressions: number; clicks: number }[];
    };
    health: {
        score: number;
        status: 'Red' | 'Orange' | 'Green';
        alerts?: string[];
    };
    score: number;
    status: 'Red' | 'Orange' | 'Green';
    alerts?: string[];
    report?: Record<string, unknown>;
    sheetStatus?: boolean;
    spreadsheetUrl?: string;
}

export interface Project {
    id: string;
    name: string;
    domain: string;
    url: string;
    ga4PropertyId: string;
    spreadsheetId: string;
    sheetGid: number;
    auditMaxPages: number;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface AuthUser {
    email: string;
    role: 'admin' | 'viewer';
    name?: string;
    picture?: string;
    access?: string[];
    projectIds?: string[];
}

export interface ViewerRecord {
    email: string;
    access: string[];
    projectIds: string[];
    createdAt: string;
}

export interface AuthConfigResponse {
    googleClientId: string;
}

export interface AuthSessionResponse {
    user: AuthUser;
}

export interface GoogleLoginResponse {
    user: AuthUser;
}

export interface HistoryItem {
    id: string;
    timestamp: string;
    projectId?: string;
    data: AnalysisData;
}

export interface AIAnalysisResult {
    topic?: string;
    reasoning?: string;
    score?: number;
    suggestedTitle?: string;
    suggestedDescription?: string;
    missingTopics?: string[];
}

export interface PSIData {
    mobile?: {
        score?: number;
        lcp?: string;
        cls?: string;
        inp?: string;
        lighthouseResult?: unknown;
    };
    desktop?: {
        score?: number;
        lcp?: string;
        cls?: string;
        inp?: string;
        lighthouseResult?: unknown;
    };
}

export interface AuditResult {
    url: string;
    status: string;
    coverageState: string;
    indexingState: string;
    lastCrawlTime: string;
    robotStatus: string;
    ga4_views?: number;
    psi_score?: number;
    psi_data?: PSIData;
    title?: string;
    description?: string;
    h1Count?: number;
    wordCount?: number;
    internalLinksOut?: number;
    externalLinksOut?: number;
    incomingLinks?: number;
    brokenLinks?: string[];
}

export interface AuditJobProgress {
    stage: string;
    completed: number;
    total: number;
    percent: number;
    message: string;
    currentUrl?: string;
}

export interface AuditJob {
    id: string;
    projectId: string;
    ownerEmail: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    progress: AuditJobProgress;
    error: string;
    auditHistoryId?: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    result?: AuditResult[] | null;
}

export interface SerpSummary {
    dominantPageType: string;
    secondaryPageType?: string;
    typeConfidence?: string;
    brandPressureIndex?: number;
    brandVsIndieRatio: string;
    avgContentLengthBucket: string;
    avgContentLength?: string;
    freshnessBias: string;
    freshness?: string;
    intentClarity: string;
    volumeScore?: number;
    volumeBreakdown?: {
        autocompleteDensity: number;
        serpFeatures: number;
        trendDirection: number;
        ugcFrequency: number;
    };
}

export interface KeywordData {
    seed: string;
    projectId?: string | null;
    serp: { title: string; url: string; snippet: string }[];
    serpSummary?: SerpSummary;
    analysis: {
        difficulty: { score: number; reason: string };
        viability?: { soloCreator: string; smallBusiness: string; brand: string };
        recommendedStrategy?: {
            format: string;
            angle: string;
            avoid: string;
            timeToImpact: string;
            confidence: 'High' | 'Medium' | 'Low';
        };
        alternativeStrategy?: {
            angle: string;
            reason: string;
        };
        clusters: { name: string; keywords: { term: string; intent: string; vol: string }[] }[];
        contentGap: string;
    };
}

export interface SavedResearch extends KeywordData {
    id: string;
    timestamp: string;
    ownerEmail?: string;
}

export interface SerpDnaProfile {
    serpPersonality: string;
    googleWants: string;
    contentFormatDominance: string[];
    eatSignals: {
        experience: string;
        expertise: string;
        authority: string;
        trust: string;
    };
    topicalAuthority: string;
    contentGaps: string[];
    rankerProfile: string;
    difficultyVerdict: string;
    opportunityAngle: string;
}

export interface IntentDecomposition {
    primaryIntent: string;
    intentSpectrum: {
        know: number;
        do: number;
        go: number;
        buy: number;
        compare: number;
        learn: number;
    };
    buyerJourney: {
        awareness: number;
        consideration: number;
        decision: number;
        retention: number;
    };
    microIntents: {
        intent: string;
        strength: 'High' | 'Medium' | 'Low';
        example_query: string;
    }[];
    intentInsight: string;
    contentAngle: string;
}

export interface KeywordItem {
    term: string;
    intent: string;
    volume: 'High' | 'Medium' | 'Low';
    difficulty: 'Easy' | 'Medium' | 'Hard';
    opportunityScore: number;
    source: string;
    buyerStage: string;
}

export interface KeywordUniverse {
    totalKeywords: number;
    keywords: KeywordItem[];
    questionKeywords: {
        question: string;
        intent: string;
        volume: 'High' | 'Medium' | 'Low';
    }[];
    lsiTerms: string[];
    longTailGems: {
        term: string;
        reason: string;
        opportunityScore: number;
    }[];
}

export interface StrategicCluster {
    name: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    intent: string;
    keywords: {
        term: string;
        intent: string;
        volume: string;
        opportunityScore: number;
    }[];
    contentFormat: string;
    estimatedTraffic: 'High' | 'Medium' | 'Low';
}

export interface QuickWin {
    keyword: string;
    reason: string;
    action: string;
    timeToRank: string;
}

export interface ContentBlueprint {
    primaryFormat: string;
    wordCountTarget: string;
    uniqueAngle: string;
    mustInclude: string[];
    avoid: string[];
    timeToImpact: string;
    confidence: 'High' | 'Medium' | 'Low';
}

export interface StrategicSynthesis {
    difficulty: {
        score: number;
        label: string;
        reason: string;
    };
    viability: {
        soloCreator: { verdict: string; reason: string };
        smallBusiness: { verdict: string; reason: string };
        brand: { verdict: string; reason: string };
    };
    clusters: StrategicCluster[];
    quickWins: QuickWin[];
    contentBlueprint: ContentBlueprint;
    alternativeStrategy: {
        angle: string;
        reason: string;
        keywords: string[];
    };
    contentGap: string;
    executionPriority: string[];
}

export interface SerpRawData {
    paaQuestions: {
        question: string;
        snippet: string;
        title: string;
        link: string;
    }[];
    relatedSearches: string[];
    knowledgeGraph: {
        title: string;
        type: string;
        description: string;
    } | null;
    serpFeatures: string[];
    totalResults: number;
}

export interface KeywordDataV2 {
    seed: string;
    projectId?: string | null;
    serp: { title: string; url: string; snippet: string; position?: number; displayed_link?: string; sitelinks?: boolean }[];
    serpRaw: SerpRawData;
    serpSummary: SerpSummary;
    serpDna: SerpDnaProfile;
    intentData: IntentDecomposition;
    keywordUniverse: KeywordUniverse;
    strategy: StrategicSynthesis;
    analysis: KeywordData['analysis'];
    metadata: {
        model: string;
        layers: number;
        timestamp: string;
    };
}

export interface SavedResearchV2 extends KeywordDataV2 {
    id: string;
    timestamp: string;
    ownerEmail?: string;
}

export type KeywordHistoryItem = SavedResearch | SavedResearchV2;

export interface KeywordScanResult {
    url: string;
    totalWords: number;
    topKeywords: {
        keyword: string;
        count: number;
        density: string;
    }[];
}

export interface MetricDelta {
    label: string;
    current: string | number;
    previous: string | number;
    delta: number;
    direction: 'up' | 'down' | 'flat';
}
