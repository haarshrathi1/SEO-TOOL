import type { ComponentType, ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

type IconComponent = ComponentType<{ className?: string }>;

interface OperatorPageHeroProps {
    icon: IconComponent;
    title: string;
    supportingContent?: ReactNode;
    actions?: ReactNode;
    titleClassName?: string;
    className?: string;
    actionsClassName?: string;
}

export function OperatorPageHero({
    icon: Icon,
    title,
    supportingContent,
    actions,
    titleClassName,
    className,
    actionsClassName,
}: OperatorPageHeroProps) {
    return (
        <div className={cn('operator-panel flex flex-col items-stretch md:flex-row', className)}>
            <div className="operator-accent-block flex min-w-[100px] items-center justify-center border-b-2 p-6 md:border-b-0 md:border-r-2">
                <Icon className="h-10 w-10 text-black" />
            </div>
            <div className="flex flex-1 flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
                <div className="text-center md:text-left">
                    <h2 className={cn('text-4xl font-black uppercase tracking-tighter leading-none text-black', supportingContent ? 'mb-2' : '', titleClassName)}>
                        {title}
                    </h2>
                    {supportingContent}
                </div>
                {actions ? <div className={cn('flex w-full flex-wrap items-center gap-4 md:w-auto', actionsClassName)}>{actions}</div> : null}
            </div>
        </div>
    );
}

interface OperatorStatePanelProps {
    icon: IconComponent;
    title: string;
    description?: ReactNode;
    action?: ReactNode;
    variant?: 'panel' | 'inset' | 'warm';
    align?: 'left' | 'center';
    titleAs?: 'h2' | 'h3' | 'p';
    iconClassName?: string;
    className?: string;
}

export function OperatorStatePanel({
    icon: Icon,
    title,
    description,
    action,
    variant = 'inset',
    align = 'left',
    titleAs = 'h2',
    iconClassName,
    className,
}: OperatorStatePanelProps) {
    const TitleTag = titleAs;
    const panelClassName = variant === 'panel'
        ? 'operator-panel'
        : variant === 'warm'
            ? 'operator-panel-warm'
            : 'operator-panel-inset';
    const leftTitleClassName = titleAs === 'p'
        ? 'text-sm font-black uppercase text-black'
        : 'text-lg font-black uppercase text-black';
    const leftDescriptionClassName = titleAs === 'p'
        ? 'mt-1 text-xs font-bold uppercase text-slate-500'
        : 'mt-1 text-sm font-bold text-slate-600';

    if (align === 'center') {
        return (
            <div className={cn(panelClassName, 'space-y-4 p-8 text-center', className)}>
                <div className="mx-auto flex h-14 w-14 items-center justify-center border-2 border-black bg-yellow-300">
                    <Icon className={cn('h-6 w-6 text-black', iconClassName)} />
                </div>
                <div className="space-y-2">
                    <TitleTag className="text-2xl font-black uppercase text-black">{title}</TitleTag>
                    {description ? <p className="mx-auto max-w-2xl text-sm font-bold text-slate-600">{description}</p> : null}
                </div>
                {action}
            </div>
        );
    }

    return (
        <div className={cn(panelClassName, 'p-6', className)}>
            <div className="flex items-start gap-3">
                <Icon className={cn('mt-0.5 h-5 w-5 flex-shrink-0 text-black', iconClassName)} />
                <div>
                    <TitleTag className={leftTitleClassName}>{title}</TitleTag>
                    {description ? <p className={leftDescriptionClassName}>{description}</p> : null}
                </div>
            </div>
            {action ? <div className="mt-4">{action}</div> : null}
        </div>
    );
}
