import type { Page } from '@sitewright/schema';
import { pageHome } from './home.js';
import { pageWork } from './work.js';
import { pagesServices } from './services.js';
import { pagesAbout } from './about.js';
import { pageContact } from './contact.js';
import { pagesBlog } from './blog.js';
import { pageShop } from './shop.js';
import { pageFaq } from './faq.js';
import { pagesLegal } from './legal.js';
import { pageNavLinks } from './nav-links.js';

/**
 * The English (default-locale) pages, PARENTS BEFORE CHILDREN (the locale scaffold + route
 * computation walk the parent chain). Header-nav order is set per page (`nav.order`); the
 * footer-slot pages (faq/privacy/imprint) fill the chrome's Legal column.
 */
export function pagesEn(assets: Record<string, string>): Page[] {
  return [
    pageHome(assets),
    pageWork(),
    ...pagesServices(),
    ...pagesAbout(assets),
    ...pagesBlog(assets),
    pageContact(),
    pageShop(),
    pageFaq(),
    ...pagesLegal(),
    ...pageNavLinks(),
  ];
}
