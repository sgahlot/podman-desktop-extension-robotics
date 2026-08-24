import { writable } from 'svelte/store';

export type NavigationLayout = 'sidebar' | 'tabs' | 'cards';

/** Current navigation layout, kept in sync by App.svelte so any page can react to it. */
export const navigationLayout = writable<NavigationLayout>('sidebar');
