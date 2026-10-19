import { COOKIELESS_PRESETS, ConsentIntegrationSchema, type Consent, type ConsentIntegration } from '@sitewright/schema';

/** An analytics tool in the integration registry: any preset (each one is an analytics tool), or a custom script filed under Analytics. */
export const isAnalyticsIntegration = (i: ConsentIntegration): boolean => (i.preset ?? 'custom') !== 'custom' || i.category === 'analytics';

/** Whether a tool waits for the visitor's consent: everything except a cookieless preset set to load without it. */
export const waitsForConsent = (i: ConsentIntegration): boolean => !(i.requireConsent === false && COOKIELESS_PRESETS.includes(i.preset ?? 'custom'));

/** A row the save keeps (the same test cleanConsent applies): named and accepted by the schema. Half-filled rows are not tools yet. */
export const isCompleteIntegration = (i: ConsentIntegration): boolean => !!i.name && ConsentIntegrationSchema.safeParse(i).success;

/** The complete analytics tools the site has. */
export const analyticsTools = (c: Consent | undefined): ConsentIntegration[] => (c?.integrations ?? []).filter((i) => isAnalyticsIntegration(i) && isCompleteIntegration(i));

/** The analytics tools that can never load: they wait for consent, and the consent banner that would give it is off. */
export const stalledAnalytics = (c: Consent | undefined): ConsentIntegration[] => (c?.enabled === true ? [] : analyticsTools(c).filter(waitsForConsent));
