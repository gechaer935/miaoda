import { expect, test } from '@playwright/test';

test('registers inside the client and opens the configured card shop', async ({ page }) => {
  await page.addInitScript(() => {
    let authState: any = { isAuthenticated: false };
    let registration: { username: string; password: string } | undefined;
    let externalUrl = '';
    (window as any).__getRegistration = () => registration;
    (window as any).__getExternalUrl = () => externalUrl;
    const bridge = {
      platform: 'win32',
      getThemeMode: async () => ({ resolved: 'light' }),
      getUndetectable: async () => false,
      getOverlayMousePassthrough: async () => false,
      getKeybinds: async () => [],
      miaodaAuthGetState: async () => authState,
      miaodaAccountRegister: async (username: string, password: string) => {
        registration = { username, password };
        authState = {
          isAuthenticated: true,
          authMode: 'account',
          username,
          quota: { remainingInterviewSeconds: 0, remainingWrittenQuestions: 0 },
        };
        return authState;
      },
      openExternal: async (url: string) => {
        externalUrl = url;
      },
      onThemeChanged: () => () => undefined,
      onUndetectableChanged: () => () => undefined,
      onOverlayMousePassthroughChanged: () => () => undefined,
      onKeybindsUpdate: () => () => undefined,
      onGlobalShortcut: () => () => undefined,
      onMiaodaQuotaChanged: () => () => undefined,
    };
    (window as any).electronAPI = new Proxy(bridge, {
      get(target, property) {
        if (property in target) return (target as any)[property];
        if (String(property).startsWith('on')) return () => () => undefined;
        return async () => undefined;
      },
    });
  });

  await page.goto('http://127.0.0.1:5180/');
  await page.getByRole('tab', { name: '注册' }).click();
  await expect(page.getByRole('heading', { name: '注册秒答' })).toBeVisible();
  await page.getByLabel('用户名').fill('client-user');
  const passwordInputs = page.locator('.lite-auth-field input[type="password"]');
  await passwordInputs.nth(0).fill('password123');
  await passwordInputs.nth(1).fill('password123');
  await page.getByRole('button', { name: /创建账户/ }).click();

  await expect(page.locator('.lite-hero-account')).toContainText('client-user');
  await expect.poll(() => page.evaluate(() => (window as any).__getRegistration())).toEqual({
    username: 'client-user',
    password: 'password123',
  });

  await page.getByRole('button', { name: '购买卡密' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__getExternalUrl())).toBe('https://example.invalid/');
});
