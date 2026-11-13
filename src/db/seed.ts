import { CANONICAL_TOPICS, type TopicSlug } from "@/domain/constants";
import type { Db } from "./client";
import { locations, resources, roles, topics } from "./schema";

/** Free, well-known preparation resources per topic. Curated by hand. */
const RESOURCES: Record<TopicSlug, { title: string; url: string }[]> = {
  "data-structures": [
    { title: "NeetCode roadmap", url: "https://neetcode.io/roadmap" },
    {
      title: "Tech Interview Handbook: study cheatsheets",
      url: "https://www.techinterviewhandbook.org/algorithms/study-cheatsheet/",
    },
  ],
  algorithms: [
    { title: "Grind 75 study plan", url: "https://www.techinterviewhandbook.org/grind75/" },
    { title: "VisuAlgo: algorithms animated", url: "https://visualgo.net/en" },
  ],
  "programming-language": [
    { title: "The Python Tutorial", url: "https://docs.python.org/3/tutorial/" },
    { title: "The Modern JavaScript Tutorial", url: "https://javascript.info/" },
  ],
  "object-oriented-design": [
    { title: "Refactoring Guru: design patterns", url: "https://refactoring.guru/design-patterns" },
  ],
  "databases-sql": [
    { title: "SQLBolt: interactive SQL lessons", url: "https://sqlbolt.com/" },
    { title: "Select Star SQL", url: "https://selectstarsql.com/" },
  ],
  "operating-systems": [
    {
      title: "Operating Systems: Three Easy Pieces",
      url: "https://pages.cs.wisc.edu/~remzi/OSTEP/",
    },
  ],
  networking: [
    {
      title: "MDN: an overview of HTTP",
      url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview",
    },
    { title: "High Performance Browser Networking", url: "https://hpbn.co/" },
  ],
  "system-design-basics": [
    {
      title: "The System Design Primer",
      url: "https://github.com/donnemartin/system-design-primer",
    },
  ],
  testing: [
    {
      title: "The Missing Semester: debugging and profiling",
      url: "https://missing.csail.mit.edu/2020/debugging-profiling/",
    },
  ],
  behavioural: [
    {
      title: "Tech Interview Handbook: behavioural interviews",
      url: "https://www.techinterviewhandbook.org/behavioral-interview/",
    },
  ],
  "projects-cv": [
    {
      title: "Tech Interview Handbook: writing your resume",
      url: "https://www.techinterviewhandbook.org/resume/",
    },
  ],
  "online-assessment-format": [
    {
      title: "HackerRank interview preparation kit",
      url: "https://www.hackerrank.com/interview/interview-preparation-kit",
    },
    { title: "LeetCode Explore", url: "https://leetcode.com/explore/" },
  ],
  other: [],
};

const ROLES = [
  { slug: "software-engineering-intern", name: "Software Engineering Intern" },
];

const LOCATIONS = [
  { slug: "dublin", name: "Dublin" },
  { slug: "cork", name: "Cork" },
  { slug: "galway", name: "Galway" },
  { slug: "limerick", name: "Limerick" },
  { slug: "ireland", name: "Ireland (any location)" },
];

/**
 * Reference data every environment needs: topics, the default role, Irish
 * locations and curated resources. Safe to run repeatedly.
 */
export async function seedReference(db: Db): Promise<void> {
  await db
    .insert(topics)
    .values(CANONICAL_TOPICS.map((t) => ({ slug: t.slug, name: t.name })))
    .onConflictDoNothing();
  await db.insert(roles).values(ROLES).onConflictDoNothing();
  await db.insert(locations).values(LOCATIONS).onConflictDoNothing();

  const topicRows = await db.select().from(topics);
  const idBySlug = new Map(topicRows.map((t) => [t.slug, t.id]));
  const rows = Object.entries(RESOURCES).flatMap(([slug, list]) =>
    list.map((r) => ({ topicId: idBySlug.get(slug)!, title: r.title, url: r.url })),
  );
  if (rows.length) await db.insert(resources).values(rows).onConflictDoNothing();
}
