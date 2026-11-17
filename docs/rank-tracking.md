# Keyword rank tracking

Statistics → Search rankings shows where a site places in Google for the keywords agency staff track: one check
per keyword per day or week, kept as a history. Agents read the same data with `get_rankings`.

- **Who does what:** instance admins choose the provider that runs the searches, enter its credentials and set a
  monthly budget (System Settings → Integrations → Keyword rank tracking). Agency staff choose each project's
  domain, depth, schedule and keywords. Everyone with access to the project, clients included, reads the results.
- **What a check is:** one Google search for one keyword, from one place (a country, or a city), on one device, in
  one language, looking as far as the project's depth: the top 10, 20, 50 or 100 results.

## How far a check reads

A check reads the results a few pages at a time, and asks for more only while the site has not turned up:

| Depth | Pages read, in turn | Most a check costs |
|---|---|---|
| Top 10 | 1 | 1 page |
| Top 20 | 1, then 2 | 2 pages |
| Top 50 | 1, then 2, then 3–5 | 5 pages |
| Top 100 | 1, then 2, then 3–5, then 6–10 | 10 pages |

A site on the first page costs one page whatever the depth; the depth only sets how far a check goes when the site is
not found. A check also stops where Google stops serving results. Positions on later pages count on from the pages
before, so they read as they would in one long list.

Each stage is booked against the monthly budget before it is sent, on top of what the stages before it cost. When
the budget runs out partway, the check waits. Once its day is over and six hours have passed since its last stage, it
is recorded with what it read: "Not in the 20 results read". A provider that answers at once (Bright Data) usually
reads every stage in one pass. A provider with a queue (DataForSEO, Apify) sends each next stage when it collects the
one before, so a check of a deep keyword takes a few passes. After "Check now", Sitewright looks again 1, 3, 6, 10,
15, 20, 30, 45 and 60 minutes later.

Projects set to Top 30, which is no longer offered, were moved to Top 50.

## What a position means

- **Positions count the way Google and Search Console count them.** Position 1 is the first result. A featured
  snippet (the answer box at the top) counts as a result: when the site holds it, its position is 1, marked
  "featured snippet". The ordinary results after someone else's snippet start at 2.
- **"Not in the top 100"** means Google returned all the results the check asked for, and the site was not among
  them.
- **"Not in the 30 results read"** means the check read fewer results than its depth. Usually Google stopped
  serving results early: since September 2025 it returns results ten at a time and often stops after a few pages, so
  a check of the top 100 can end after 30. It also happens when the budget ran out before the check could read
  further that day. The site may be just below them; the chart shows such a check as a dashed mark below the
  results that were read, not as a fall to the bottom.
- **Positions move.** Each check is one search from one place at one moment, not what every searcher sees. A site
  that Google has only recently started showing, and keywords that few people search for, move by many places from
  day to day. The trend over a few weeks says more than one day's change.

Earlier versions counted neither featured snippets nor short result lists. DataForSEO keeps its results for 30
days, so the checks of the last 29 days are read again after the update, at no cost. Older checks keep the earlier
reading, so a keyword's change across that boundary can be off by one place.

## Providers

| | Bright Data | DataForSEO | Apify |
|---|---|---|---|
| Service | SERP API | Google Organic SERP API, standard queue | Google Search Results Scraper (`apify/google-search-scraper`) |
| Searches from | A connection in the keyword's country | Its own servers, telling Google the place | A connection in the keyword's country |
| Price per results page | $0.0015 on pay as you go, after 5,000 free requests a month. Failed requests are free. | $0.0006. Pages Google never served are refunded. | $0.0035 on the listed rate, less on paid plans. The budget books that rate and then the run's real charge. |
| Answers | At once | Within minutes | Within minutes |
| Places | Countries. Keywords already tracked for a city keep it; new ones are tracked by country. | Countries and every city or region in Google's list, with a search box | Countries. Keywords already tracked for a city keep it; new ones are tracked by country. |
| Credentials | API key and SERP API zone (and, optionally, the price per 1,000 requests) | API login and API password | API token |
| Sandbox | None | Free dummy results, for trying the setup | None |

**Where the search comes from matters.** For a site in a small market, Google ranks by where the searcher really is.
Telling it the place is not enough. On 17 November 2026, a Namibian company's exact name was its #1 result for
someone in Namibia and on Apify. DataForSEO's results did not include the site among 84 results. Their first result
was `om.linkedin.com`, the LinkedIn subdomain Google shows searchers in Oman. Targeting Windhoek by name, by GPS
coordinates or through google.com.na did not change that. With a place name in the keyword ("website development
namibia"), targeting the city did bring DataForSEO's top 10 close to the local one. Bright Data's and Apify's searches
run through connections in the country and matched what people there see.

### Bright Data

Each results page is one request, answered at once, through a connection in the keyword's country. The budget books
each page at $1.50 per 1,000, or at the price entered in **Price per 1,000 requests**, which must be above zero for
the budget to count anything. Bright Data reports no price with a result, and every account's 5,000 free requests a
month cost nothing. "Test saved credentials" checks the API key and the zone, and shows the account balance when the
key may read it.

- **Zone settings:** in the SERP API zone's Configuration, set the default data format to **Full JSON**; Light JSON
  leaves out featured snippets. Set Google Ads to **Standard**. Leave custom headers and cookies off, because with
  them Bright Data bills failed requests too, and leave asynchronous requests off. The zone field in System Settings
  says the same.
- **Google's redirect links:** Google wraps some results in its own redirect, `google.com/goto?url=…`, and on some
  pages every result. Sitewright reads such a result by the address Google shows under it. When that address is cut
  short by a breadcrumb ("site.na › services › …"), the ranking page is recorded as the site's home page.
- **Empty answers:** some searches come back empty, when Google challenged Bright Data's connection with a captcha.
  On 17 November 2026 that was about one request in four for some searches. An empty answer is not billed, and the
  page is tried again twice, 16 seconds apart, as Bright Data advises. A search refused for a moment ("this query
  recently failed") is tried again the same way.
- **A request Bright Data could not run** (refused for its place, say) is not billed. That search fails for the day
  and is tried again the next; the others go on.
- **Results vary between requests.** The same search a few minutes apart, through two connections, can put the site
  on page 2 or leave it out of a shorter list. That is Google's answer to each request, not a fault in the reading.
- **A reply that was lost, or came back but could not be read,** may have been billed, and is booked.
- **A refusal for the whole account** (the key, funds, the rate limit) stops the rest. A search that had read some
  pages keeps them and reads on from there later. One not yet sent is given back and sent on a later pass, and the
  refusal shows under Keyword rank tracking.

### Apify

Searches that share every setting go to Apify as one run. Each run is capped at twice its estimated cost, or at
$0.50 when that is more, because Apify refuses to start a run capped any lower. The budget books a run's estimate
when it starts and its real charge once it has finished. A run is charged per results page, so it costs about its
estimate. The cap only stops one that misbehaves, and such a run of a few searches could cost up to $0.50 before its
charge is known.

Measured against the real service on 17 November 2026:

- **Speed:** a run of three searches of ten pages each finished in about five minutes.
- **Price:** that run read 26 results pages and cost $0.06255: 25 pages at $0.0025 on that account's plan, plus
  $0.00005 for starting the run. The last page came back empty and was not charged. The budget books the listed
  rate of $0.0035 a page until the real charge is known.
- **Positions:** Apify numbers results without restarting on each page. Sitewright counts them itself and gets
  the same numbers. Apify has no page offset of its own: later pages are asked for as a Google search URL with
  `start=`, which it fetches as asked (`start=10` returned page 2 alone, charged as one page).
- **Google's Map link:** on searches that show a map, Apify lists Google's own "Map" link as the first result.
  Sitewright does not count it: counting it added one to every position after it.
- **Featured snippets:** none of the records had a field for one. On searches that usually show a snippet,
  Google showed an AI Overview instead. Whether Apify reports a featured snippet at all is not documented. If one
  shows the site and Apify leaves it out, that day reads as not found, as DataForSEO checks did before snippets
  were counted.

Switching provider keeps every keyword and its history: each check records which provider ran it, and Sitewright
works out the position itself, the same way for both. One caveat: a keyword added under Apify stores the country's
English name (such as "Türkiye"), which can differ from the name in Google's list that DataForSEO expects. After a
switch to DataForSEO, such a keyword's checks fail until its location is chosen again from DataForSEO's list.
