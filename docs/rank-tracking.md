# Keyword rank tracking

Statistics → Search rankings shows where a site places in Google for the keywords agency staff track: one check
per keyword per day or week, kept as a history. Agents read the same data with `get_rankings`.

- **Who does what:** instance admins choose the provider that runs the searches, enter its credentials and set a
  monthly budget (System Settings → Integrations → Keyword rank tracking). Agency staff choose each project's
  domain, depth, schedule and keywords. Everyone with access to the project, clients included, reads the results.
- **What a check is:** one Google search for one keyword, from one place (a country, or a city), on one device, in
  one language, read to a depth of 10 to 100 results.

## What a position means

- **Positions count the way Google and Search Console count them.** Position 1 is the first result. A featured
  snippet (the answer box at the top) counts as a result: when the site holds it, its position is 1, marked
  "featured snippet". The ordinary results after someone else's snippet start at 2.
- **"Not in the top 100"** means Google returned all the results the check asked for, and the site was not among
  them.
- **"Not in the 30 results returned"** means Google stopped serving results early. Since September 2025, Google
  returns results ten at a time and often stops after a few pages, so a check that asked for 100 can come back with
  30. The site may be just below them; the chart shows such a check as a dashed mark below the results that came
  back, not as a fall to the bottom.
- **Positions move.** Each check is one search from one place at one moment, not what every searcher sees. A site
  that Google has only recently started showing, and keywords that few people search for, move by many places from
  day to day. The trend over a few weeks says more than one day's change.

Earlier versions counted neither featured snippets nor short result lists. DataForSEO keeps its results for 30
days, so the checks of the last 29 days are read again after the update, at no cost. Older checks keep the earlier
reading, so a keyword's change across that boundary can be off by one place.

## Providers

| | DataForSEO | Apify |
|---|---|---|
| Service | Google Organic SERP API, standard queue | Google Search Results Scraper (`apify/google-search-scraper`) |
| Price | $0.0006 per page of ten results, so $0.006 for a depth of 100 | Per results page: $3.50 per 1,000 pages on the listed rate, less on paid plans. The budget books that rate and then the run's real charge. |
| Places | Countries and every city or region in Google's list, with a search box | Countries. Keywords already tracked for a city keep it; new ones are tracked by country. |
| Credentials | API login and API password | API token |
| Sandbox | Free dummy results, for trying the setup | None |

Searches that share every setting go to Apify as one run. Each run is capped at twice its estimated cost, so a
misbehaving run cannot spend past the budget's reach.

Switching provider keeps every keyword and its history: each check records which provider ran it, and Sitewright
works out the position itself, the same way for both. One caveat: a keyword added under Apify stores the country's
English name (such as "Türkiye"), which can differ from the name in Google's list that DataForSEO expects. After a
switch to DataForSEO, such a keyword's checks fail until its location is chosen again from DataForSEO's list.
