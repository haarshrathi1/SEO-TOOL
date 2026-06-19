import type { Project } from './types';

type ProjectSetupProject = Pick<Project, 'googleConnectionEmail' | 'gscSiteUrl' | 'ga4PropertyId'>;

interface ProjectSetupOptions {
    requiresGoogleConnection?: boolean;
    googleConnected?: boolean;
}

function hasText(value: string | null | undefined) {
    return typeof value === 'string' && value.trim().length > 0;
}

export function isProjectReady(project: ProjectSetupProject | null | undefined, options: ProjectSetupOptions = {}) {
    if (!project) {
        return false;
    }

    if (!hasText(project.googleConnectionEmail) || !hasText(project.gscSiteUrl) || !hasText(project.ga4PropertyId)) {
        return false;
    }

    if (options.requiresGoogleConnection && !options.googleConnected) {
        return false;
    }

    return true;
}

export function getProjectSetupIssues(project: ProjectSetupProject | null | undefined, options: ProjectSetupOptions = {}) {
    const issues: string[] = [];

    if (!hasText(project?.googleConnectionEmail)) {
        issues.push('Connect Google');
    } else if (options.requiresGoogleConnection && !options.googleConnected) {
        issues.push('Reconnect Google');
    }

    if (!hasText(project?.gscSiteUrl)) {
        issues.push('Select Search Console');
    }

    if (!hasText(project?.ga4PropertyId)) {
        issues.push('Select GA4');
    }

    return issues;
}
