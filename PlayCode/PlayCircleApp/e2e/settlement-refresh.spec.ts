import { expect, test } from '@playwright/test';
import { testEmail } from './helpers';

async function signUp(page: import('@playwright/test').Page, name: string, email: string) {
  await page.goto('/');
  await page.getByText('Create an account').click();
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min 8 characters)').fill('e2etestpass123');
  await page.getByText('Create Account', { exact: true }).click();
  await expect(page.getByText(name, { exact: false })).toBeVisible({ timeout: 10_000 });
}

test('settlement plan updates immediately after adding an expense, no navigation needed', async ({
  browser,
  page,
}) => {
  const email = testEmail('settle');
  await signUp(page, 'Settlement E2E', email);

  const circleName = `Settle Circle ${Date.now()}`;
  await page.getByPlaceholder('New circle name').fill(circleName);
  await page.getByText('Create', { exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByText(circleName, { exact: true }).click();
  await page.waitForTimeout(1000);

  await page.getByText('+ New Game', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByText('HSR Layout Pickleball Courts', { exact: true }).first().click();
  await page.locator('input[type="datetime-local"]').fill('2026-12-20T18:00');
  await page.getByText('Create', { exact: true }).last().click();
  await page.waitForTimeout(1200);

  // Add a second real member to the circle first.
  const email2 = testEmail('settle-second');
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await signUp(page2, 'Second Player', email2);

  await page.getByText('+ Add Member', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="their@email.com"]').fill(email2);
  await page.getByText('Add by email', { exact: true }).click();
  await page.waitForTimeout(1000);

  // The second player logs in, opens the same circle, and joins the game
  // themselves — being a circle member alone doesn't make you a game
  // participant.
  await page2.reload();
  await page2.waitForTimeout(1200);
  await page2.getByText(circleName, { exact: true }).click();
  await page2.waitForTimeout(1000);
  await page2.getByText('Join', { exact: true }).click();
  await page2.waitForTimeout(1000);
  await context2.close();

  // Back on the owner's page — go via Home (a hard reload on a deep URL
  // 404s under the plain static file server used for this build, since it
  // has no SPA fallback) to pick up the second participant, then to Expenses.
  await page.goto('/');
  await page.waitForTimeout(1000);
  await page.getByText(circleName, { exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByText('joined', { exact: false }).first().click();
  await page.waitForTimeout(1000);
  await page.getByText('💰 View Expenses', { exact: true }).click();
  await page.waitForTimeout(1000);

  await expect(page.getByText('settled up', { exact: false })).toBeVisible();

  await page
    .locator('input[placeholder="What was it for? e.g. Court booking"]')
    .fill('E2E Court Booking');
  await page.locator('input[placeholder="Amount, e.g. 800.00"]').fill('300');
  await page.getByText('Add Expense', { exact: true }).click();
  await page.waitForTimeout(1000);

  // The whole point of this test: no reload, no back-and-forth navigation —
  // the settlement plan must reflect the new expense right here.
  await expect(page.getByText('settled up', { exact: false })).not.toBeVisible();
  await expect(page.getByText('owes', { exact: false })).toBeVisible();
});
