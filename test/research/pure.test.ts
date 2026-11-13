import { describe, expect, it } from "vitest";
import { EVIDENCE_LABELS } from "@/domain/constants";
import { canonicalUrl, groupDuplicates, nameKey, textSimilarity } from "@/research/dedupe";
import { evaluate } from "@/research/evaluate";
import { assertFetchableUrl, isPublicAddress } from "@/research/fetch-guard";
import { buildKeywordQueries, buildQueries } from "@/research/queries";
import { normaliseForQuote, quoteAppearsIn } from "@/research/quote";
import { buildBriefContent, rankTopics } from "@/research/synthesise";
import type { EvidenceClaim } from "@/research/types";

const NOW = new Date("2026-11-01");

let nextId = 1;
function ev(over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: nextId++,
    type: "topic",
    statement: "Asked about trees.",
    quote: "asked about trees",
    topics: ["data-structures"],
    stage: "technical_interview",
    roleLevel: "intern",
    region: "ireland",
    firsthand: true,
    interviewYear: 2026,
    interviewMonth: 3,
    durationMinutes: null,
    sourceKey: "source:1",
    platform: "web",
    sourcePublishedAt: null,
    ...over,
  };
}

describe("quote check", () => {
  it.each([
    ["curly quotes", "He said “use a hash map” today", 'he said "use a hash map" today'],
    ["apostrophes", "the interviewer’s first question", "the interviewer's first question"],
    ["dashes", "a 45–minute technical round", "a 45-minute technical round"],
    ["whitespace", "two   coding\n questions were asked", "two coding questions were asked"],
    ["non-breaking space", "90 minutes for the test", "90 minutes for the test"],
    ["case", "Online Assessment On HackerRank", "online assessment on hackerrank"],
  ])("matches despite %s", (_name, inDocument, quote) => {
    expect(quoteAppearsIn(quote, `Intro. ${inDocument}. Outro.`)).toBe(true);
  });

  it("rejects a quote that is not in the document", () => {
    expect(quoteAppearsIn("asked a dynamic programming question", "We talked about arrays.")).toBe(false);
  });

  it("rejects quotes too short to prove anything", () => {
    expect(quoteAppearsIn("arrays", "We talked about arrays.")).toBe(false);
  });

  it("normalises to one form", () => {
    expect(normaliseForQuote("  A—B…  ")).toBe("a-b...");
  });
});

describe("de-duplication", () => {
  it("gives every spelling of an address one canonical form", () => {
    const forms = [
      "http://www.Example.com/post/?utm_source=x&b=2&a=1#top",
      "https://example.com/post?a=1&b=2",
      "https://m.example.com/post/?b=2&a=1&fbclid=abc",
    ];
    expect(new Set(forms.map(canonicalUrl)).size).toBe(1);
  });

  it("treats a repost with a header as a copy, and a different report as separate", () => {
    const original =
      "I interviewed for the internship in Dublin last October and the first step was an online assessment with two questions about arrays and hash maps followed by a technical interview about binary trees and a behavioural round with the hiring manager about teamwork.";
    const different =
      "My process in February had a breadth first search question on a grid then a SQL join question and finally they asked me to walk through my final year project and what I would change about it next time.";
    expect(textSimilarity(original, `Reposted from a blog. ${original}`)).toBeGreaterThan(0.8);
    expect(textSimilarity(original, different)).toBeLessThan(0.2);
    const groups = groupDuplicates([
      { key: "a", text: original },
      { key: "b", text: `Reposted. ${original}` },
      { key: "c", text: different },
    ]);
    expect(groups.get("b")).toBe("a");
    expect(groups.get("c")).toBe("c");
  });

  it("matches company names across suffixes and punctuation", () => {
    expect(nameKey("Stripe, Inc.")).toBe(nameKey("stripe"));
    expect(nameKey("Workday Ireland Limited")).toBe(nameKey("Workday"));
  });
});

describe("evidence labels", () => {
  it("can reach every label", () => {
    const cases: Record<string, EvidenceClaim[]> = {
      insufficient: [],
      official: [ev({ platform: "official", type: "official_policy", firsthand: false })],
      multiple_reports: [ev({ sourceKey: "source:1" }), ev({ sourceKey: "source:2" })],
      single_report: [ev()],
      historical: [ev({ interviewYear: 2022 })],
      international: [ev({ region: "international" })],
      unverified: [ev({ firsthand: false })],
    };
    for (const label of EVIDENCE_LABELS) {
      expect(evaluate(cases[label], NOW).label, label).toBe(label);
    }
  });

  it("counts copies of one report as one source", () => {
    const group = evaluate([ev({ sourceKey: "source:1" }), ev({ sourceKey: "source:1" })], NOW);
    expect(group.label).toBe("single_report");
    expect(group.independentReports).toBe(1);
  });

  it("never treats a graduate or foreign report as direct evidence", () => {
    const group = evaluate(
      [ev({ roleLevel: "graduate", sourceKey: "source:1" }), ev({ region: "international", sourceKey: "source:2" })],
      NOW,
    );
    expect(group.label).toBe("international");
  });

  it("does not treat an unknown role level or region as direct", () => {
    expect(evaluate([ev({ roleLevel: "unknown" })], NOW).label).toBe("unverified");
    expect(evaluate([ev({ region: "unknown" })], NOW).label).toBe("unverified");
  });

  it("turns historical exactly after 24 months", () => {
    // NOW is November 2026: November 2024 is 24 months back, October 2024 is 25.
    expect(evaluate([ev({ interviewYear: 2024, interviewMonth: 11 })], NOW).label).toBe("single_report");
    expect(evaluate([ev({ interviewYear: 2024, interviewMonth: 10 })], NOW).label).toBe("historical");
  });

  it("falls back to the publication date when no interview date is stated", () => {
    const old = ev({ interviewYear: null, interviewMonth: null, sourcePublishedAt: new Date("2021-05-01") });
    expect(evaluate([old], NOW).label).toBe("historical");
    expect(evaluate([old], NOW).newestYear).toBeNull();
  });
});

describe("ranking and brief building", () => {
  const catalogue = {
    topicNames: new Map([
      ["data-structures", "Data structures"],
      ["databases-sql", "Databases and SQL"],
      ["system-design-basics", "System design basics"],
      ["other", "Other"],
    ]),
    resources: new Map([["data-structures", [{ title: "A", url: "https://a.example/1" }]]]),
  };

  it("orders by evidence strength, then recency, with Other last", () => {
    const claims = [
      ev({ topics: ["other"], sourceKey: "source:1" }),
      ev({ topics: ["other"], sourceKey: "source:2" }),
      ev({ topics: ["system-design-basics"], region: "international" }),
      ev({ topics: ["databases-sql"], sourceKey: "source:3", interviewYear: 2025 }),
      ev({ topics: ["data-structures"], sourceKey: "source:1" }),
      ev({ topics: ["data-structures"], sourceKey: "source:2" }),
    ];
    const content = buildBriefContent({ claims, ...catalogue, now: NOW });
    expect(content.topics.map((t) => t.topicSlug)).toEqual([
      "data-structures",
      "databases-sql",
      "system-design-basics",
      "other",
    ]);
    expect(content.topics.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
  });

  it("gives the same order for the same claims in any input order", () => {
    const claims = [
      ev({ topics: ["databases-sql"] }),
      ev({ topics: ["data-structures"], sourceKey: "source:1" }),
      ev({ topics: ["data-structures"], sourceKey: "source:2" }),
    ];
    const a = buildBriefContent({ claims, ...catalogue, now: NOW });
    const b = buildBriefContent({ claims: [...claims].reverse(), ...catalogue, now: NOW });
    expect(b.topics.map((t) => t.topicSlug)).toEqual(a.topics.map((t) => t.topicSlug));
  });

  it("cites only claims it was given and keeps official and candidate stages apart", () => {
    const official = ev({
      type: "official_policy",
      platform: "official",
      firsthand: false,
      topics: [],
      stage: "online_assessment",
      statement: "There is an online test.",
    });
    const candidate = ev({ type: "format", topics: [], stage: "online_assessment", durationMinutes: 90 });
    const content = buildBriefContent({ claims: [official, candidate], ...catalogue, now: NOW });
    expect(content.stages.map((s) => s.origin)).toEqual(["official", "candidate"]);
    expect(content.stages[1].durationMinutes).toBe(90);
    const given = new Set([official.id, candidate.id]);
    for (const s of content.stages) for (const id of s.claimIds) expect(given.has(id)).toBe(true);
  });

  it("uses a supplied rationale and otherwise a template that adds no facts", () => {
    const claims = [ev({ topics: ["data-structures"] })];
    const plain = buildBriefContent({ claims, ...catalogue, now: NOW });
    expect(plain.topics[0].why).toContain("One candidate report");
    const custom = buildBriefContent({
      claims,
      ...catalogue,
      now: NOW,
      rationales: new Map([["data-structures", "Candidates report tree questions."]]),
    });
    expect(custom.topics[0].why).toBe("Candidates report tree questions.");
  });

  it("always says what is not known", () => {
    const content = buildBriefContent({ claims: [ev()], ...catalogue, now: NOW });
    expect(content.limitations.join(" ")).toContain("no description of the process published by the employer");
  });

  it("rankTopics is stable for ties", () => {
    const group = evaluate([ev()], NOW);
    const ranked = rankTopics([
      { slug: "b", name: "B", group },
      { slug: "a", name: "A", group },
    ]);
    expect(ranked.map((t) => t.slug)).toEqual(["a", "b"]);
  });
});

describe("fetch guard", () => {
  it.each([
    "http://127.0.0.1/admin",
    "http://localhost:3000/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "https://user:pass@example.com/",
    "http://service.internal/",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => assertFetchableUrl(url)).toThrowError(
      expect.objectContaining({ code: "RESEARCH_BLOCKED_ADDRESS" }),
    );
  });

  it("allows ordinary public addresses", () => {
    expect(assertFetchableUrl("https://example.com/post").hostname).toBe("example.com");
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("172.16.0.1")).toBe(false);
    expect(isPublicAddress("fd00::1")).toBe(false);
  });
});

describe("queries", () => {
  const input = { company: "Acme", aliases: ["Acme Corp"], role: "Software Engineering Intern", location: "Dublin", cycle: null };

  it("covers the company's names, the place and the year without duplicates", () => {
    const queries = buildQueries(input, 2026);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries.some((q) => q.includes("Acme Corp"))).toBe(true);
    expect(queries.some((q) => q.includes("Dublin") && q.includes("2026"))).toBe(true);
    expect(queries.length).toBeLessThanOrEqual(10);
  });

  it("uses Ireland when no city is given", () => {
    expect(buildQueries({ ...input, location: null }, 2026)[0]).toContain("Ireland");
    expect(buildKeywordQueries(input).length).toBeGreaterThan(0);
  });
});
