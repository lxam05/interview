# Sources

| Source | Access | Limits and terms | Cost | Freshness | Reliability |
|---|---|---|---|---|---|
| Employer careers pages | Fetched directly, robots.txt respected | Short quotes with a link only | Free | Re-fetched each run; changes become a new version | Highest: labelled "Officially confirmed" |
| GitHub | REST search API (repositories and READMEs) | Without `GITHUB_TOKEN`: very low rate limit | Free | Live | Mixed: interview-prep repos are often generic |
| Hacker News | Public Algolia API | None for this use | Free | Live | Mixed, mostly international |
| Web search | Tavily or Brave API, only with a key | Each provider's API terms | Paid per query | Live | Depends on the page found |
| Student reports | Our own form, with consent | Moderated; names of others removed | Free | As sent | Firsthand once a moderator approves |

## Not used

Enforced in `src/research/source-policy.ts`: results from these sites are dropped at discovery, and the fetcher refuses them (`RESEARCH_SOURCE_EXCLUDED`).

- **Glassdoor**: its terms forbid collection. Not implemented.
- **Indeed and LinkedIn**: terms forbid automated collection. Excluded.
- **People-lookup sites** (RocketReach, ZoomInfo, Apollo, ContactOut, SignalHire, Lusha): personal data, never relevant. Excluded.
- **Reddit**: needs an approved API application. Documented boundary only; not implemented.
- **Taro (jointaro.com)**: publishes Ireland-tagged internship reports. Its terms have not been reviewed, so it is excluded from collection and is at most a link-out until they are. It is also a competitor.

## Rules for every source

- Store the text we retrieved and quote at most a short passage publicly, with a link.
- Never fetch a page robots.txt disallows, and identify ourselves with a generic User-Agent.
- Never fetch private network addresses.
