import { expect, test, type Page } from '@playwright/test';

const ADMIN_USER = {
  id: 'u1',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'ADMIN',
  organizationId: 'o1',
  emailVerified: true,
};

const VIEWER_USER = {
  id: 'u2',
  email: 'viewer@example.com',
  name: 'Viewer User',
  role: 'VIEWER',
  organizationId: 'o1',
  emailVerified: true,
};

async function setupSession(
  page: Page,
  options: {
    user?: typeof ADMIN_USER | typeof VIEWER_USER;
    deploymentMode?: 'self-hosted' | 'cloud';
    connectorsList?: any[];
    mcpServersList?: any[];
  } = {}
) {
  const user = options.user ?? ADMIN_USER;
  const deploymentMode = options.deploymentMode ?? 'self-hosted';
  const connectorsList = options.connectorsList ?? [
    { id: 'c1', name: 'Stripe Payments', type: 'REST', slug: 'stripe' },
  ];
  const mcpServersList = options.mcpServersList ?? [
    { id: 's1', name: 'Search Server', slug: 'search-server' },
  ];

  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([{ name: 'amcp_token', value: 'test-token', url: baseURL }]);
  await page.addInitScript((u) => {
    localStorage.setItem('amcp_token', 'test-token');
    localStorage.setItem('amcp_user', JSON.stringify(u));
  }, user);

  await page.route(/\/(api|health)\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (p === '/health/server-info') {
      return json({
        deploymentMode,
        mcpAuthMode: 'oauth2',
        hasUsers: true,
        registrationEnabled: true,
        ssoProviders: [],
      });
    }
    if (p.endsWith('/api/users/me/onboarding-state')) return json({ onboardingCompletedAt: '2026-01-01T00:00:00Z' });
    if (p.endsWith('/api/users/me')) return json(user);
    if (p.endsWith('/api/organizations/current')) return json({ id: 'o1', name: 'Acme', createdAt: '2026-01-01' });
    if (p.endsWith('/api/organizations/mine')) {
      return json([
        { id: 'o1', name: 'Acme', role: user.role, joinedAt: '2026-01-01' },
        { id: 'o2', name: 'Beta Corp', role: 'MEMBER', joinedAt: '2026-01-01' },
      ]);
    }
    if (p.endsWith('/api/license/status')) return json({ plan: 'community', status: 'active' });
    if (p.endsWith('/api/connectors/c1')) return json({ id: 'c1', name: 'Stripe Payments', type: 'REST', slug: 'stripe' });
    if (p.endsWith('/api/connectors')) return json(connectorsList);
    if (p.endsWith('/api/mcp-servers/s1/activity')) return json({ calls30d: 0, lastCallAt: null });
    if (p.endsWith('/api/mcp-servers/s1')) return json({ id: 's1', name: 'Search Server', slug: 'search-server', isActive: true, apiKeys: [], connectors: [] });
    if (p.endsWith('/api/mcp-servers')) return json(mcpServersList);
    if (p.endsWith('/api/audit/stats')) return json({ invocations24h: 0, errors24h: 0 });
    if (p.endsWith('/api/audit/analytics')) return json({ daily: [], topTools: [], totalInvocations: 0, successRate: 100, avgDuration: 0 });
    if (p.includes('/api/audit/invocations')) return json([]);
    return json({});
  });
}

async function openCommandPalette(page: Page) {
  const palette = page.getByRole('dialog');
  await expect.poll(async () => {
    if (await palette.isVisible()) return true;
    await page.keyboard.press('ControlOrMeta+k');
    return await palette.isVisible();
  }, { timeout: 7000, intervals: [150, 300, 500] }).toBe(true);

  const input = page.getByRole('combobox');
  await expect(input).toBeVisible();
  return { palette, input };
}

test.describe('Command Palette', () => {
  test('opens via Ctrl+K / ⌘K and header button, and closes via Esc on AppShell pages', async ({ page }) => {
    await setupSession(page);
    await page.goto('/');

    const palette = page.getByRole('dialog');
    await expect(palette).not.toBeVisible();

    // Open via keyboard shortcut
    await expect.poll(async () => {
      if (await palette.isVisible()) return true;
      await page.keyboard.press('ControlOrMeta+k');
      return await palette.isVisible();
    }, { timeout: 7000, intervals: [150, 300, 500] }).toBe(true);

    // Combobox input should be focused
    const searchInput = page.getByRole('combobox');
    await expect(searchInput).toBeFocused();

    // Close via Esc
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();

    // Open via visible trigger button in header
    const searchButton = page.getByRole('button', { name: 'Open command palette' }).first();
    await expect(searchButton).toBeVisible();
    await searchButton.click();
    await expect(palette).toBeVisible();

    // Close again via Esc
    await page.keyboard.press('Escape');
    await expect(palette).not.toBeVisible();
  });

  test('does not open on /login page', async ({ page }) => {
    await page.route(/\/(api|health)\//, async (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/health/server-info') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            deploymentMode: 'self-hosted',
            mcpAuthMode: 'oauth2',
            hasUsers: true,
            registrationEnabled: true,
            ssoProviders: [],
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('typing "audit" and Enter opens /logs', async ({ page }) => {
    await setupSession(page);
    await page.goto('/');

    const { input } = await openCommandPalette(page);

    await input.fill('audit');
    await expect(page.getByRole('option', { name: /Audit Log/i })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/logs$/);
  });

  test('typing part of a connector name opens that connector', async ({ page }) => {
    await setupSession(page);
    await page.goto('/');

    const { input } = await openCommandPalette(page);

    await input.fill('stripe');
    const option = page.getByRole('option', { name: /Stripe Payments/i });
    await expect(option).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/connectors\/c1$/);
  });

  test('typing part of an MCP server name opens that server', async ({ page }) => {
    await setupSession(page);
    await page.goto('/');

    const { input } = await openCommandPalette(page);

    await input.fill('search');
    const option = page.getByRole('option', { name: /Search Server/i });
    await expect(option).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/mcp-server\/s1$/);
  });

  test('admin sees "Users", "Add connector", and "Single sign-on" on self-hosted', async ({ page }) => {
    await setupSession(page, { user: ADMIN_USER, deploymentMode: 'self-hosted' });
    await page.goto('/');

    const { input } = await openCommandPalette(page);

    // Check Users in Settings
    await input.fill('users');
    await expect(page.getByRole('option', { name: /Users/i })).toBeVisible();

    // Check Single sign-on in Settings
    await input.fill('single sign-on');
    await expect(page.getByRole('option', { name: /Single sign-on/i })).toBeVisible();

    // Check Add connector in Actions
    await input.fill('add connector');
    await expect(page.getByRole('option', { name: /Add connector/i })).toBeVisible();
  });

  test('viewer sees neither "Users" nor "Add connector"', async ({ page }) => {
    await setupSession(page, { user: VIEWER_USER, deploymentMode: 'self-hosted' });
    await page.goto('/');

    const { input } = await openCommandPalette(page);

    // Viewer should not see Users
    await input.fill('users');
    await expect(page.getByRole('option', { name: /Users/i })).not.toBeVisible();

    // Viewer should not see Add connector
    await input.fill('add connector');
    await expect(page.getByRole('option', { name: /Add connector/i })).not.toBeVisible();
  });

  test('with deploymentMode: "cloud", "Single sign-on" is not listed', async ({ page }) => {
    await setupSession(page, { user: ADMIN_USER, deploymentMode: 'cloud' });
    await page.goto('/');

    const { input } = await openCommandPalette(page);

    await input.fill('single sign-on');
    await expect(page.getByRole('option', { name: /Single sign-on/i })).not.toBeVisible();
  });

  test('sidebar and settings navigation look and behave as before', async ({ page }) => {
    await setupSession(page);
    await page.goto('/');

    // Sidebar navigation check
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Connectors' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Audit Log' })).toBeVisible();

    // Navigate to Settings
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: /Profile/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Connections/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Users/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Roles/i })).toBeVisible();
  });

  test('keyboard arrow navigation and ARIA attributes', async ({ page }) => {
    await setupSession(page);
    await page.goto('/');

    const { input } = await openCommandPalette(page);

    // ARIA attributes on input
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await expect(input).toHaveAttribute('aria-controls', 'command-palette-results');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');

    // Listbox and options
    const listbox = page.getByRole('listbox', { name: 'Commands' });
    await expect(listbox).toBeVisible();

    const initialDescendant = await input.getAttribute('aria-activedescendant');
    expect(initialDescendant).toBeTruthy();

    // Press ArrowDown to change active option
    await page.keyboard.press('ArrowDown');
    const nextDescendant = await input.getAttribute('aria-activedescendant');
    expect(nextDescendant).toBeTruthy();
    expect(nextDescendant).not.toBe(initialDescendant);

    // Selected option has aria-selected="true"
    const activeOption = page.locator(`#${nextDescendant}`);
    await expect(activeOption).toHaveAttribute('aria-selected', 'true');

    // Press ArrowUp to go back
    await page.keyboard.press('ArrowUp');
    const backDescendant = await input.getAttribute('aria-activedescendant');
    expect(backDescendant).toBe(initialDescendant);
  });

  test('common actions: Toggle theme, Switch workspace, and Log out are listed and functional', async ({ page }) => {
    await setupSession(page);
    await page.goto('/');

    const html = page.locator('html');
    const wasDark = await html.evaluate((el) => el.classList.contains('dark'));

    // Test Toggle theme action
    const { input } = await openCommandPalette(page);
    await input.fill('toggle theme');
    await expect(page.getByRole('option', { name: /Toggle theme/i })).toBeVisible();
    await page.keyboard.press('Enter');

    // Dialog closes and theme switches
    await expect(page.getByRole('dialog')).not.toBeVisible();
    if (wasDark) {
      await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    } else {
      await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    }

    // Test Switch to other workspace and Log out are listed
    const second = await openCommandPalette(page);
    await second.input.fill('Switch to Beta Corp');
    await expect(page.getByRole('option', { name: /Switch to Beta Corp/i })).toBeVisible();

    await second.input.fill('Log out');
    await expect(page.getByRole('option', { name: /Log out/i })).toBeVisible();
  });
});
