import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_ENV } from "./env";

/*
 * The main journey, end to end, in one browser session:
 * search -> empty state -> send a report -> sign in -> add the internship ->
 * queue research -> worker runs it -> review claims -> approve the report ->
 * build and publish a brief -> see it publicly -> report an error -> see it
 * in the corrections queue.
 */

const COMPANY = "E2E Test Co";
const SLUG = "e2e-test-co";
const PROGRAMME = "software-engineering-intern-dublin";

test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for you" })).toBeVisible();
}

test("a student report becomes a published, sourced brief", async ({ page }) => {
  // 1. Search finds nothing yet and points to the report form.
  await page.goto("/");
  await page.getByLabel("What should I study for my").fill(COMPANY);
  await page.getByRole("button", { name: "Find the brief" }).click();
  await expect(page.getByRole("heading", { name: `Nothing yet for “${COMPANY}”` })).toBeVisible();
  // The link in the empty state carries the company name into the form.
  await page.locator('main a[href^="/contribute?company="]').click();

  // 2. Send a report. The company is prefilled from the search.
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(COMPANY);
  await page.getByLabel("Where the role was based").fill("Dublin");
  await page.getByLabel("Month of the interview").selectOption("2");
  await page.getByLabel("Stage", { exact: true }).selectOption("online_assessment");
  await page.getByLabel("Format", { exact: true }).fill("HackerRank, 90 minutes, two coding questions");
  await page.getByLabel("Data structures").check();
  await page.getByLabel("Algorithms").check();
  await page.getByLabel("What came up, in your words").fill("A hash map counting question and a breadth-first search on a grid.");
  await page.getByLabel("One piece of advice for the next student").fill("Practise timed problems beforehand.");
  await page.getByLabel(/I took part in this interview/).check();
  // Real people take more than three seconds; faster posts are dropped as bots.
  await page.waitForTimeout(3_200);
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("heading", { name: "Report sent. Here is yours, organised." })).toBeVisible();
  await expect(page.getByText(`Online assessment at ${COMPANY}`)).toBeVisible();
  await expect(page.getByText("Topics you saw: Data structures, Algorithms")).toBeVisible();

  // 3. The review desk is closed to signed-out visitors and rejects a wrong password.
  await page.goto("/admin/submissions");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That password is not right.")).toBeVisible();
  await signIn(page);
  await expect(page.getByRole("link", { name: "student reports to moderate" })).toBeVisible();

  // 4. Add the internship.
  await page.getByLabel("Company", { exact: true }).fill(COMPANY);
  await page.getByLabel("Location", { exact: true }).selectOption("dublin");
  await page.getByRole("button", { name: "Add internship" }).click();
  await expect(page.getByText(`${COMPANY} is set up.`)).toBeVisible();
  await expect(page.getByRole("heading", { name: COMPANY, level: 1 })).toBeVisible();
  const programmeUrl = page.url().split("?")[0];

  // 5. Queue research; the worker carries it out.
  await page.getByRole("button", { name: "Run research" }).click();
  await expect(page.getByText(/Research queued/)).toBeVisible();
  await expect(page.getByText("queued", { exact: true })).toBeVisible();
  execFileSync("npx", ["tsx", "e2e/fixture-worker.ts"], { env: { ...process.env, ...E2E_ENV }, stdio: "pipe" });
  await page.reload();
  await expect(page.getByText("succeeded", { exact: true }).first()).toBeVisible();

  // 6. Review claims beside their sources: reject one, approve the rest.
  await page.goto(programmeUrl);
  await expect(page.getByRole("heading", { name: "Claims, beside their sources" })).toBeVisible();
  const firstClaim = page.locator("li[id^=claim-]").first();
  await firstClaim.getByRole("button", { name: "Reject" }).click();
  await page.waitForURL(/done=/);
  await expect(page.getByText(/Claim \d+ rejected\./)).toBeVisible();
  // Each decision redirects back with a fresh ?done= message; wait for it before the next.
  const decide = async (button: ReturnType<Page["getByRole"]>, done: RegExp) => {
    await page.goto(programmeUrl);
    await button.first().click();
    await page.waitForURL(/done=/);
    await expect(page.getByText(done)).toBeVisible();
  };
  const approveAll = page.getByRole("button", { name: /^Approve all \d+$/ });
  for (let i = 0; i < 20; i++) {
    await page.goto(programmeUrl);
    if (!(await approveAll.count())) break;
    await decide(approveAll, /\d+ claims approved\./);
  }
  const waiting = page.locator("li[id^=claim-]").filter({ hasText: "extracted" });
  for (let i = 0; i < 40; i++) {
    await page.goto(programmeUrl);
    if (!(await waiting.count())) break;
    await decide(waiting.getByRole("button", { name: "Approve", exact: true }), /Claim \d+ approved\./);
  }
  await page.goto(programmeUrl);
  await expect(waiting).toHaveCount(0);
  await expect(page.locator("li[id^=claim-]").filter({ hasText: "rejected" })).toHaveCount(1);

  // 7. Approve the student report as evidence for this internship.
  await page.getByRole("link", { name: "Student reports" }).click();
  await expect(page.getByRole("heading", { name: `${COMPANY}: Online assessment` })).toBeVisible();
  await expect(page.getByLabel("Internship it is about")).toHaveValue(/\d+/);
  await page.getByRole("button", { name: "Approve as evidence" }).click();
  await expect(page.getByText(/Report 1 approved as 4 claims/)).toBeVisible();

  // 8. Build a draft and publish it.
  await page.goto(programmeUrl);
  await page.getByRole("button", { name: "Build draft from approved claims" }).click();
  await expect(page.getByText(/Draft built from the approved claims/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Topics, in ranked order" })).toBeVisible();
  await page.getByRole("button", { name: "Publish this version" }).click();
  await expect(page.getByText(/Published\. The public page shows this version now\./)).toBeVisible();

  // 9. The brief is public, ranked and sourced.
  await page.goto(`/?q=${encodeURIComponent("e2e")}`);
  await page.getByRole("link", { name: "Software Engineering Intern, Dublin" }).click();
  await expect(page).toHaveURL(new RegExp(`/prep/${SLUG}/${PROGRAMME}$`));
  await expect(page.getByRole("heading", { name: "What should I study?" })).toBeVisible();
  const topics = page.locator("ol.rank-in > li");
  expect(await topics.count()).toBeGreaterThan(2);
  await expect(topics.first().getByText("Officially confirmed")).toBeVisible();
  await topics.first().getByText(/What the sources say/).click();
  await expect(topics.first().locator("mark").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the interview looks like" })).toBeVisible();
  await expect(page.getByText("A student report sent to us", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we don’t know" })).toBeVisible();

  // 10. Report an error; it lands in the corrections queue.
  await page.getByText("Spotted something wrong or out of date?").click();
  await page.getByLabel("What should change?").fill("The online assessment was 60 minutes, not 90.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report sent. A person reads every one")).toBeVisible();

  await page.goto("/admin/corrections");
  await expect(page.getByText("The online assessment was 60 minutes, not 90.")).toBeVisible();
  await expect(page.getByRole("link", { name: COMPANY })).toBeVisible();
  await page.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText(/Report 1 resolved\./)).toBeVisible();
});

test("unpublishing takes the brief down", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/versions/1");
  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText(/Unpublished\./)).toBeVisible();
  await page.goto(`/prep/${SLUG}/${PROGRAMME}`);
  await expect(page.getByRole("heading", { name: "Not enough evidence for a brief yet" })).toBeVisible();
});

test("public pages work at phone width and have no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/", "/contribute", "/method", `/prep/${SLUG}/${PROGRAMME}`]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
