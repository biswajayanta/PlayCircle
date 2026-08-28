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

test('circle ledger reflects a new expense immediately, no manual reload needed', async ({
  browser,
  page,
}) => {
  // Two full signups, a circle, a game, a member invite, and a second
  // browser context joining — genuinely more setup than the default 30s
  // budget comfortably covers on a loaded runner. The original version of
  // this test already spent 22.5s of that budget just reaching its final
  // assertion; this one does one more in-app navigation on top of that.
  test.setTimeout(60_000);


  const email = testEmail('ledger');
  await signUp(page, 'Ledger E2E', email);

  const circleName = `Ledger Circle ${Date.now()}`;
  await page.getByPlaceholder('New circle name').fill(circleName);
  await page.getByText('Create', { exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByText(circleName, { exact: true }).click();
  await page.waitForTimeout(1000);

  await page.getByText('+ New Game', { exact: true }).click();
  await page.waitForTimeout(500);

  // Sport tab is the default view — pick Pickleball, then the matching
  // venue card that appears below it, before date/time show up.
  await page.getByText('Pickleball', { exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByText('HSR Layout Pickleball Courts', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('input[type="date"]').fill('2026-12-20');
  await page.locator('input[type="time"]').fill('18:00');
  await page.getByText('Create', { exact: true }).last().click();
  await page.waitForTimeout(1200);

  // Add a second real member — this lives on the dedicated Members screen
  // (behind the "N Members" button), not inline on the circle screen.
  const email2 = testEmail('ledger-second');
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  await signUp(page2, 'Second Player', email2);

  await page.getByText('👥', { exact: false }).click();
  await page.waitForTimeout(800);
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

  await page
    .locator('input[placeholder="What was it for? e.g. Court booking"]')
    .fill('E2E Court Booking');
  await page.locator('input[placeholder="Amount, e.g. 800.00"]').fill('300');
  await page.getByText('Add Expense', { exact: true }).click();
  await page.waitForTimeout(1000);

  // The whole point of this test: no manual reload, just a normal in-app
  // navigation to the Ledger — it must reflect the new expense right away.
  // With two participants and only one payer, there's now genuine debt.
  await page.getByText('View Circle Ledger', { exact: false }).click();
  await page.waitForTimeout(1000);
  await expect(page.getByText('settled up', { exact: false })).not.toBeVisible();
  await expect(page.getByText('owes', { exact: false }).first()).toBeVisible();
});
