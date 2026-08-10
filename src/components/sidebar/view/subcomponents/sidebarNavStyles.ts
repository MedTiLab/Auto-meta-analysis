import { cn } from '../../../../lib/utils';

export const sidebarNavButtonClass = (isActive = false) =>
  cn(
    'h-9 w-full justify-start gap-2 rounded-md px-2 font-normal text-foreground',
    'border-0 shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0',
    isActive ? 'bg-muted/70 hover:bg-muted/70' : 'bg-transparent hover:bg-muted/60',
  );

export const sidebarNavListClass = 'space-y-0.5 px-1 py-1 md:px-0 md:py-0';
