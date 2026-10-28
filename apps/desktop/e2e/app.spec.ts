import { expect, test, type Browser, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000';
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Welcome@123';
const run = Date.now().toString(36);
// 1×1 PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Signs a demo user in through the API. */
async function login(user: string): Promise<string> {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${user}@nexus.local`, password: PASSWORD }),
  });
  expect(res.ok, `login ${user}`).toBeTruthy();
  return (await res.json()).token;
}

/** A page signed in as a demo user: the token goes where the web bridge reads it, skipping the form. */
async function signedIn(browser: Browser, user: string, token?: string): Promise<Page> {
  token ??= await login(user);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await context.addInitScript((t) => localStorage.setItem('nexus.token', t), token);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a post' })).toBeVisible();
  return page;
}

/** Unread total shown in the window title, e.g. "(3) Nexus" → 3. */
const titleCount = async (page: Page) => Number((await page.title()).match(/^\((\d+)\)/)?.[1] ?? 0);

test('signs in through the form, rejecting a wrong password', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Work email').fill('priya@nexus.local');
  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect')).toBeVisible();
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Start a post' })).toBeVisible();
});

test('publishes a post from the composer', async ({ browser }) => {
  const page = await signedIn(browser, 'neha');
  await page.getByRole('button', { name: 'Start a post' }).click();
  await page.getByPlaceholder(/What do you want to talk about/).fill(`UI test post ${run} #uitest`);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText(`UI test post ${run}`)).toBeVisible();
});

test('messaging is realtime across two clients: typing, delivery, unread badge, attachments', async ({ browser }) => {
  test.slow(); // two cold page loads of the dev server
  const priyaToken = await login('priya');
  const priya = await signedIn(browser, 'priya', priyaToken);
  const meera = await signedIn(browser, 'meera');

  // Open (or reuse) the 1:1 conversation directly: /messaging alone auto-opens the most recent thread first,
  // and typing during that switch would land in a box that is about to unmount.
  const authed = { authorization: `Bearer ${priyaToken}`, 'content-type': 'application/json' };
  const [meeraUser] = await (await fetch(`${API}/api/v1/users?q=Meera%20Iyer`, { headers: authed })).json();
  const { id } = await (await fetch(`${API}/api/v1/conversations`, { method: 'POST', headers: authed, body: JSON.stringify({ userIds: [meeraUser.id] }) })).json();
  await priya.goto(`/#/messaging/${id}`);
  await meera.goto(`/#/messaging/${id}`);
  const priyaBox = priya.getByPlaceholder(/Write a message/);
  await expect(priyaBox).toBeVisible();
  await expect(meera.getByPlaceholder(/Write a message/)).toBeVisible();

  // Meera has the thread open; everything below arrives without a reload.
  await priyaBox.fill(`Opening line ${run}`);
  await priyaBox.press('Enter');
  await expect(meera.getByText(`Opening line ${run}`, { exact: true })).toBeVisible();

  await priya.waitForTimeout(1600); // typing events are throttled to one per 1.5 s
  await priyaBox.fill(`Typing check ${run}`);
  await expect(meera.getByText('Priya Sharma is typing…')).toBeVisible();
  await priyaBox.press('Enter');
  await expect(meera.getByText(`Typing check ${run}`, { exact: true })).toBeVisible();
  await expect(meera.getByText('Priya Sharma is typing…')).toBeHidden();
  await expect(priya.getByText('Seen')).toBeVisible();

  // Attachment through the file picker reaches the other client.
  await priya.locator('input[type=file]').setInputFiles({ name: `pixel-${run}.png`, mimeType: 'image/png', buffer: PIXEL });
  await expect(meera.locator('img[src*="/media/"]').last()).toBeVisible();
  // Disallowed types are refused with a message instead of failing silently.
  await priya.locator('input[type=file]').setInputFiles({ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(priya.getByText(/vector\.svg: only PNG/)).toBeVisible();

  // Away from the thread, a new message bumps Meera's unread count live.
  await meera.goto('/#/');
  await expect(meera.getByRole('button', { name: 'Start a post' })).toBeVisible();
  const before = await titleCount(meera);
  await priyaBox.fill(`Badge check ${run}`);
  await priyaBox.press('Enter');
  await expect.poll(() => titleCount(meera)).toBe(before + 1);
});
